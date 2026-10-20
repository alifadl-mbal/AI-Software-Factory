"""Test setup: always sample mode, with a tiny hand-checked fixture for the number tests."""

from __future__ import annotations

from datetime import date
from pathlib import Path

import pytest

from mbal_bi import datasource
from mbal_bi.filters import Filters

FIXTURE_DIR = Path(__file__).parent / "fixtures"

# Q1 2025 in tests/fixtures/ZF_CSL_BI.csv. Hand-computed expected values are in test_sales_queries.
Q1_2025 = Filters(start=date(2025, 1, 1), end=date(2025, 3, 31))


@pytest.fixture(autouse=True)
def sample_mode(monkeypatch):
    monkeypatch.setenv("MBAL_DATA_SOURCE", "sample")
    for name in ("ORACLE_USER", "ORACLE_PASSWORD", "ORACLE_DSN"):
        monkeypatch.delenv(name, raising=False)
    datasource.clear_cache()
    yield
    datasource.clear_cache()


@pytest.fixture
def fixture_source(monkeypatch):
    """Route run_query to the small hand-checked fixture, with its dates left as they are."""
    source = datasource.SampleSource(fixture_dir=FIXTURE_DIR, rebase_to_year=None)
    monkeypatch.setattr(datasource, "get_source", lambda mode: source)
    return source
