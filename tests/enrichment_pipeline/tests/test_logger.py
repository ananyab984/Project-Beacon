"""Tests for the root-logger configuration helper and logger factory."""

from __future__ import annotations

import logging
import os
import sys

import pytest

sys.path.insert(0, os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))), "enrichment_pipeline"))

from logger import configure_logging, get_logger


@pytest.fixture(autouse=True)
def restore_root_logger():
    """configure_logging mutates the process-global root logger -- snapshot
    and restore it so these tests never leak handlers into other test files."""
    root = logging.getLogger()
    original_handlers = list(root.handlers)
    original_level = root.level
    yield
    for handler in root.handlers:
        try:
            handler.close()
        except Exception:
            pass
    root.handlers.clear()
    root.handlers.extend(original_handlers)
    root.setLevel(original_level)


def test_get_logger_returns_named_logger():
    logger = get_logger("core.dedup")
    assert isinstance(logger, logging.Logger)
    assert logger.name == "core.dedup"


def test_get_logger_same_name_returns_same_instance():
    assert get_logger("some.module") is get_logger("some.module")


def test_configure_logging_default_level_is_info():
    configure_logging()
    assert logging.getLogger().level == logging.INFO


def test_configure_logging_sets_custom_level():
    configure_logging(level="DEBUG")
    assert logging.getLogger().level == logging.DEBUG


def test_configure_logging_level_is_case_insensitive():
    configure_logging(level="warning")
    assert logging.getLogger().level == logging.WARNING


def test_configure_logging_unrecognized_level_falls_back_to_info():
    configure_logging(level="NOT_A_REAL_LEVEL")
    assert logging.getLogger().level == logging.INFO


def test_configure_logging_clears_existing_handlers():
    root = logging.getLogger()
    root.addHandler(logging.NullHandler())
    assert len(root.handlers) >= 1

    configure_logging()

    # Only the fresh console handler configure_logging installs should remain.
    assert len(root.handlers) == 1
    assert isinstance(root.handlers[0], logging.StreamHandler)


def test_configure_logging_console_handler_writes_to_stdout():
    configure_logging()
    console_handler = logging.getLogger().handlers[0]
    assert console_handler.stream is sys.stdout


def test_configure_logging_without_log_file_adds_only_console_handler():
    configure_logging()
    assert len(logging.getLogger().handlers) == 1


def test_configure_logging_with_log_file_adds_file_handler_and_writes_records(tmp_path):
    log_file = tmp_path / "pipeline.log"
    configure_logging(level="INFO", log_file=str(log_file))

    root = logging.getLogger()
    assert len(root.handlers) == 2
    assert any(isinstance(h, logging.FileHandler) for h in root.handlers)

    get_logger("test.logger").info("hello from test")

    assert log_file.exists()
    content = log_file.read_text(encoding="utf-8")
    assert "hello from test" in content
    assert "INFO" in content
    assert "test.logger" in content


def test_configure_logging_formatter_includes_level_name_and_logger_name(tmp_path):
    log_file = tmp_path / "fmt.log"
    configure_logging(level="INFO", log_file=str(log_file))
    get_logger("my.module").warning("careful")

    content = log_file.read_text(encoding="utf-8")
    assert "WARNING" in content
    assert "[my.module]" in content
    assert "careful" in content
