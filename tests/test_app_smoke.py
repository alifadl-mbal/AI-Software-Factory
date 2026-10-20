"""Load every page with Streamlit's AppTest, the way a user would see it."""

from datetime import date
from pathlib import Path

import pytest
from streamlit.testing.v1 import AppTest

from mbal_bi.dashboards import DASHBOARDS

ROOT = Path(__file__).resolve().parent.parent
APP = str(ROOT / "app.py")
TIMEOUT = 60


def open_page(page: str | None = None) -> AppTest:
    at = AppTest.from_file(APP, default_timeout=TIMEOUT).run()
    if page:
        at.switch_page(page).run()
    return at


def test_every_dashboard_is_a_page_file():
    pages = {f"pages/{path.name}" for path in (ROOT / "pages").glob("*.py")}
    assert {dashboard.page for dashboard in DASHBOARDS} == pages


@pytest.mark.parametrize("page", [None] + [dashboard.page for dashboard in DASHBOARDS])
def test_page_loads_in_sample_mode(page):
    at = open_page(page)
    assert not at.exception
    assert not at.error
    assert any(info.proto.title == "Sample data" for info in at.info)
    assert len(at.metric) >= 3
    assert all(metric.value for metric in at.metric)
    assert at.get("plotly_chart")


def _metric(at: AppTest, label: str) -> str:
    return next(metric.value for metric in at.metric if metric.label.startswith(label))


def test_company_filter_changes_the_numbers():
    at = open_page("pages/1_Sales.py")
    everyone = _metric(at, "Net revenue")
    at.multiselect(key="filter_companies").set_value(["101"]).run()
    assert not at.exception
    assert _metric(at, "Net revenue") != everyone


def test_date_filter_changes_the_numbers():
    at = open_page("pages/1_Sales.py")
    start, _ = at.date_input(key="filter_dates").value
    before = _metric(at, "Net revenue")
    last_year = (date(start.year - 1, 1, 1), date(start.year - 1, 12, 31))
    at.date_input(key="filter_dates").set_value(last_year).run()
    assert not at.exception
    assert _metric(at, "Net revenue") != before


def test_oracle_mode_without_credentials_shows_friendly_error(monkeypatch):
    monkeypatch.setenv("MBAL_DATA_SOURCE", "oracle")
    at = open_page("pages/1_Sales.py")
    assert not at.exception
    assert any("ORACLE_USER" in error.value for error in at.error)
    assert not at.info  # no sample banner in oracle mode


def test_oracle_mode_unreachable_database_shows_friendly_error(monkeypatch):
    monkeypatch.setenv("MBAL_DATA_SOURCE", "oracle")
    monkeypatch.setenv("ORACLE_USER", "nobody")
    monkeypatch.setenv("ORACLE_PASSWORD", "not-a-password")
    monkeypatch.setenv("ORACLE_DSN", "127.0.0.1:9/nothing")  # closed port: fails fast
    at = open_page("pages/1_Sales.py")
    assert not at.exception
    messages = " ".join(error.value for error in at.error)
    assert "Couldn't connect to Orion" in messages
    assert "Traceback" not in messages


def test_bad_data_source_value_shows_friendly_error(monkeypatch):
    monkeypatch.setenv("MBAL_DATA_SOURCE", "excel")
    at = open_page()
    assert not at.exception
    assert any("MBAL_DATA_SOURCE" in error.value for error in at.error)
