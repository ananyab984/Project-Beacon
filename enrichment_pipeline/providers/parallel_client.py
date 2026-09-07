"""Parallel client -- Tier 2 enrichment for every platform, replacing Clay in
this exact waterfall position. Clay's stage was LinkedIn-only because Clay
rejected any other identifier; Parallel has no such limitation (its PoC
covered ProZ, Bodalgo, ATA/ATAA and Freelancer.com profile URLs), so this runs
for LinkedIn and non-LinkedIn leads alike -- see orchestrator.py's
_run_parallel_stage.

Unlike Clay (the previous Tier 2 provider), Parallel's Task Run API is
SYNCHRONOUS: `enrich_profile()` here blocks until Parallel resolves the
profile and returns the fields directly -- no separate inbound/outbound
webhook round trip, no "_clay_dispatch: pending" marker for the rest of the
waterfall to account for. Tier 2 now concludes within the same /enrich
request as every other stage, same as BrightData/Tavily/Claude.
"""

from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor
from typing import Any, Dict, List, Optional

from pydantic import BaseModel, Field

from config import Config
from core.resilience import RetryExhaustedError, RetryPolicy, TransientError, retry_with_backoff
from logger import get_logger

log = get_logger(__name__)

# Parallel's calls run considerably longer than every other provider in this
# pipeline (a Task Run can take tens of seconds to a couple of minutes
# depending on the processor tier) -- giving it a SEPARATE, dedicated pool
# from core/resilience.py's shared 20-worker `_executor` means a burst of
# slow Parallel calls (one per concurrently-processed lead -- see Node's
# bounded-concurrency poller in server/src/jobs/enrichment.job.ts) can never
# starve BrightData/Tavily/Claude calls for OTHER leads being processed at
# the same time. A bulkhead, not a shared queue. Sized modestly: this
# pipeline is triggered per-lead or in small batches, not public traffic --
# revisit alongside Node's own concurrency limit if that ever changes.
_parallel_executor = ThreadPoolExecutor(max_workers=8, thread_name_prefix="parallel")


class ParallelError(Exception):
    """Failure calling Parallel's Task Run API.

    `permanent` says whether re-running the SAME input could plausibly
    succeed, and it drives whether the orchestrator ever tries this lead
    again (see _run_parallel_stage). A malformed or unresearchable URL gets
    the identical answer every time, so retrying it just spends money and
    minutes; a timeout or a 5xx is worth another pass.
    """

    def __init__(self, message: str, status_code: Optional[int] = None, permanent: bool = False):
        super().__init__(message)
        self.message = message
        self.status_code = status_code
        self.permanent = permanent


class LeadProfile(BaseModel):
    """Structured output schema for Parallel's Task Run -- the canonical
    fields this waterfall stage is responsible for filling. Kept intentionally
    narrow (mirrors what BrightData/Tavily already resolve) rather than
    Parallel's full raw response shape; the complete raw content is still
    preserved verbatim by the caller for drafting (see orchestrator.py's
    `parallel_fallback["data"]`, stored downstream as Lead.parallelData).

    Extract ONLY what is literally present on the profile page. If a field
    isn't there, leave it null (or an empty list) -- never infer it, never
    estimate it, and never write an explanatory sentence about its absence
    into the field itself. Confirmed live (2026-09-07) that without this
    instruction the model wrote strings like "No certifications are listed in
    the available profile evidence." INTO `certifications`, which then flows
    straight through to Lead.certifications and gets quoted back to the lead
    as a fact in their outreach draft. An empty list is the correct way to
    say "not present"; prose is not.
    """

    headline: Optional[str] = Field(
        None, description="The profile's own headline/tagline, verbatim. Null if the page has none."
    )
    current_title: Optional[str] = Field(
        None,
        description=(
            "The person's current role title exactly as displayed on the profile. "
            "Null if no current role is listed -- do not infer one from past roles."
        ),
    )
    about_snippet: Optional[str] = Field(
        None,
        description=(
            "The About/Bio/Summary text, verbatim or near-verbatim. Platforms label this "
            "section differently ('About', 'Bio', 'Summary', 'Profile Overview') and it is "
            "often the first block of prose under the name/headline with no heading at all -- "
            "treat that as this field too. Null if the page genuinely has no such text."
        ),
    )
    country: Optional[str] = Field(
        None,
        description=(
            "The COUNTRY the person is based in, as a country name (e.g. 'India', 'Spain'). "
            "If the profile shows only a city, region, or state, resolve it to its country. "
            "Null if the page gives no location at all -- do not guess from language or name."
        ),
    )
    certifications: List[str] = Field(
        default_factory=list,
        description=(
            "Names of real professional credentials (degrees, licences, institutional or "
            "vendor certifications) explicitly listed on the profile, one string per "
            "credential. Return an EMPTY LIST if none are listed -- never a sentence "
            "explaining that none were found, and never a placeholder like 'N/A'."
        ),
    )
    experience: List[Dict[str, Any]] = Field(
        default_factory=list,
        description=(
            "One entry per role listed on the profile, each with whatever of "
            "company/title/start_date/end_date/summary the page actually shows. Empty list "
            "if no work history is listed -- never a sentence about its absence."
        ),
    )
    education: List[Dict[str, Any]] = Field(
        default_factory=list,
        description=(
            "One entry per education record, each with whatever of "
            "school_name/degree/field_of_study/start_date/end_date the page shows. Empty "
            "list if none listed -- never a sentence about its absence."
        ),
    )
    languages: List[Dict[str, Any]] = Field(
        default_factory=list,
        description=(
            "One entry per language explicitly listed on the profile, each with `language` "
            "and (if shown) `proficiency`. Only languages the page actually states -- do "
            "not infer from the person's location or name. Empty list if none listed."
        ),
    )


class ParallelClient:
    """Client for Parallel's Task Run API -- synchronous, blocking call."""

    def __init__(self, config: Config):
        # Local import: parallel-web is an optional dependency, only needed
        # when PARALLEL_API_KEY is actually configured (see
        # EnrichmentOrchestrator.__init__ -- self.parallel stays None
        # otherwise, so this constructor never runs without the key set).
        from parallel import Parallel

        self.config = config
        self._client = Parallel(api_key=config.parallel_api_key)
        self._policy = RetryPolicy(
            retries=config.max_retries,
            deadline_seconds=config.parallel_deadline_seconds,
        )

    def enrich_profile(self, lead: Dict[str, Any], profile_link: str) -> Dict[str, Any]:
        """Run Parallel's Task Run API for one profile URL -- any platform,
        not just LinkedIn -- and return its resolved fields as a plain dict.
        Raises ParallelError on failure; the caller (orchestrator) logs and
        continues, so Tier 1's (partial or empty) result still stands."""
        # `entity_name`/`entity_url` deliberately mirrors the PoC's validated
        # input shape (POC/parallel_api_poc/test.py) rather than inventing new
        # key names. The previous `linkedin_url` key was actively misleading
        # once this stage stopped being LinkedIn-only: handing a Bodalgo or
        # ProZ URL to a field called "linkedin_url" tells the model the page
        # is something it isn't.
        input_payload = {
            "entity_name": lead.get("Full_Name") or "",
            "entity_url": profile_link,
        }

        def on_retry(exc: BaseException, attempt: int, delay: float) -> None:
            log.warning(
                "Retry %d/%d calling Parallel for %s after %.1fs (%s)",
                attempt + 1, self.config.max_retries, profile_link, delay, exc,
            )

        try:
            result = retry_with_backoff(
                lambda: self._run_once(input_payload),
                policy=self._policy,
                on_retry=on_retry,
                executor=_parallel_executor,
            )
            log.info("Parallel enrichment complete for %s", profile_link)
            return result
        except RetryExhaustedError as exc:
            cause = exc.cause
            if isinstance(cause, ParallelError):
                raise cause from exc
            raise ParallelError(str(cause) if cause else str(exc)) from exc

    def _run_once(self, input_payload: Dict[str, Any]) -> Dict[str, Any]:
        try:
            # Deliberately NOT passing our own `timeout=` here. Confirmed live
            # (2026-09-07): a real "core"-processor Task Run for a LinkedIn
            # profile routinely takes ~150-170s, and a guessed client-side
            # cutoff (this used to pass 150s, then 240s) kept firing right as
            # the real result was landing server-side -- the task was
            # succeeding, our own too-short guess just wasn't waiting for it.
            # `task_run.execute()` already has a well-engineered default
            # (`parallel.lib._time.DEFAULT_EXECUTE_TIMEOUT_SECONDS` = 3600s,
            # i.e. genuinely wait up to an hour for the task to actually
            # finish, polling `task_run.result()` internally) -- deferring to
            # that instead of re-guessing our own shorter number is what
            # actually gets a real result for every lead instead of an
            # arbitrary early cutoff. self._policy's outer deadline (see
            # __init__) is kept comfortably above this 3600s ceiling so it
            # can never truncate a still-genuinely-working call either.
            run_result = self._client.task_run.execute(
                input=input_payload,
                processor=self.config.parallel_processor,
                output=LeadProfile,
            )
        except Exception as exc:  # noqa: BLE001 -- SDK raises its own exception types we don't import here
            # Classify before deciding anything downstream. A 4xx (other than
            # 429) means Parallel understood us and refused: the input URL is
            # malformed, unreachable, or not something it can research. Sending
            # the identical payload again gets the identical refusal, so this
            # is raised as a PERMANENT ParallelError -- which core/resilience
            # re-raises immediately rather than burning the retry budget on
            # it, and which stops the orchestrator ever re-attempting this
            # lead. Everything else (timeout, connection reset, 429, 5xx) is
            # transient and worth another go.
            status = getattr(exc, "status_code", None)
            if isinstance(status, int) and 400 <= status < 500 and status != 429:
                raise ParallelError(
                    f"Parallel rejected this input ({status}): {exc}",
                    status_code=status,
                    permanent=True,
                ) from exc
            raise TransientError(f"Parallel Task Run failed: {exc}") from exc

        output = getattr(run_result, "output", None)
        content = getattr(output, "content", None) if output is not None else None
        if not isinstance(content, dict):
            # The run itself completed, it just produced nothing usable.
            # Deliberately NOT permanent: this is the model returning an
            # unexpected shape, which a fresh run can plausibly get right,
            # and the orchestrator's attempt cap bounds what that can cost.
            raise ParallelError("Parallel Task Run returned no usable content")
        return content
