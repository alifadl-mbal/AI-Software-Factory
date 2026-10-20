"""SQL for each dashboard, one module per Orion domain.

Each module builds :class:`Query` objects (SQL text plus bind values) in small ``*_query``
functions, so tests can inspect them, and exposes loader functions that run them through
:func:`mbal_bi.datasource.run_query`. Aggregate in SQL; never pull a whole fact table into pandas.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

import pandas as pd

from mbal_bi.datasource import run_query

UNASSIGNED = "Unassigned"
ALL_OTHER = "All other"


@dataclass(frozen=True)
class Query:
    sql: str
    binds: dict[str, Any] = field(default_factory=dict)

    def run(self) -> pd.DataFrame:
        return run_query(self.sql, self.binds)


def label_or_unassigned(column: str) -> str:
    """SQL expression that shows a blank dimension value as 'Unassigned' instead of dropping it."""
    return f"COALESCE(NULLIF(TRIM({column}), ''), '{UNASSIGNED}')"
