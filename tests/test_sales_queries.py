"""Sales numbers against values worked out by hand from tests/fixtures/ZF_CSL_BI.csv.

Q1 2025 rows that count (types INV and SARTN, 2025-01-01..2025-03-31):

    101 IU5 1001  net 1000  cost 600   Customer A / Alice / Group 1
    101 IU5 1001  net  500  cost 300   Customer A / Alice / Group 1
    102 IN5 2001  net 2000  cost 1500  Customer B / Bob   / Group 2
    101 SRU 3001  net -200  cost -120  Customer A / Alice / Group 1   (return)
    102 DNP 4001  net    0  cost 400   Customer B / Bob   / Group 2   (delivery note)
    102 INP 4002  net  800  cost 0     blank customer / salesperson / group

Left out: the XFR row (wrong type), the April invoice, and the 2024 rows (last year: net 700 - 100).
"""

from datetime import date

import pytest

from mbal_bi.filters import Filters
from mbal_bi.queries import ALL_OTHER, UNASSIGNED, sales
from tests.conftest import Q1_2025

pytestmark = pytest.mark.usefixtures("fixture_source")


def test_kpis_all_companies():
    result = sales.kpis(Q1_2025)
    assert result["net_revenue"] == pytest.approx(4100)
    assert result["cost"] == pytest.approx(2680)
    assert result["gross_margin"] == pytest.approx(1420)
    assert result["margin_pct"] == pytest.approx(1420 / 4100)
    assert result["returns_value"] == pytest.approx(-200)
    # 101-IU5-1001, 102-IN5-2001, 102-INP-4002. The zero-value delivery note is not an invoice.
    assert result["invoice_count"] == 3


def test_kpis_one_company():
    result = sales.kpis(Filters(Q1_2025.start, Q1_2025.end, companies=("101",)))
    assert result["net_revenue"] == pytest.approx(1300)
    assert result["gross_margin"] == pytest.approx(1300 - 780)
    assert result["returns_value"] == pytest.approx(-200)
    assert result["invoice_count"] == 1


def test_kpis_previous_year():
    result = sales.kpis(Q1_2025.previous_year())
    assert result["net_revenue"] == pytest.approx(600)
    assert result["gross_margin"] == pytest.approx(600 - 340)
    assert result["returns_value"] == pytest.approx(-100)
    assert result["invoice_count"] == 1


def test_date_filter_is_inclusive_of_end_date():
    result = sales.kpis(Filters(date(2025, 4, 1), date(2025, 4, 2)))
    assert result["net_revenue"] == pytest.approx(300)


def test_empty_selection_gives_zeros():
    result = sales.kpis(Filters(date(2030, 1, 1), date(2030, 1, 31)))
    assert result["net_revenue"] == 0
    assert result["margin_pct"] is None
    assert result["invoice_count"] == 0


def test_breakdown_keeps_blanks_as_unassigned():
    frame = sales.breakdown(Q1_2025, "customer")
    assert dict(zip(frame["label"], frame["net_revenue"], strict=True)) == {
        "Customer B": 2000,
        "Customer A": 1300,
        UNASSIGNED: 800,
    }
    salespeople = sales.breakdown(Q1_2025, "salesperson")
    assert dict(zip(salespeople["label"], salespeople["net_revenue"], strict=True)) == {
        "Bob": 2000,
        "Alice": 1300,
        UNASSIGNED: 800,
    }


@pytest.mark.parametrize("dimension", list(sales.DIMENSIONS))
def test_every_breakdown_adds_up_to_net_revenue(dimension):
    total = sales.kpis(Q1_2025)["net_revenue"]
    assert sales.breakdown(Q1_2025, dimension)["net_revenue"].sum() == pytest.approx(total)
    topped = sales.breakdown(Q1_2025, dimension, top_n=1)
    assert topped["net_revenue"].sum() == pytest.approx(total)


def test_top_n_folds_the_rest_into_all_other():
    frame = sales.breakdown(Q1_2025, "customer", top_n=1)
    assert list(frame["label"]) == ["Customer B", ALL_OTHER]
    assert list(frame["net_revenue"]) == pytest.approx([2000, 2100])


def test_monthly_trend_this_year_vs_last_year():
    frame = sales.monthly_trend(Q1_2025)
    months = [month.strftime("%Y-%m") for month in frame["month"]]
    assert months == ["2025-01", "2025-02", "2025-03"]
    assert list(frame["this_year"]) == pytest.approx([1500, 1800, 800])
    assert list(frame["last_year"]) == pytest.approx([0, 600, 0])
    assert frame["this_year"].sum() == pytest.approx(sales.kpis(Q1_2025)["net_revenue"])
