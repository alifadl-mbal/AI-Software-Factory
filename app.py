"""MBAL BI home page: headline sales figures and the list of dashboards.

Run with ``streamlit run app.py``. Dashboards live in ``pages/``; see the README to add one.
"""

import streamlit as st

from mbal_bi import ui
from mbal_bi.dashboards import DASHBOARDS
from mbal_bi.queries import sales

ui.page_setup(ui.APP_NAME, ":material/monitoring:")
filters = ui.sidebar_filters()

st.subheader("Dashboards")
for dashboard in DASHBOARDS:
    with st.container(border=True):
        st.page_link(dashboard.page, label=dashboard.title, icon=dashboard.icon)
        st.caption(dashboard.description)

st.subheader("Sales at a glance")
ui.period_caption(filters)
current = ui.load(sales.kpis, filters)
previous = ui.load(sales.kpis, filters.previous_year())
columns = st.columns(3)
with columns[0]:
    ui.aed_tile("Net revenue", current["net_revenue"], previous["net_revenue"])
with columns[1]:
    ui.aed_tile("Gross margin", current["gross_margin"], previous["gross_margin"])
with columns[2]:
    ui.count_tile("Invoices", current["invoice_count"], previous["invoice_count"])
ui.trend_chart(ui.load(sales.monthly_trend, filters), "Monthly net revenue")
