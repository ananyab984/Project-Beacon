"""Read recruiter profiles from the input Excel file."""

from __future__ import annotations

import pandas as pd

from logger import get_logger

log = get_logger(__name__)

PROFILE_LINK_COLUMN = "Profile_Link"


def read_profiles(path: str) -> pd.DataFrame:
    """Load the input workbook into a DataFrame.

    Raises:
        FileNotFoundError: if ``path`` does not exist.
        ValueError: if the required ``Profile_Link`` column is absent.
    """
    log.info("Reading input Excel: %s", path)
    df = pd.read_excel(path, engine="openpyxl")

    if PROFILE_LINK_COLUMN not in df.columns:
        raise ValueError(
            f"Input is missing required column {PROFILE_LINK_COLUMN!r}. "
            f"Found columns: {list(df.columns)}"
        )

    log.info("Loaded %d rows, %d columns from %s", len(df), len(df.columns), path)
    return df
