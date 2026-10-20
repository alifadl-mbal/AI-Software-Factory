"""Sales dashboard on MBALI.ZF_CSL_BI. Business rules are documented in mbal_bi/queries/sales.py."""

import streamlit as st

from mbal_bi import formatting, ui
from mbal_bi.queries import ALL_OTHER, sales

ui.page_setup("Sales", ":material/trending_up:")
filters = ui.sidebar_filters()
ui.period_caption(filters)

current = ui.load(sales.kpis, filters)
previous = ui.load(sales.kpis, filters.previous_year())

tiles = st.columns(3) + st.columns(3)
with tiles[0]:
    ui.aed_tile(
        "Net revenue", current["net_revenue"], previous["net_revenue"],
        help="Invoices plus returns (returns are negative), after discounts.",
    )
with tiles[1]:
    ui.aed_tile(
        "Gross margin", current["gross_margin"], previous["gross_margin"],
        help="Net revenue minus cost at weighted average cost (WAC).",
    )
with tiles[2]:
    ui.pct_tile("Margin %", current["margin_pct"], previous["margin_pct"])
with tiles[3]:
    ui.count_tile(
        "Invoices", current["invoice_count"], previous["invoice_count"],
        help="Distinct invoice documents with a non-zero value. Delivery notes are not counted.",
    )
with tiles[4]:
    ui.aed_tile(
        "Returns", current["returns_value"], previous["returns_value"],
        help="Value of sales returns, shown negative. A fall means more was returned.",
    )

ui.trend_chart(ui.load(sales.monthly_trend, filters), "Monthly net revenue, this year vs last year")


def breakdown_chart(dimension: str, title: str, noun: str) -> None:
    """Top 20 bars; whatever is left is summed in a caption so the chart still adds up."""
    frame = ui.load(sales.breakdown, filters, dimension, top_n=sales.TOP_N)
    ui.bar_chart(frame[frame["label"] != ALL_OTHER], title)
    other = frame.loc[frame["label"] == ALL_OTHER, "net_revenue"]
    if not other.empty:
        st.caption(f"All other {noun}: {formatting.fmt_aed(other.sum())}")


left, right = st.columns(2)
with left:
    ui.bar_chart(ui.load(sales.breakdown, filters, "company"), "Net revenue by company")
with right:
    breakdown_chart("item_group", "Net revenue by item group", "item groups")

left, right = st.columns(2)
with left:
    breakdown_chart("customer", f"Top {sales.TOP_N} customers", "customers")
with right:
    breakdown_chart("item", f"Top {sales.TOP_N} items", "items")

breakdown_chart("salesperson", "Net revenue by salesperson", "salespeople")
