"""Structured logging setup shared across the pipeline.

Every module obtains its logger via :func:`get_logger`, and the application
entry points call :func:`configure_logging` once at startup. Logs go to the
console and, optionally, to a rotating-friendly log file.
"""

from __future__ import annotations

import logging
import sys

_CONFIGURED = False

_LOG_FORMAT = "%(asctime)s | %(levelname)-8s | %(name)s | %(message)s"
_DATE_FORMAT = "%Y-%m-%d %H:%M:%S"


def configure_logging(level: str = "INFO", log_file: str | None = None) -> None:
    """Configure the root logger once for the whole process.

    Args:
        level: Logging level name (e.g. "INFO", "DEBUG").
        log_file: Optional path; when given, logs are also written there.
    """
    global _CONFIGURED

    root = logging.getLogger()
    numeric_level = getattr(logging, level.upper(), logging.INFO)
    root.setLevel(numeric_level)

    # Avoid duplicate handlers if configure_logging is called more than once.
    for handler in list(root.handlers):
        root.removeHandler(handler)

    formatter = logging.Formatter(_LOG_FORMAT, datefmt=_DATE_FORMAT)

    console = logging.StreamHandler(stream=sys.stdout)
    console.setFormatter(formatter)
    root.addHandler(console)

    if log_file:
        file_handler = logging.FileHandler(log_file, encoding="utf-8")
        file_handler.setFormatter(formatter)
        root.addHandler(file_handler)

    _CONFIGURED = True


def get_logger(name: str) -> logging.Logger:
    """Return a named logger, applying a sane default config if needed."""
    if not _CONFIGURED:
        configure_logging()
    return logging.getLogger(name)
