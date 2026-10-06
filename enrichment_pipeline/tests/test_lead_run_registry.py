"""One /enrich per lead at a time; a repeat after it finished gets the stored
result instead of a second paid waterfall (main.py's LeadRunRegistry)."""

from __future__ import annotations

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from main import LeadRunRegistry


class Clock:
    def __init__(self):
        self.t = 0.0

    def __call__(self):
        return self.t


def test_a_repeat_while_running_is_busy_and_after_finishing_gets_the_stored_result():
    reg = LeadRunRegistry(now=Clock())
    assert reg.begin("lead-1") == ("run", None)
    assert reg.begin("lead-1") == ("busy", None)
    assert reg.begin("lead-2") == ("run", None), "other leads are unaffected"
    reg.finish("lead-1", {"lead": {"Email_Address": "a@b.c"}})
    assert reg.begin("lead-1") == ("cached", {"lead": {"Email_Address": "a@b.c"}})
    assert reg.begin("lead-1") == ("run", None), "a stored result is handed out once"


def test_a_failed_run_is_not_stored_so_a_retry_runs_again():
    reg = LeadRunRegistry(now=Clock())
    reg.begin("lead-1")
    reg.finish("lead-1")  # exception path: no result
    assert reg.begin("lead-1") == ("run", None)


def test_stored_results_expire_and_are_capped():
    clock = Clock()
    reg = LeadRunRegistry(ttl_seconds=60, max_entries=2, now=clock)
    for lead in ("a", "b", "c"):
        reg.begin(lead)
        reg.finish(lead, {"lead": lead})
    assert reg.begin("a") == ("run", None), "oldest evicted past max_entries"
    clock.t = 61
    assert reg.begin("b") == ("run", None), "expired after the TTL"
