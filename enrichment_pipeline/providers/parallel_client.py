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

import time
from concurrent.futures import ThreadPoolExecutor
from typing import Any, Dict, List, Optional

from pydantic import BaseModel, Field

from config import Config
from core.resilience import PER_LEAD_POOL_SIZE, RetryExhaustedError, RetryPolicy, TransientError, retry_with_backoff
from logger import get_logger

log = get_logger(__name__)

# Parallel's calls run considerably longer than every other provider in this
# pipeline (a Task Run can take tens of seconds to a couple of minutes
# depending on the processor tier) -- giving it a SEPARATE, dedicated pool
# from core/resilience.py's shared 20-worker `_executor` means a burst of
# slow Parallel calls (one per concurrently-processed lead -- see Node's
# bounded-concurrency poller in server/src/jobs/enrichment.job.ts) can never
# starve BrightData/Tavily/Claude calls for OTHER leads being processed at
# the same time. A bulkhead, not a shared queue: one worker per
# concurrently-enriched lead (core/resilience.py's PER_LEAD_POOL_SIZE, which
# follows ENRICHMENT_CONCURRENCY).
_parallel_executor = ThreadPoolExecutor(max_workers=PER_LEAD_POOL_SIZE, thread_name_prefix="parallel")

# Budget for CREATING one run (a quick POST), retries included.
_CREATE_DEADLINE_SECONDS = 120.0
# Longest single server-side long-poll on `result()`; looped until the run
# finishes or parallel_deadline_seconds runs out.
_RESULT_LONG_POLL_SECONDS = 600


def _classify(exc: BaseException, what: str) -> Exception:
    """A 4xx (other than 408/429) means Parallel understood the request and
    refused it -- sending it again gets the same refusal, so it's a PERMANENT
    ParallelError (re-raised at once by core/resilience, and the orchestrator
    stops re-attempting the lead). Anything else is transient."""
    status = getattr(exc, "status_code", None)
    if isinstance(status, int) and 400 <= status < 500 and status not in (408, 429):
        return ParallelError(f"{what} ({status}): {exc}", status_code=status, permanent=True)
    return TransientError(f"{what}: {exc}")


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


class ExperienceEntry(BaseModel):
    """One role from the profile's work-history section.

    Declared as a real model rather than a free-form object on purpose. A
    bare `Dict[str, Any]` compiles to a JSON Schema object with NO declared
    properties (`{"type": "object", "additionalProperties": true}`), which
    leaves the extractor nowhere to put anything: confirmed live 2026-09-08,
    all 107 experience/education/language rows across 27 enriched leads came
    back as `{}` while the row COUNTS were correct -- Martin Godart's profile
    yielded "3 roles found", stored as three empty objects, and the lead read
    "Enriched" in the UI with every deep section showing "None found". The
    schema has to NAME the keys or the data has nowhere to land.

    Key names match what both consumers already read -- the enrichment
    dialog's `formatRole` and drafting_service/core/leads.py's `_format_role`
    / `_role_highlight` -- so nothing downstream changes.

    `company` and `title` are REQUIRED, and that is load-bearing rather than
    cosmetic. The first version of this model declared every field
    `Optional[...] = None`, which makes an EMPTY LIST a trivially valid answer
    for the whole section -- and that is the answer the model gave: the two
    runs after it shipped returned `experience: []` for LinkedIn profiles whose
    sections Parallel had previously enumerated correctly. The PoC that DID
    return 5 fully-populated roles for the same URL
    (POC/parallel_api_poc/test.py:46-85) required both. Requiring them means an
    entry cannot be emitted as a shell, so the model must either extract the
    role or omit it -- there is no cheap middle answer.
    """

    company: str = Field(
        ...,
        description="The employer/client/organisation name for this role, as shown on the page.",
    )
    title: str = Field(
        ...,
        description=(
            "The position/role title exactly as displayed immediately above or "
            "alongside this entry's description on the profile — copy it verbatim, "
            "do not infer, relabel, or reassign it based on what the description "
            "seems to be about. If a single company block on the page lists multiple "
            "stacked roles/positions with their own titles and date ranges, treat each "
            "as its own separate entry and keep each title paired with its own "
            "description exactly as grouped on the page — never swap a description "
            "over to a different entry's title."
        ),
    )
    start_date: Optional[str] = Field(
        None,
        description=(
            "Start of this role, verbatim as the page writes it (e.g. '2020', 'Mar 2020', "
            "'2020-03'). Do not reformat and do not infer. Null if not shown."
        ),
    )
    end_date: Optional[str] = Field(
        None,
        description=(
            "End of this role, verbatim as the page writes it. Use the page's own wording "
            "for a current role ('Present', 'Actual', 'Heute'). Null if not shown."
        ),
    )
    is_current: bool = Field(
        ...,
        description="True if this is a role the person currently holds, per the page's own dates.",
    )
    summary: Optional[str] = Field(
        None,
        description=(
            "The full, complete narrative description of this role exactly as "
            "written on the profile — not a paraphrase. Leave null if none is listed. "
            "Must be the description that appears directly under THIS entry's own "
            "title on the page, not a description borrowed from a neighboring entry."
        ),
    )
    title_pairing_verified: bool = Field(
        ...,
        description=(
            "A self-check, not profile content. Before answering, look again at the "
            "raw page layout around this entry: is there any other role block for the "
            "SAME company directly above or below this one (stacked roles at one "
            "employer, each with its own title/date range)? Set this to true ONLY if "
            "you re-checked and are certain `title` and `summary` above both came from "
            "this exact block, not a neighboring one. Set it to false if the page had "
            "any stacked-role ambiguity at this company, even if you made your best "
            "guess anyway — false is not an error, it's a flag for human review."
        ),
    )


class EducationEntry(BaseModel):
    """One record from the profile's education section. Same reason as
    ExperienceEntry for being a named model; key names match the enrichment
    dialog's `formatEducation` and drafting's education fact-builder.

    `institution` is required for the same reason `ExperienceEntry.company` is:
    an all-optional entry makes an empty list the cheapest valid answer. An
    education record with no institution is not a record."""

    institution: str = Field(
        ...,
        description="Name of the school/university/institution, as shown on the page.",
    )
    degree: Optional[str] = Field(
        None,
        description=(
            "The qualification awarded (e.g. 'BA', 'Licence', 'MSc'), verbatim in the "
            "page's own language. Null if not shown."
        ),
    )
    field_of_study: Optional[str] = Field(
        None,
        description=(
            "Subject/major studied, verbatim in the page's own language. Null if not shown."
        ),
    )
    start_date: Optional[str] = Field(
        None, description="Start year/date verbatim as the page writes it. Null if not shown."
    )
    end_date: Optional[str] = Field(
        None, description="End year/date verbatim as the page writes it. Null if not shown."
    )


class LanguageEntry(BaseModel):
    """One language the profile explicitly lists. Same reason as
    ExperienceEntry for being a named model; `language`/`proficiency` are the
    keys the dialog's `labelOf` and drafting's `_label_of` already read.

    Directly relevant to this product: a linguist's stated language pairs and
    proficiency levels are the qualifying data recruiters filter on, and they
    were among the rows arriving empty.

    `language` is required -- an entry with no language name carries nothing,
    and allowing it made `[]` the cheapest valid answer for the section."""

    language: str = Field(
        ...,
        description=(
            "The language name as the page names it (e.g. 'Anglais', 'English', 'Espanol')."
        ),
    )
    proficiency: Optional[str] = Field(
        None,
        description=(
            "The stated proficiency level, verbatim as shown (e.g. 'Native or bilingual "
            "proficiency', 'Courant', 'C2'). Null if the page states none -- never guess a "
            "level."
        ),
    )


class ProfileSection(BaseModel):
    """One profile section no dedicated LeadProfile field covers (Projects,
    Honors & awards, Volunteering, Publications, Recommendations, a LinkedIn
    "Services" block...). Exists so a MAXIMAL extraction has somewhere to put
    everything: Parallel only ever returns fields this schema defines, so
    without a catch-all, anything outside the fixed fields was silently
    dropped at extraction time."""

    heading: str = Field(..., description="The section's heading exactly as shown on the page.")
    content: str = Field(
        ...,
        description="The section's full text, verbatim in the page's own language -- every entry, not a summary.",
    )


class LeadProfile(BaseModel):
    """Extract this lead's profile from the single page at the given entity_url.

    Before filling in any field: read the ENTIRE page top to bottom first -- do
    not stop at the first section that looks like a match for a field. Profile
    pages on these platforms commonly have several visually similar sections
    (a real qualifications section vs. a platform skill-test/"Certifications"
    section; a company block with several stacked roles rather than one) --
    treat each section by what it actually contains, not by what its heading
    resembles. When a job title and its description could plausibly belong to
    more than one entry (stacked roles at one employer), re-read the page
    layout before committing to a pairing rather than guessing from context --
    see `title_pairing_verified` on each experience entry.

    EXTRACT EVERYTHING available on the page that fits one of the fields below
    -- this is meant to be a MAXIMAL extraction, not a minimal one; do not stop
    early once a few fields are filled.

    That last paragraph is the whole point of this docstring and it is not
    decoration. This schema previously opened with "Kept intentionally narrow"
    and "Extract ONLY what is literally present", and the PoC that produced 5
    fully-populated roles with multi-paragraph narrative summaries for a
    LinkedIn profile (POC/parallel_api_poc/test.py:122-139) opened with the
    maximal-extraction framing above. The narrow framing, combined with
    all-optional nested entries, made an empty list the cheapest valid answer
    and that is what came back. The field descriptions ARE the instructions
    Parallel receives -- there is no separate prompt -- so a well-meaning
    tightening of this text is a silent behaviour change with no other symptom.

    Only extract what is literally present. If a field isn't there, leave it
    null (or an empty list) -- never infer it, never estimate it, and never
    write an explanatory sentence about its absence into the field itself.
    Confirmed live (2026-09-07) that without this instruction the model wrote
    strings like "No certifications are listed in the available profile
    evidence." INTO `certifications`, which then flows straight through to
    Lead.certifications and gets quoted back to the lead as a fact in their
    outreach draft. An empty list is the correct way to say "not present";
    prose is not. Note this is a rule about FABRICATION, not about restraint:
    extract exhaustively, and be null only where the page is genuinely silent.

    ANSWER IN THE PROFILE'S OWN LANGUAGE -- do NOT translate here. Many of
    these profiles aren't in English (ProZ, Bodalgo and personal sites carry
    Spanish, French, German, Portuguese and Italian ones), and English is
    what every downstream consumer needs -- but asking for translation AT
    EXTRACTION TIME makes the model do two jobs at once and quietly costs
    detail: a phrase it can't render cleanly in English tends to come back
    flattened or dropped entirely, and there's no way to tell afterwards
    that anything went missing. Extract completely and faithfully in
    whatever language the page uses; orchestrator.py's
    `_normalize_parallel_language` translates the result to English as its
    own step, keeping the original alongside so nothing is lost either way.
    """

    headline: Optional[str] = Field(
        None,
        description=(
            "The profile's own headline/tagline, verbatim in the page's own language. "
            "Null if the page has none."
        ),
    )
    current_title: Optional[str] = Field(
        None,
        description=(
            "The person's current role title exactly as displayed on the profile, in the "
            "page's own language. Null if no current role is listed -- do not infer one "
            "from past roles."
        ),
    )
    about_snippet: Optional[str] = Field(
        None,
        description=(
            "The About/Bio/Summary text, verbatim or near-verbatim IN THE PAGE'S OWN "
            "LANGUAGE -- completeness matters more than language here, so never abridge a "
            "passage because it would be awkward to translate. Platforms label this section "
            "differently ('About', 'Bio', 'Summary', 'Profile Overview') and it is often the "
            "first block of prose under the name/headline with no heading at all -- treat "
            "that as this field too. Null if the page genuinely has no such text."
        ),
    )
    country: Optional[str] = Field(
        None,
        description=(
            "The COUNTRY the person is based in, as a country name (e.g. 'India', 'Spain', "
            "'España' -- whichever the page uses; it gets normalised later). If the profile "
            "shows only a city, region, or state, resolve it to its country. Null if the page "
            "gives no location at all -- do not guess from the profile's language or the "
            "person's name."
        ),
    )
    email: Optional[str] = Field(
        None,
        description=(
            "A real email address shown as VISIBLE, LITERAL TEXT somewhere on the page (an "
            "About/Bio section, a dedicated contact block, even the headline). Copy it "
            "character-for-character. NEVER construct, guess, or infer one -- not even a "
            "plausible-looking pattern like 'firstname.lastname@company.com' -- if it is not "
            "printed on the page itself. A wrong email reaches a real, different person, so "
            "verbatim-or-null is the only acceptable answer here; there is no safe middle "
            "guess. Null if the page shows no email at all -- never a sentence explaining its "
            "absence.\n\n"
            "LinkedIn profiles will almost always come back null for this field: LinkedIn "
            "deliberately locks contact info behind an authenticated 'Contact info' modal "
            "that is not part of the publicly rendered page a browsing agent can read, so "
            "finding nothing there is the platform's own restriction working as intended, not "
            "a failed extraction. Freelance-marketplace profiles (ProZ, Bodalgo, ATA/ATAA, "
            "Freelancer.com) publish contact details on the page itself far more often, since "
            "that is how their users solicit work -- this field is meant to actually succeed "
            "there."
        ),
    )
    phone: Optional[str] = Field(
        None,
        description=(
            "A real phone number shown as VISIBLE, LITERAL TEXT on the page, copied verbatim "
            "including whatever formatting/country code it's written with. Same rule as "
            "email: only if directly printed on the page, never inferred or guessed. Null if "
            "the page shows no phone number. Same LinkedIn caveat as email applies -- expect "
            "null there, since LinkedIn does not publicly render contact info at all."
        ),
    )
    profile_sections_detected: List[str] = Field(
        default_factory=list,
        description=(
            "A QA checklist, not profile content: list the literal section headings you "
            "actually saw while reading this page top to bottom (e.g. 'About', 'Bio', "
            "'Skills', 'Portfolio', 'Qualifications', 'Certifications', 'Experience', "
            "'Education', 'Languages', 'Reviews'). This profile likely has SEVERAL distinct "
            "sections that look similar but hold different kinds of data -- read the entire "
            "page and populate every field below from its own matching section; do not stop "
            "after finding the first section that looks like a match for a field. If the page "
            "has an unlabeled introductory bio paragraph with no heading, list it here as "
            "'(unlabeled intro paragraph)' so its presence is auditable. List EVERY heading "
            "you saw: this list is checked against the fields below, and a section listed "
            "here whose field comes back empty marks the extraction as incomplete."
        ),
    )
    location: Optional[str] = Field(
        None,
        description=(
            "The location line exactly as the page shows it (e.g. 'Austin, Texas, United "
            "States'). Null if the page shows none."
        ),
    )
    certifications: List[str] = Field(
        default_factory=list,
        description=(
            "Names of real professional credentials (degrees, licences, institutional or "
            "vendor certifications) explicitly listed on the profile, one string per "
            "credential, as named on the page. Capture ALL of them, wherever on the page they "
            "appear -- do not stop after finding one. Return an EMPTY LIST if none are "
            "listed -- never a sentence explaining that none were found, and never a "
            "placeholder like 'N/A'."
        ),
    )
    skills: List[str] = Field(
        default_factory=list,
        description=(
            "The person's listed skills, specialties, or service offerings -- a platform "
            "'Skills' section (e.g. LinkedIn), a 'Specialties'/'Services' block, or a list of "
            "service-tags/badges shown on the profile, one string per skill/specialty exactly "
            "as named on the page. This is a distinct section from the free-text About/Bio and "
            "from job titles -- only capture what appears in an actual skills/specialties "
            "listing, not something you infer from reading a role description. Capture ALL of "
            "them, wherever on the page they appear. Return an EMPTY LIST if the page has no "
            "such section -- never a sentence explaining its absence."
        ),
    )
    experience: List[ExperienceEntry] = Field(
        default_factory=list,
        description=(
            "One entry per role listed on the profile, in the page's own language. Capture "
            "EVERY role the page lists -- do not stop after the first or the most "
            "prominent; if a company block lists several stacked roles, each is its own "
            "entry. Do not merge several roles into one entry, and never invent one to "
            "fill the list. Empty list if no work history is listed -- never a sentence "
            "about its absence."
        ),
    )
    education: List[EducationEntry] = Field(
        default_factory=list,
        description=(
            "One entry per education record listed on the profile, in the page's own "
            "language. Capture ALL of them, wherever on the page they appear -- do not "
            "stop after finding one. Fill whichever of the entry's optional fields the "
            "page shows and leave the rest null. Empty list if none listed -- never a "
            "sentence about its absence."
        ),
    )
    languages: List[LanguageEntry] = Field(
        default_factory=list,
        description=(
            "One entry per language explicitly listed on the profile, as the page names "
            "them. Capture ALL of them -- a linguist's full language list is the single "
            "most important thing on this page, so do not stop after two or three. "
            "Include a language implied by a platform skill-test badge (e.g. a 'Spanish - "
            "Level 1' badge means language=Spanish, proficiency=Level 1). Only languages "
            "the page actually states -- never infer one from the person's location, their "
            "name, or the language the page is written in. Empty list if none listed."
        ),
    )
    tools_software: List[str] = Field(
        default_factory=list,
        description=(
            "Every tool, software product, platform or application the page names ANYWHERE "
            "-- the skills section, the About text, a role description, a certification "
            "(e.g. 'Pro Tools', 'Adobe Audition', 'Trados Studio', 'memoQ', 'Final Cut Pro', "
            "'Netflix Originator'). One string per tool, as named on the page. Only names "
            "the page literally contains -- never infer a tool from a job title. Empty list "
            "if none are named."
        ),
    )
    courses: List[str] = Field(
        default_factory=list,
        description=(
            "Every course listed on the profile (e.g. a LinkedIn 'Courses' section), one "
            "string per course, as named on the page. Empty list if none."
        ),
    )
    other_sections: List[ProfileSection] = Field(
        default_factory=list,
        description=(
            "Every OTHER section on the page that none of the fields above covers (Projects, "
            "Honors & awards, Volunteering, Publications, Recommendations, Services, "
            "Interests, ...), one entry per section with its full verbatim text. Nothing on "
            "the page should be left out of this extraction. Empty list only if every "
            "section is already covered by a field above."
        ),
    )


class ParallelClient:
    """Client for Parallel's Task Run API -- synchronous, blocking call."""

    def __init__(self, config: Config):
        # Local import: parallel-web is an optional dependency, only needed
        # when PARALLEL_API_KEY is actually configured (see
        # EnrichmentOrchestrator.__init__ -- self.parallel stays None
        # otherwise, so this constructor never runs without the key set).
        from parallel import APITimeoutError, Parallel
        # SDK-internal helper -- the exact task spec `task_run.execute()`
        # builds from `output=LeadProfile`. Tied to the parallel-web==1.3.3
        # pin in requirements.txt; re-check this import on any SDK upgrade.
        from parallel.lib._parsing._task_spec import build_task_spec_param

        self.config = config
        self._client = Parallel(api_key=config.parallel_api_key)
        self._timeout_error = APITimeoutError
        self._task_spec = lambda input_payload: build_task_spec_param(LeadProfile, input_payload)
        self._sleep = time.sleep
        # Only CREATING a run is retried (see enrich_profile) -- a quick POST,
        # so its own short budget. Waiting is bounded separately by
        # parallel_deadline_seconds.
        self._create_policy = RetryPolicy(
            retries=config.max_retries,
            deadline_seconds=_CREATE_DEADLINE_SECONDS,
        )

    def enrich_profile(self, lead: Dict[str, Any], profile_link: str, processor: Optional[str] = None) -> Dict[str, Any]:
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
        # `processor` overrides the configured tier for this one call -- used
        # only for the LinkedIn escalation to "pro" (see orchestrator.py's
        # PARALLEL_STATE_ESCALATE_PRO).
        processor = processor or self.config.parallel_processor
        deadline = time.monotonic() + self.config.parallel_deadline_seconds

        def on_retry(exc: BaseException, attempt: int, delay: float) -> None:
            log.warning(
                "Retry %d/%d creating Parallel run for %s after %.1fs (%s)",
                attempt + 1, self.config.max_retries, profile_link, delay, exc,
            )

        # Create ONCE, then wait on that same run. This used to retry the whole
        # `task_run.execute()` (create + wait) on any transient error -- every
        # retry created a NEW paid run, up to max_retries+1 per lead, including
        # when only the result fetch had hiccupped while the original run was
        # still working. Only the create is retried now, and only before any
        # run_id exists.
        try:
            run_id = retry_with_backoff(
                lambda: self._create_run(input_payload, processor),
                policy=self._create_policy,
                on_retry=on_retry,
                executor=_parallel_executor,
            )
        except RetryExhaustedError as exc:
            cause = exc.cause
            if isinstance(cause, ParallelError):
                raise cause from exc
            raise ParallelError(str(cause) if cause else str(exc)) from exc

        log.info("Parallel run %s created for %s (processor=%s)", run_id, profile_link, processor)
        started = time.monotonic()
        content = self._wait_for_content(run_id, deadline)
        log.info(
            "Parallel enrichment complete for %s (processor=%s, run_id=%s, parallel_wait_ms=%d)",
            profile_link, processor, run_id, int((time.monotonic() - started) * 1000),
        )
        return content

    def _create_run(self, input_payload: Dict[str, Any], processor: str) -> str:
        try:
            run = self._client.task_run.create(
                input=input_payload,
                processor=processor,
                task_spec=self._task_spec(input_payload),
            )
        except Exception as exc:  # noqa: BLE001 -- SDK raises its own exception types
            raise _classify(exc, "Parallel Task Run create failed") from exc
        return run.run_id

    def _wait_for_content(self, run_id: str, deadline: float) -> Dict[str, Any]:
        """Long-poll `result()` for THIS run until it finishes or `deadline`
        (parallel_deadline_seconds -- deliberately generous: a guessed short
        cutoff once kept firing just as real ~150-170s runs were landing).

        Our own loop, not the SDK's `execute()` wait: its 408 handling
        (`timeout_retry_context` in parallel/lib/_time.py, 1.3.3) re-yields
        inside a @contextmanager, which raises RuntimeError instead of
        re-polling -- so a long run's first 408 used to look like a failure
        and trigger a brand-new paid run."""
        failures = 0
        while True:
            remaining = deadline - time.monotonic()
            if remaining <= 0:
                raise ParallelError(
                    f"Parallel run {run_id} not finished within {self.config.parallel_deadline_seconds:.0f}s"
                )
            api_timeout = max(1, min(int(remaining), _RESULT_LONG_POLL_SECONDS))
            try:
                run_result = self._client.task_run.result(run_id, api_timeout=api_timeout, timeout=api_timeout + 30)
            except Exception as exc:  # noqa: BLE001
                if getattr(exc, "status_code", None) == 408 or isinstance(exc, self._timeout_error):
                    continue  # the run is still going -- not a failure
                err = _classify(exc, f"Parallel run {run_id} result fetch failed")
                if isinstance(err, ParallelError):
                    raise err from exc  # permanent 4xx: unknown or rejected run
                failures += 1
                log.warning("Parallel run %s: result fetch failed (%s), re-polling the same run", run_id, exc)
                self._sleep(min(30.0, 2.0 ** min(failures, 5)))
                continue

            run = getattr(run_result, "run", None)
            if getattr(run, "status", None) == "failed":
                # Not permanent: a fresh run on a LATER pass may succeed, and
                # the orchestrator's attempt cap bounds that. Never re-created
                # inside this call.
                raise ParallelError(f"Parallel run {run_id} failed: {getattr(run, 'error', None)}")
            output = getattr(run_result, "output", None)
            content = getattr(output, "content", None) if output is not None else None
            if not isinstance(content, dict):
                # The run completed but produced nothing usable. Not permanent
                # for the same reason as above.
                raise ParallelError("Parallel Task Run returned no usable content")
            return content
