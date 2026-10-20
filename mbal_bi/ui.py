"""Streamlit building blocks for every page: setup, sidebar filters, errors, KPI tiles, charts."""

from __future__ import annotations

from collections.abc import Callable

import pandas as pd
import plotly.graph_objects as go
import streamlit as st

from mbal_bi import config, datasource, formatting
from mbal_bi.filters import Filters, year_to_date
from mbal_bi.queries import common

APP_NAME = "MBAL BI"
POSITIVE_COLOR = "#2563eb"
NEGATIVE_COLOR = "#dc2626"
LAST_YEAR_COLOR = "#94a3b8"


def page_setup(title: str, icon: str) -> None:
    """Call first on every page: page config, title and the sample-data banner."""
    page_title = title if title == APP_NAME else f"{title} · {APP_NAME}"
    st.set_page_config(page_title=page_title, page_icon=icon, layout="wide")
    st.title(title)
    try:
        mode = config.data_source()
    except config.ConfigError as exc:
        st.error(str(exc), title="Configuration problem")
        st.stop()
    if mode == config.SAMPLE:
        st.info(
            "These are synthetic figures for demos and testing, not Orion data. "
            "Set MBAL_DATA_SOURCE=oracle to use live Orion.",
            title="Sample data",
            icon=":material/science:",
        )


def load[T](loader: Callable[..., T], *args, **kwargs) -> T:
    """Run a data loader. If it fails, show a friendly error and stop the page (no crash)."""
    try:
        return loader(*args, **kwargs)
    except datasource.DataSourceError as exc:
        st.error(exc.user_message, title="Couldn't load data", icon=":material/error:")
        st.stop()


def sidebar_filters() -> Filters:
    """Date range (default: year to date), company multi-select and the Refresh data button."""
    with st.sidebar:
        st.header("Filters")
        default_start, default_end = year_to_date()
        picked = st.date_input(
            "Date range",
            value=(default_start, default_end),
            format="DD/MM/YYYY",
            key="filter_dates",
        )
        start, end = _date_range(picked, default_start, default_end)

        companies = load(common.companies)
        names = dict(zip(companies["code"], companies["name"], strict=True))
        selected = st.multiselect(
            "Company",
            options=list(names),
            format_func=lambda code: f"{code} · {names.get(code, code)}",
            placeholder="All companies",
            key="filter_companies",
        )
        if st.button("Refresh data", icon=":material/refresh:", width="stretch"):
            datasource.clear_cache()
            st.rerun()
        st.caption(f"Results are cached for {config.CACHE_TTL_SECONDS // 60} minutes.")
    return Filters(start=start, end=end, companies=tuple(selected))


def _date_range(picked, default_start, default_end):
    # While the user is mid-way through picking a range, the widget returns a single date.
    if isinstance(picked, (tuple, list)):
        if len(picked) == 2:
            return picked[0], picked[1]
        if len(picked) == 1:
            return picked[0], picked[0]
        return default_start, default_end
    return picked, picked


def period_caption(filters: Filters) -> None:
    previous = filters.previous_year()
    count = len(filters.companies)
    companies = (
        f"{count} compan{'y' if count == 1 else 'ies'} selected." if count else "All companies."
    )
    st.caption(
        f"{filters.start:%d %b %Y} to {filters.end:%d %b %Y}, compared with "
        f"{previous.start:%d %b %Y} to {previous.end:%d %b %Y}. {companies}"
    )


def aed_tile(label: str, current, previous, help: str | None = None) -> None:
    """Money tile. The currency goes in the label so big numbers fit the tile."""
    st.metric(
        f"{label} (AED)",
        formatting.fmt_number(current),
        delta=formatting.fmt_delta_pct(current, previous),
        delta_description="vs last year",
        help=help,
        border=True,
    )


def count_tile(label: str, current, previous, help: str | None = None) -> None:
    st.metric(
        label,
        formatting.fmt_int(current),
        delta=formatting.fmt_delta_pct(current, previous),
        delta_description="vs last year",
        help=help,
        border=True,
    )


def pct_tile(label: str, current, previous, help: str | None = None) -> None:
    st.metric(
        label,
        formatting.fmt_pct(current),
        delta=formatting.fmt_delta_pp(current, previous),
        delta_description="vs last year",
        help=help,
        border=True,
    )


def bar_chart(frame: pd.DataFrame, title: str, label: str = "label", value: str = "net_revenue"):
    """Horizontal bars, largest on top. Negative values are drawn in red."""
    if frame.empty:
        st.caption(f"{title}: no data for this selection.")
        return
    ordered = frame.iloc[::-1]
    figure = go.Figure(
        go.Bar(
            x=ordered[value],
            # Positions, not names, on the axis: two long names that shorten to the same text
            # must stay two bars.
            y=list(range(len(ordered))),
            customdata=ordered[label],
            orientation="h",
            marker_color=[NEGATIVE_COLOR if v < 0 else POSITIVE_COLOR for v in ordered[value]],
            hovertemplate=f"%{{customdata}}<br>{formatting.PLOTLY_AED_HOVER}<extra></extra>",
        )
    )
    figure.update_layout(
        title=title,
        height=max(260, 28 * len(frame) + 90),
        margin=dict(l=10, r=10, t=50, b=10),
        xaxis=dict(tickformat=formatting.PLOTLY_AED_TICKFORMAT, title="AED"),
        yaxis=dict(
            automargin=True,
            tickmode="array",
            tickvals=list(range(len(ordered))),
            ticktext=[_short_label(text) for text in ordered[label]],
        ),
    )
    st.plotly_chart(figure, width="stretch", alt=title)


def _short_label(text, limit: int = 28) -> str:
    """Keep long names from squeezing the bars; the full name is in the hover label."""
    text = str(text)
    return text if len(text) <= limit else text[: limit - 1] + "…"


def trend_chart(frame: pd.DataFrame, title: str) -> None:
    """Monthly net revenue, this year vs the same months last year."""
    figure = go.Figure()
    figure.add_trace(
        go.Scatter(
            x=frame["month"], y=frame["last_year"], name="Last year", mode="lines+markers",
            line=dict(color=LAST_YEAR_COLOR, dash="dot"),
            hovertemplate="%{x|%b}: AED %{y:,.0f}<extra>Last year</extra>",
        )
    )
    figure.add_trace(
        go.Scatter(
            x=frame["month"], y=frame["this_year"], name="This year", mode="lines+markers",
            line=dict(color=POSITIVE_COLOR, width=3),
            hovertemplate="%{x|%b %Y}: AED %{y:,.0f}<extra>This year</extra>",
        )
    )
    figure.update_layout(
        title=title,
        height=360,
        margin=dict(l=10, r=10, t=50, b=10),
        yaxis=dict(tickformat=formatting.PLOTLY_AED_TICKFORMAT, title="AED"),
        xaxis=dict(tickformat="%b %Y", dtick="M1"),
        legend=dict(orientation="h", y=1.02, x=1, xanchor="right", yanchor="bottom"),
        hovermode="x unified",
    )
    st.plotly_chart(figure, width="stretch", alt=title)
