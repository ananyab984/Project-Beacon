"""Small, reusable helpers: URL validation, missing-value detection, timing.

These are intentionally dependency-free and side-effect-free so they can be
unit-tested and reused by any module (or a future Unipile module).
"""

from __future__ import annotations

import re
import time
from contextlib import contextmanager
from typing import Any, Iterator
from urllib.parse import urlsplit, urlunsplit

# The dataset uses this literal string as a placeholder for "no value".
# It must be treated exactly like a null / empty cell.
MISSING_PLACEHOLDER = "[Missing Input]"

# Matches a LinkedIn *personal* profile URL: linkedin.com/in/<slug>.
# Allows optional scheme, subdomains (www., in., etc.), trailing slash,
# and query/fragment. It deliberately does NOT match /company/, /school/, etc.
_LINKEDIN_IN_RE = re.compile(
    r"^\s*https?://([a-z0-9-]+\.)*linkedin\.com/in/[^/?#\s]+/?",
    re.IGNORECASE,
)


def is_missing(value: Any) -> bool:
    """Return True for None, NaN, blank strings, or the ``[Missing Input]`` token."""
    if value is None:
        return True
    # pandas represents empty cells as float('nan'); nan != nan.
    if isinstance(value, float) and value != value:
        return True
    text = str(value).strip()
    if not text:
        return True
    return text == MISSING_PLACEHOLDER


def clean_str(value: Any) -> str:
    """Return a trimmed string, or "" if the value is considered missing."""
    if is_missing(value):
        return ""
    return str(value).strip()


def is_valid_linkedin_url(url: Any) -> bool:
    """Return True only for a well-formed ``linkedin.com/in/...`` profile URL."""
    if is_missing(url):
        return False
    return bool(_LINKEDIN_IN_RE.match(str(url).strip()))


def normalize_url(url: str) -> str:
    """Produce a canonical form of a profile URL for deduplication.

    Lowercases host, drops query/fragment, and removes a trailing slash so that
    ``.../in/jane/`` and ``.../in/jane`` are treated as the same profile.
    """
    parts = urlsplit(str(url).strip())
    path = parts.path.rstrip("/")
    return urlunsplit(
        (parts.scheme.lower(), parts.netloc.lower(), path, "", "")
    )


def safe_get(data: Any, *keys: str, default: Any = None) -> Any:
    """Safely walk nested dict keys, returning ``default`` if any step is absent.

    Example: ``safe_get(resp, "current_company", "name")``.
    """
    current = data
    for key in keys:
        if isinstance(current, dict) and key in current:
            current = current[key]
        else:
            return default
    return current if current is not None else default


@contextmanager
def timed() -> Iterator["_Elapsed"]:
    """Context manager measuring wall-clock seconds spent in the block.

    Usage::

        with timed() as t:
            do_work()
        print(t.seconds)
    """
    marker = _Elapsed()
    start = time.perf_counter()
    try:
        yield marker
    finally:
        marker.seconds = round(time.perf_counter() - start, 2)


class _Elapsed:
    """Mutable holder for elapsed seconds populated by :func:`timed`."""

    seconds: float = 0.0
