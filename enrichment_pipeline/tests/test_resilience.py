"""Tests for the shared retry/backoff + wall-clock-deadline utility
(core/resilience.py).

Run: cd enrichment_pipeline && source .venv/bin/activate && pytest tests/test_resilience.py
"""

from __future__ import annotations

import os
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import pytest

from core.resilience import RetryExhaustedError, RetryPolicy, TransientError, retry_with_backoff


def test_default_contract_is_five_attempts_with_doubling_delay():
    delays: list[float] = []
    calls = {"n": 0}

    def fn():
        calls["n"] += 1
        raise TransientError("boom", status_code=500)

    # deadline_seconds set very high so it never interferes -- this test is
    # only about attempt count + delay sequence.
    policy = RetryPolicy(sleep=lambda s: delays.append(s), deadline_seconds=999)

    with pytest.raises(RetryExhaustedError):
        retry_with_backoff(fn, policy=policy)

    assert calls["n"] == 5, "expected 5 total attempts (1 initial + 4 retries)"
    assert delays == [1.0, 2.0, 4.0, 8.0], "expected 1s/2s/4s/8s delay sequence"


def test_non_retryable_error_short_circuits_immediately():
    calls = {"n": 0}

    def fn():
        calls["n"] += 1
        raise ValueError("not a TransientError -- not retryable by default")

    def never_sleep(_delay: float):
        raise AssertionError("sleep should never be called for a non-retryable error")

    policy = RetryPolicy(sleep=never_sleep)

    with pytest.raises(ValueError):
        retry_with_backoff(fn, policy=policy)

    assert calls["n"] == 1, "a non-retryable error must not be retried"


def test_succeeds_without_retrying_on_first_success():
    calls = {"n": 0}

    def fn():
        calls["n"] += 1
        return "ok"

    assert retry_with_backoff(fn) == "ok"
    assert calls["n"] == 1


def test_deadline_exceeded_between_attempts_cuts_sequence_short():
    calls = {"n": 0}

    def fn():
        calls["n"] += 1
        raise TransientError("boom", status_code=500)

    # base_delay of 50ms alone exceeds the 30ms deadline -- must stop well
    # before all 5 attempts run.
    policy = RetryPolicy(deadline_seconds=0.03, base_delay_seconds=0.05)

    with pytest.raises(RetryExhaustedError):
        retry_with_backoff(fn, policy=policy)

    assert calls["n"] < 5, f"expected the deadline to cut the sequence short, got {calls['n']} attempts"


def test_deadline_actually_bounds_a_slow_in_flight_call():
    """Confirms ThreadPoolExecutor(...).result(timeout=...) itself enforces
    the deadline against a call that's genuinely still running -- not just
    against the sleeps between attempts."""

    def fn():
        time.sleep(1.0)  # much slower than the deadline below
        return "too slow"

    policy = RetryPolicy(deadline_seconds=0.05, retries=0)

    started = time.monotonic()
    with pytest.raises(RetryExhaustedError):
        retry_with_backoff(fn, policy=policy)
    elapsed = time.monotonic() - started

    assert elapsed < 0.5, f"expected the caller to stop waiting near the 0.05s deadline, took {elapsed:.2f}s"


def test_retry_after_is_folded_into_bounded_delay_not_added_on_top():
    delays: list[float] = []

    def fn():
        raise TransientError("rate limited", status_code=429, retry_after=100.0)

    # A huge Retry-After (100s) must be capped by the remaining deadline
    # budget, not slept in full -- fixes the old BrightData/Clay bug where
    # Retry-After slept uncapped, entirely outside the backoff schedule.
    policy = RetryPolicy(deadline_seconds=0.05, base_delay_seconds=0.01, sleep=lambda s: delays.append(s))

    with pytest.raises(RetryExhaustedError):
        retry_with_backoff(fn, policy=policy)

    assert delays, "expected at least one sleep to have been recorded"
    assert all(d <= 0.05 for d in delays), f"expected every sleep to be capped by the deadline budget, got {delays}"


def test_retry_exhausted_error_carries_the_real_cause():
    original = TransientError("boom", status_code=503)

    def fn():
        raise original

    policy = RetryPolicy(retries=0, sleep=lambda _s: None)

    with pytest.raises(RetryExhaustedError) as exc_info:
        retry_with_backoff(fn, policy=policy)

    assert exc_info.value.cause is original
