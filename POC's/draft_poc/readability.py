"""Dependency-free readability metrics (Flesch Reading Ease + Flesch-Kincaid).

We compute these directly rather than pulling in textstat/nltk — the formulas
are simple, need no data downloads, and this keeps the POC lightweight and
portable (notably it sidesteps Python 3.14's safe-path issues with nltk).

  Flesch Reading Ease = 206.835 − 1.015·(words/sentences) − 84.6·(syllables/words)
  Flesch-Kincaid Grade = 0.39·(words/sentences) + 11.8·(syllables/words) − 15.59

Syllable counting is a well-known vowel-group heuristic; it is approximate
(good enough for a quality signal, not a linguistics tool).
"""

from __future__ import annotations

import re

_WORD_RE = re.compile(r"[A-Za-z]+")
_SENT_RE = re.compile(r"[.!?]+")
_VOWELS = "aeiouy"


def _count_syllables(word: str) -> int:
    word = word.lower()
    if not word:
        return 0
    count = 0
    prev_vowel = False
    for ch in word:
        is_vowel = ch in _VOWELS
        if is_vowel and not prev_vowel:
            count += 1
        prev_vowel = is_vowel
    # silent trailing 'e'
    if word.endswith("e") and count > 1:
        count -= 1
    return max(1, count)


def _strip_urls(text: str) -> str:
    return re.sub(r"https?://\S+|\S+@\S+", "", text)


def _counts(text: str) -> tuple[int, int, int]:
    clean = _strip_urls(text)
    words = _WORD_RE.findall(clean)
    n_words = len(words)
    n_sentences = max(1, len([s for s in _SENT_RE.split(clean) if s.strip()]))
    n_syllables = sum(_count_syllables(w) for w in words)
    return n_words, n_sentences, n_syllables


def flesch_reading_ease(text: str) -> float:
    w, s, sy = _counts(text)
    if w == 0:
        return 0.0
    return 206.835 - 1.015 * (w / s) - 84.6 * (sy / w)


def flesch_kincaid_grade(text: str) -> float:
    w, s, sy = _counts(text)
    if w == 0:
        return 0.0
    return 0.39 * (w / s) + 11.8 * (sy / w) - 15.59
