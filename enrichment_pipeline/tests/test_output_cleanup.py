"""Tests for main.py's _cleanup_old_output_files -- the retention cleanup for
the CLI batch mode's output/ directory (duplicate_review_queue.json and
similar), which holds full scraped-profile PII with no prior cleanup.

Run: cd enrichment_pipeline && source .venv/bin/activate && pytest tests/test_output_cleanup.py
"""

from __future__ import annotations

import os
import sys
import tempfile
import time

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from main import _cleanup_old_output_files  # noqa: E402


def _touch(path: str, age_days: float) -> None:
    with open(path, "w", encoding="utf-8") as fh:
        fh.write("{}")
    old_time = time.time() - (age_days * 86400)
    os.utime(path, (old_time, old_time))


def test_removes_files_older_than_retention_window():
    with tempfile.TemporaryDirectory() as tmpdir:
        old_file = os.path.join(tmpdir, "old_output.json")
        _touch(old_file, age_days=10)

        _cleanup_old_output_files(tmpdir, retention_days=7)

        assert not os.path.exists(old_file), "a file older than the retention window must be removed"


def test_keeps_files_within_retention_window():
    with tempfile.TemporaryDirectory() as tmpdir:
        recent_file = os.path.join(tmpdir, "recent_output.json")
        _touch(recent_file, age_days=1)

        _cleanup_old_output_files(tmpdir, retention_days=7)

        assert os.path.exists(recent_file), "a file within the retention window must NOT be removed"


def test_missing_directory_is_a_silent_noop():
    # Must not raise -- the output/ directory may not exist yet on a fresh checkout.
    _cleanup_old_output_files("/tmp/definitely_does_not_exist_beacon_test", retention_days=7)


if __name__ == "__main__":
    test_removes_files_older_than_retention_window()
    print("PASS test_removes_files_older_than_retention_window")
    test_keeps_files_within_retention_window()
    print("PASS test_keeps_files_within_retention_window")
    test_missing_directory_is_a_silent_noop()
    print("PASS test_missing_directory_is_a_silent_noop")
    print("All 3 tests passed")
