"""Abstract base class for all deterministic platform parsers."""

from __future__ import annotations

from abc import ABC, abstractmethod
from typing import Any, Dict


class BaseParser(ABC):
    """Abstract parser interface."""

    @abstractmethod
    def parse(self, profile_link: str, raw_data: Any) -> Dict[str, Any]:
        """Parse raw scraped content into a dictionary matching canonical schema fields.

        Only return fields that were actually present/extracted (omit missing ones).
        """
        pass
