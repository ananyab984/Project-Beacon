"""ENRICHMENT_CONCURRENCY sizes every per-lead pool (pools are built at import
time, so each case imports the modules in a fresh interpreter)."""

from __future__ import annotations

import json
import os
import subprocess
import sys

PIPELINE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

PROBE = """
import json, orchestrator, providers.parallel_client as pc, core.resilience as r
print(json.dumps({
    "n": r.ENRICHMENT_CONCURRENCY,
    "resilience": r._executor._max_workers,
    "tier_overlap": orchestrator._tier_overlap_executor._max_workers,
    "parallel": pc._parallel_executor._max_workers,
}))
"""


def _sizes(value):
    env = {k: v for k, v in os.environ.items() if k != "ENRICHMENT_CONCURRENCY"}
    if value is not None:
        env["ENRICHMENT_CONCURRENCY"] = value
    out = subprocess.run(
        [sys.executable, "-c", PROBE], cwd=PIPELINE_DIR, env=env, capture_output=True, text=True, check=True
    )
    return json.loads(out.stdout.strip().splitlines()[-1])


def test_default_is_8_plus_single_add_headroom():
    assert _sizes(None) == {"n": 8, "resilience": 24, "tier_overlap": 16, "parallel": 16}


def test_pools_follow_the_setting():
    assert _sizes("32") == {"n": 32, "resilience": 72, "tier_overlap": 40, "parallel": 40}


def test_out_of_range_or_garbage_is_clamped():
    assert _sizes("500")["n"] == 128
    assert _sizes("0")["n"] == 1
    assert _sizes("lots")["n"] == 8
