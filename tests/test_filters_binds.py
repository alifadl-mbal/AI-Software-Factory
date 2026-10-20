"""Filters reach SQL only as bind variables, never as text pasted into the statement."""

from datetime import date, timedelta

import pytest

from mbal_bi.filters import Filters, shift_years, year_to_date
from mbal_bi.queries import sales

SNEAKY = "101') OR ('1' = '1"


def test_where_uses_binds_for_dates_and_companies():
    filters = Filters(date(2026, 1, 1), date(2026, 3, 31), companies=("101", "107"))
    fragment, binds = filters.where("CSL_DATE", "CSL_COMP_CODE")
    assert fragment == (
        "CSL_DATE >= :start_date AND CSL_DATE < :end_date_exclusive"
        " AND CSL_COMP_CODE IN (:company_0, :company_1)"
    )
    assert binds == {
        "start_date": date(2026, 1, 1),
        "end_date_exclusive": date(2026, 4, 1),
        "company_0": "101",
        "company_1": "107",
    }


def test_no_company_selected_means_no_company_clause():
    fragment, binds = Filters(date(2026, 1, 1), date(2026, 1, 31)).where("D", "C")
    assert "C IN" not in fragment
    assert set(binds) == {"start_date", "end_date_exclusive"}


@pytest.mark.parametrize(
    "build",
    [
        lambda f: sales.kpi_query(f),
        lambda f: sales.monthly_revenue_query(f),
        lambda f: sales.breakdown_query(f, "customer"),
        lambda f: sales.breakdown_query(f, "item", top_n=20),
    ],
)
def test_sales_queries_bind_filter_values(build):
    filters = Filters(date(2026, 2, 1), date(2026, 2, 28), companies=(SNEAKY,))
    query = build(filters)
    assert query.binds["start_date"] == date(2026, 2, 1)
    assert query.binds["end_date_exclusive"] == date(2026, 2, 28) + timedelta(days=1)
    assert query.binds["company_0"] == SNEAKY
    assert ":start_date" in query.sql and ":company_0" in query.sql
    assert SNEAKY not in query.sql
    assert "2026" not in query.sql


def test_injection_attempt_is_just_an_unknown_company(fixture_source):
    result = sales.kpis(Filters(date(2025, 1, 1), date(2025, 3, 31), companies=(SNEAKY,)))
    assert result["net_revenue"] == 0


def test_previous_year_and_leap_day():
    assert shift_years(date(2024, 2, 29), -1) == date(2023, 2, 28)
    filters = Filters(date(2026, 1, 1), date(2026, 10, 20), companies=("101",))
    assert filters.previous_year() == Filters(date(2025, 1, 1), date(2025, 10, 20), ("101",))


def test_year_to_date_default():
    assert year_to_date(date(2026, 10, 20)) == (date(2026, 1, 1), date(2026, 10, 20))
