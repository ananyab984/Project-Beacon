"""Tests for _looks_garbled (its use in _map_all_fields_via_groq is covered in
test_groq_profile_mapping.py) --
the recovery path for leads whose Services value was shredded from a JSON
object (e.g. `[{"id":..., "task":"Quality Control", ...}]`) into individual
garbage tokens ("rate", "10", "{id", "it-IT}") before normalizeServices.ts
learned to parse that shape. A plain "is Services empty" check leaves those
leads stuck forever, since any non-empty value (however bogus) reads as
"already resolved" to both the deterministic keyword scan and this stage.

Run: cd enrichment_pipeline && source .venv/bin/activate && pytest tests/test_services_garbled_recovery.py
"""

from __future__ import annotations

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from orchestrator import _looks_garbled


def test_looks_garbled_detects_the_real_shredded_payload():
    shredded = (
        "[{id, 1788358696814, rate, 10, task, Quality Control, service, dub, "
        "min_rate, 8, source_language, en-US, target_language, it-IT}, "
        "{id, 1788358845347, 3, Voice Generation, 2, it-IT}]"
    )
    assert _looks_garbled(shredded) is True


def test_looks_garbled_is_false_for_real_service_names():
    assert _looks_garbled("Subtitling, Dubbing, Quality Control") is False


def test_looks_garbled_is_false_for_empty_or_missing():
    assert _looks_garbled(None) is False
    assert _looks_garbled("") is False
