"""Shared synchronous retry/backoff + wall-clock-deadline utility for every
external HTTP call in this pipeline (BrightData, Tavily, Clay, Claude
fallback, Groq dedup) -- mirrors server/src/lib/retryWithBackoff.ts's
contract (5 total attempts, 1s/2s/4s/8s doubling) without needing async.

Deliberately synchronous: FastAPI already runs plain `def` route handlers in
a bounded background thread pool automatically (Starlette's default
behavior), so a blocking call inside one does not stall the event loop for
other concurrent requests -- that safety property doesn't need to be
rebuilt here via asyncio/httpx. The 15s wall-clock deadline below is
enforced by bounding each attempt with a shared ThreadPoolExecutor and
`Future.result(timeout=...)` instead.

Caveat, stated plainly rather than glossed over: a `.result(timeout=...)`
timeout stops the CALLER from waiting -- it does not kill the submitted
thread. The underlying call may keep running in the background (bounded by
its own per-request socket timeout, see Config.request_timeout) until it
finishes on its own, even though this function has already raised
RetryExhaustedError and moved on. This is the same fundamental limitation
Promise.race has in JS without a real cancellation signal; Python's
`requests` library and threads offer no clean cross-thread abort primitive
for a call already in flight.
"""

from __future__ import annotations

import time
from concurrent.futures import ThreadPoolExecutor
from concurrent.futures import TimeoutError as FutureTimeoutError
from dataclasses import dataclass
from typing import Callable, Optional, TypeVar

from logger import get_logger

log = get_logger(__name__)

T = TypeVar("T")

# Sized for "triggered per-lead or in small batches," not public traffic --
# revisit if this pipeline's concurrent load ever grows materially. A thread
# left running past its own deadline (see module docstring) holds a slot
# here until it finishes on its own; under a sustained upstream outage,
# abandoned-but-still-running threads could pile up and new work would queue
# behind them even though any single call's own deadline is still honored.
_executor = ThreadPoolExecutor(max_workers=20, thread_name_prefix="resilience")


class TransientError(Exception):
    """Signal for a retryable failure (429, 5xx, timeout, network error).
    Provider clients raise this (not their own public error type) for
    anything retry_with_backoff should retry."""

    def __init__(self, message: str, status_code: Optional[int] = None, retry_after: Optional[float] = None):
        super().__init__(message)
        self.message = message
        self.status_code = status_code
        self.retry_after = retry_after


class RetryExhaustedError(Exception):
    """Raised when every attempt fails, or the wall-clock deadline elapses
    before the sequence settles -- carries the last real error as `.cause`."""

    def __init__(self, message: str, cause: Optional[BaseException] = None):
        super().__init__(message)
        self.cause = cause


def _default_is_retryable(err: BaseException) -> bool:
    return isinstance(err, TransientError)


def _default_retry_after(err: BaseException) -> Optional[float]:
    return getattr(err, "retry_after", None)


@dataclass(frozen=True)
class RetryPolicy:
    """Mirrors server/src/lib/retryWithBackoff.ts's RetryOptions.

    retries: attempts AFTER the first (default 4 -> 5 total, matching the
      Node contract this pipeline is kept consistent with).
    base_delay_seconds: delay before the first retry, doubling each
      subsequent one (default 1.0 -> 1s/2s/4s/8s).
    deadline_seconds: hard wall-clock cap across the WHOLE sequence (all
      attempts + backoff sleeps), not a per-attempt timeout.
    is_retryable: classifies which exceptions are worth retrying.
    retry_after_seconds: extracts a Retry-After hint from a caught error, if
      any -- folded into (capped by, not added on top of) the same
      deadline-bounded sleep, closing the previous bug where this slept
      outside and uncapped relative to the backoff budget.
    sleep / now: injectable for tests (default time.sleep / time.monotonic).
    """

    retries: int = 4
    base_delay_seconds: float = 1.0
    deadline_seconds: float = 15.0
    is_retryable: Callable[[BaseException], bool] = _default_is_retryable
    retry_after_seconds: Callable[[BaseException], Optional[float]] = _default_retry_after
    sleep: Callable[[float], None] = time.sleep
    now: Callable[[], float] = time.monotonic


def retry_with_backoff(
    fn: Callable[[], T],
    *,
    policy: RetryPolicy = RetryPolicy(),
    on_retry: Optional[Callable[[BaseException, int, float], None]] = None,
    on_exhausted: Optional[Callable[[Optional[BaseException]], None]] = None,
) -> T:
    """Runs fn() with up to `policy.retries` retries (1s/2s/4s/8s doubling by
    default), bounded overall by `policy.deadline_seconds` measured from the
    first attempt -- not just summed sleep durations. A non-retryable error
    (per `policy.is_retryable`) re-raises immediately, burning no attempt."""
    deadline = policy.now() + policy.deadline_seconds
    last_err: Optional[BaseException] = None

    for attempt in range(policy.retries + 1):
        remaining = deadline - policy.now()
        if remaining <= 0:
            break  # budget already gone -- don't start a new attempt

        future = _executor.submit(fn)
        try:
            return future.result(timeout=remaining)
        except FutureTimeoutError as exc:
            # Deadline hit mid-attempt: surface immediately, matching "abort
            # and surface to the client immediately" -- don't wait for
            # whatever's left of this attempt, and don't start another one.
            last_err = exc
            break
        except Exception as exc:  # noqa: BLE001 -- must catch anything fn() raises
            last_err = exc
            if not policy.is_retryable(exc):
                raise
            if attempt >= policy.retries:
                break
            remaining = deadline - policy.now()
            if remaining <= 0:
                break
            delay = min(policy.base_delay_seconds * (2**attempt), remaining)
            retry_after = policy.retry_after_seconds(exc)
            if retry_after:
                delay = min(max(delay, retry_after), remaining)
            if on_retry:
                on_retry(exc, attempt, delay)
            policy.sleep(delay)

    if on_exhausted:
        on_exhausted(last_err)
    raise RetryExhaustedError(f"All attempts failed or deadline exceeded: {last_err}", last_err)
