"""Readability scoring — Flesch Reading Ease & Flesch-Kincaid Grade Level."""

from __future__ import annotations

import re


def _count_syllables(word: str) -> int:
    w = word.lower().strip(".:;!?,\"'()")
    if not w:
        return 0
    if len(w) <= 3:
        return 1
    w = re.sub(r"(?:[eE]$|es$|ed$)", "", w)
    matches = re.findall(r"[aeiouy]+", w)
    return max(1, len(matches))


def flesch_reading_ease(text: str) -> float:
    """Compute Flesch Reading Ease (0-100; higher = easier to read)."""
    words = re.findall(r"\b\w+\b", text)
    sentences = re.split(r"[.!?]+", text)
    sentences = [s.strip() for s in sentences if s.strip()]

    n_words = len(words)
    n_sentences = max(1, len(sentences))
    if n_words == 0:
        return 0.0

    n_syllables = sum(_count_syllables(w) for w in words)
    score = 206.835 - (1.015 * (n_words / n_sentences)) - (84.6 * (n_syllables / n_words))
    return max(0.0, min(100.0, score))


def flesch_kincaid_grade(text: str) -> float:
    """Compute Flesch-Kincaid Grade Level (~0-18; lower = easier to read)."""
    words = re.findall(r"\b\w+\b", text)
    sentences = re.split(r"[.!?]+", text)
    sentences = [s.strip() for s in sentences if s.strip()]

    n_words = len(words)
    n_sentences = max(1, len(sentences))
    if n_words == 0:
        return 0.0

    n_syllables = sum(_count_syllables(w) for w in words)
    score = (0.39 * (n_words / n_sentences)) + (11.8 * (n_syllables / n_words)) - 15.59
    return max(0.0, score)
