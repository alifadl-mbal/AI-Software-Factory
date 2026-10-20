"""Sales dashboard queries on ``MBALI.ZF_CSL_BI``, one row per invoice, delivery or return line.

Business rules (see the mbal-db skill, ``references/business-rules.md``):

* Net revenue = ``SUM(NVL(CSL_NET_SL_VALUE, 0))`` over ``CSL_TXN_TYPE IN ('INV', 'SARTN')``.
  Return lines (``SARTN``) are already negative, so they subtract themselves.
* Returns = the ``SARTN`` part of that sum (a negative number).
* Cost = ``SUM(NVL(CSL_WAC_VALUE, 0))`` over the same rows; also negative on returns. Delivery
  notes (``INV`` type, codes like ``DNP``) carry the cost with zero revenue and the invoice raised
  from them carries the revenue with zero cost, so both must stay in.
* Never use ``CSL_GROSS_SL_VALUE`` (pre-discount) as revenue.
* Invoice count = distinct ``comp-txn_code-no`` documents of type ``INV`` with a non-zero net
  value; this leaves out the zero-value delivery notes.
* Blank dimension values show as 'Unassigned' and are never dropped.
"""

from __future__ import annotations

import pandas as pd

from mbal_bi.filters import Filters
from mbal_bi.queries import ALL_OTHER, Query, label_or_unassigned

VIEW = "MBALI.ZF_CSL_BI"
DATE_COLUMN = "CSL_DATE"
COMPANY_COLUMN = "CSL_COMP_CODE"
REVENUE_TXN_TYPES = "CSL_TXN_TYPE IN ('INV', 'SARTN')"
NET_VALUE = "NVL(CSL_NET_SL_VALUE, 0)"
COST_VALUE = "NVL(CSL_WAC_VALUE, 0)"

# Dimension name -> view column, for the breakdown charts.
DIMENSIONS = {
    "company": "CSL_COMP_NAME",
    "customer": "CSL_CUST_NAME",
    "item": "CSL_NAME",
    "salesperson": "CSL_SM_NAME",
    "item_group": "CSL_GROUP_NAME",
}
TOP_N = 20


def _where(filters: Filters) -> tuple[str, dict]:
    fragment, binds = filters.where(DATE_COLUMN, COMPANY_COLUMN)
    return f"{REVENUE_TXN_TYPES} AND {fragment}", binds


def kpi_query(filters: Filters) -> Query:
    where, binds = _where(filters)
    sql = f"""
SELECT
    SUM({NET_VALUE}) AS net_revenue,
    SUM({COST_VALUE}) AS cost,
    SUM(CASE WHEN CSL_TXN_TYPE = 'SARTN' THEN {NET_VALUE} ELSE 0 END) AS returns_value,
    COUNT(DISTINCT CASE WHEN CSL_TXN_TYPE = 'INV' AND {NET_VALUE} <> 0
        THEN CSL_COMP_CODE || '-' || CSL_TXN_CODE || '-' || CSL_NO END) AS invoice_count
FROM {VIEW}
WHERE {where}
"""
    return Query(sql, binds)


def kpis(filters: Filters) -> dict[str, float]:
    """Net revenue, cost, gross margin, margin %, returns value and invoice count."""
    row = kpi_query(filters).run().iloc[0]
    net_revenue = float(row["net_revenue"] or 0)
    cost = float(row["cost"] or 0)
    gross_margin = net_revenue - cost
    return {
        "net_revenue": net_revenue,
        "cost": cost,
        "gross_margin": gross_margin,
        "margin_pct": gross_margin / net_revenue if net_revenue else None,
        "returns_value": float(row["returns_value"] or 0),
        "invoice_count": int(row["invoice_count"] or 0),
    }


def monthly_revenue_query(filters: Filters) -> Query:
    where, binds = _where(filters)
    sql = f"""
SELECT TO_CHAR({DATE_COLUMN}, 'YYYY-MM') AS sales_month, SUM({NET_VALUE}) AS net_revenue
FROM {VIEW}
WHERE {where}
GROUP BY TO_CHAR({DATE_COLUMN}, 'YYYY-MM')
ORDER BY sales_month
"""
    return Query(sql, binds)


def monthly_trend(filters: Filters) -> pd.DataFrame:
    """Net revenue per month of the period, with the same month a year earlier alongside.

    Columns: ``month`` (first day of the month, as a Timestamp, in the selected period),
    ``this_year`` and ``last_year``. Months without sales are 0.
    """
    months = pd.period_range(filters.start, filters.end, freq="M")
    current = _monthly_series(monthly_revenue_query(filters))
    previous = _monthly_series(monthly_revenue_query(filters.previous_year()))
    previous.index = previous.index + 12  # align last year's month with this year's
    return pd.DataFrame(
        {
            "month": months.to_timestamp(),
            "this_year": current.reindex(months, fill_value=0.0).to_numpy(),
            "last_year": previous.reindex(months, fill_value=0.0).to_numpy(),
        }
    )


def _monthly_series(query: Query) -> pd.Series:
    frame = query.run()
    if frame.empty:
        return pd.Series(dtype=float, index=pd.PeriodIndex([], freq="M"))
    return pd.Series(
        frame["net_revenue"].astype(float).to_numpy(),
        index=pd.PeriodIndex(frame["sales_month"], freq="M"),
    )


def breakdown_query(filters: Filters, dimension: str, top_n: int | None = None) -> Query:
    """Net revenue by one dimension. With ``top_n``, the rest is folded into 'All other'."""
    label = label_or_unassigned(DIMENSIONS[dimension])
    where, binds = _where(filters)
    grouped = f"""
SELECT {label} AS label, SUM({NET_VALUE}) AS net_revenue
FROM {VIEW}
WHERE {where}
GROUP BY {label}"""
    if top_n is None:
        return Query(grouped + "\nORDER BY net_revenue DESC, label\n", binds)

    bucket = f"CASE WHEN rn <= :top_n THEN label ELSE '{ALL_OTHER}' END"
    sql = f"""
SELECT {bucket} AS label, SUM(net_revenue) AS net_revenue, MIN(rn) AS sort_order
FROM (
    SELECT label, net_revenue, ROW_NUMBER() OVER (ORDER BY net_revenue DESC, label) AS rn
    FROM ({grouped}
    ) grouped
) ranked
GROUP BY {bucket}
ORDER BY sort_order
"""
    return Query(sql, {**binds, "top_n": top_n})


def breakdown(filters: Filters, dimension: str, top_n: int | None = None) -> pd.DataFrame:
    """Columns ``label``, ``net_revenue``. With ``top_n`` the last row may be 'All other'."""
    frame = breakdown_query(filters, dimension, top_n).run()
    frame["net_revenue"] = frame["net_revenue"].astype(float)
    return frame[["label", "net_revenue"]]
