"""Tests for the BaseParser abstract interface."""

from __future__ import annotations

import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))), "enrichment_pipeline"))

import pytest

from parsers.base import BaseParser


def test_cannot_instantiate_base_parser_directly():
    with pytest.raises(TypeError):
        BaseParser()


def test_subclass_missing_parse_cannot_be_instantiated():
    class IncompleteParser(BaseParser):
        pass

    with pytest.raises(TypeError):
        IncompleteParser()


def test_subclass_implementing_parse_can_be_instantiated_and_called():
    class ConcreteParser(BaseParser):
        def parse(self, profile_link, raw_data):
            return {"Profile_Link": profile_link, "raw": raw_data}

    parser = ConcreteParser()
    result = parser.parse("https://example.com/p", {"k": "v"})
    assert result == {"Profile_Link": "https://example.com/p", "raw": {"k": "v"}}


def test_base_parser_is_abstract_base_class():
    assert BaseParser.__abstractmethods__ == frozenset({"parse"})
