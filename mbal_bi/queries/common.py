"""Lookups shared by every dashboard."""

from __future__ import annotations

import pandas as pd

from mbal_bi.queries import Query

# Companies are read from the sales view: it carries both code and name for every trading company.
COMPANIES_SQL = """
SELECT CSL_COMP_CODE AS code, MAX(CSL_COMP_NAME) AS name
FROM MBALI.ZF_CSL_BI
WHERE CSL_COMP_CODE IS NOT NULL
GROUP BY CSL_COMP_CODE
ORDER BY CSL_COMP_CODE
"""


def companies_query() -> Query:
    return Query(COMPANIES_SQL)


def companies() -> pd.DataFrame:
    """Columns ``code``, ``name``: one row per company."""
    frame = companies_query().run()
    frame["code"] = frame["code"].astype(str)
    frame["name"] = frame["name"].fillna(frame["code"])
    return frame
