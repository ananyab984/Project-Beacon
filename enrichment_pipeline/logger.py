"""Structured logger module for the Production Enrichment Pipeline."""

from __future__ import annotations

import logging
import sys
from typing import Optional


def configure_logging(level: str = "INFO", log_file: Optional[str] = None) -> None:
    """Configure root logger with console and optional file handlers."""
    numeric_level = getattr(logging, level.upper(), logging.INFO)
    root = logging.getLogger()
    root.setLevel(numeric_level)
    root.handlers.clear()

    formatter = logging.Formatter(
        "[%(asctime)s] %(levelname)-7s [%(name)s] %(message)s",
        datefmt="%H:%M:%S",
    )

    console = logging.StreamHandler(sys.stdout)
    console.setLevel(numeric_level)
    console.setFormatter(formatter)
    root.addHandler(console)

    if log_file:
        fh = logging.FileHandler(log_file, encoding="utf-8")
        fh.setLevel(numeric_level)
        fh.setFormatter(formatter)
        root.addHandler(fh)


def get_logger(name: str) -> logging.Logger:
    """Return a logger instance for a given module."""
    return logging.getLogger(name)
