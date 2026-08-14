"""Write the enriched DataFrame back out to Excel."""

from __future__ import annotations

import pandas as pd

from logger import get_logger

log = get_logger(__name__)


def write_enriched(df: pd.DataFrame, path: str) -> None:
    """Write ``df`` to ``path`` as an .xlsx workbook.

    Raises:
        Exception: propagates any pandas/openpyxl write error to the caller.
    """
    log.info("Writing enriched output: %s (%d rows, %d columns)", path, len(df), len(df.columns))
    df.to_excel(path, index=False, engine="openpyxl")
    log.info("Wrote enriched output successfully: %s", path)
