"""Recruiter edit logging & similarity metric calculator."""

from __future__ import annotations

import difflib
from typing import Any, Dict

from logger import get_logger

log = get_logger(__name__)


def log_recruiter_edit(draft_id: str, original_body: str, edited_body: str) -> Dict[str, Any]:
    """Calculate similarity ratio and edit distance between AI draft and recruiter edited text."""
    orig = original_body or ""
    edited = edited_body or ""

    matcher = difflib.SequenceMatcher(None, orig, edited)
    similarity = matcher.ratio()  # 1.0 = identical, 0.0 = completely changed
    edit_pct = round((1.0 - similarity) * 100, 2)

    result = {
        "draft_id": draft_id,
        "original_length": len(orig),
        "edited_length": len(edited),
        "similarity_score": round(similarity, 4),
        "edit_percentage": edit_pct,
        "was_edited": edit_pct > 0.0,
    }

    log.info("Recruiter edit logged for %s: edit_pct=%.2f%% (similarity=%.4f)", draft_id, edit_pct, similarity)
    return result
