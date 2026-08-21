"""Shared helper for building `build_context()` output across the
Tavily-Extract-based text parsers (ADA, ATA, ATAA, Bodalgo, generic) -- they
all get the same raw shape (`{"raw_content": <full-page markdown>}`) from the
same provider, so the boilerplate-stripping logic lives here once instead of
being reinvented per parser.
"""

from __future__ import annotations

import re
from typing import List, Optional

# Generic template boilerplate patterns common to any site-template scrape,
# regardless of platform -- confirmed real against this codebase's own
# captured samples (Bodalgo's raw scrape carried a full GDPR cookie table
# naming individual tracking cookies; ADA's carried a full nav/login widget).
# These target the boilerplate *pattern*, not a site-specific marker string,
# so they apply even to platforms with no captured sample to design against
# (ATA/ATAA).
_GENERIC_JUNK_PATTERNS = [
    # Cookie/GDPR consent blocks, often a multi-line table naming every
    # tracking cookie by name -- strip from the first mention onward.
    r"(?is)\b(cookie consent|we use cookies|this website uses cookies|manage (your )?cookie preferences)\b.*",
    # Login-form field labels.
    r"(?im)^\s*(username|password|sign in|log in|log out)\s*:?\s*$",
    # Language-switcher link lists (3+ language names in a row).
    r"(?i)\b(Deutsch|Espa[nñ]ol|Fran[cç]ais|Italiano|Nederlands|Polski|Portugu[eê]s|Русский|T[uü]rk[cç]e)\b"
    r"(\s*[|/]\s*\b(Deutsch|Espa[nñ]ol|Fran[cç]ais|Italiano|Nederlands|Polski|Portugu[eê]s|Русский|T[uü]rk[cç]e)\b){2,}",
    # WordPress Gravity Forms' honeypot marker -- a fixed, well-known string
    # (confirmed real on a live ATA member-directory page: a whole embedded
    # "contact this member" form -- CAPTCHA, consent checkbox, priority
    # dropdown -- sat between two real content sections). Strip from the
    # marker up to the next markdown heading, since real content reliably
    # resumes there.
    r"(?is)This field is for validation purposes and should be left unchanged\.?.*?(?=#{1,6}\s|\Z)",
]


# The markdown heading marking where the actual page content starts.
# Confirmed against real captured/live samples for ADA, Bodalgo, and ATA:
# every nav menu / login widget / language-switcher link list sits BEFORE
# the person's own name heading, never after -- and this exact heading is
# already how `_extract_full_name` in the ADA/Bodalgo parsers finds the name
# today, so it's an established, reliable anchor point, not a new
# assumption. A real name heading is plain text (H1, H2, or H3 depending on
# the site); a site logo wrapped in a heading (confirmed real on a live ATAA
# page: `# [![Image: ATAA logo]...]`) is skipped since its "heading text" is
# just a markdown link/image, not a name.
_HEADING_LINE_RE = re.compile(r"(?m)^#{1,3}\s+(.*\S)")


def _content_start(text: str) -> Optional[int]:
    for match in _HEADING_LINE_RE.finditer(text):
        heading_text = match.group(1).strip()
        if heading_text.startswith(("[", "!")):
            continue  # logo/image-wrapped heading, not a name
        return match.start()
    return None


def strip_page_boilerplate(
    text: str, cutoff_markers: Optional[List[str]] = None, max_chars: int = 2000
) -> Optional[str]:
    """Trim a raw Tavily-Extract page blob down to its actual bio content.

    1. Start at the first real name heading (skipping a logo/image-wrapped
       one) -- drops the nav/login/language-switcher chrome that precedes it.
    2. Cut at the first of `cutoff_markers` found, if given -- reuses
       whatever that platform's own `_extract_body` already knows (e.g.
       ADA's "bottom of page", Bodalgo's "You are about to flag this
       profile"), both confirmed against real captured data to sit right
       before the noisy footer/cookie block.
    3. Strip the generic template patterns above, which apply regardless of
       whether a site-specific cutoff marker is known.
    4. Collapse whitespace and cap the length.

    Returns None if nothing meaningful survives (e.g. empty input, or a page
    that was entirely boilerplate).
    """
    if not text:
        return None

    body = text
    start = _content_start(body)
    if start is not None:
        body = body[start:]

    if cutoff_markers:
        end = len(body)
        for marker in cutoff_markers:
            pos = body.find(marker)
            if pos != -1:
                end = min(end, pos)
        body = body[:end]

    for pattern in _GENERIC_JUNK_PATTERNS:
        body = re.sub(pattern, " ", body)

    body = re.sub(r"\s+", " ", body).strip()
    if not body:
        return None

    if len(body) > max_chars:
        body = body[:max_chars].rsplit(" ", 1)[0] + "..."
    return body
