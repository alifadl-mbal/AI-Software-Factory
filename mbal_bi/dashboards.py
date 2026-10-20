"""The list of dashboards shown on the home page. Add one entry per file in ``pages/``."""

from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class Dashboard:
    title: str
    page: str  # path relative to app.py
    icon: str
    description: str


DASHBOARDS = (
    Dashboard(
        title="Sales",
        page="pages/1_Sales.py",
        icon=":material/trending_up:",
        description="Net revenue, gross margin, invoices and returns, with breakdowns by "
        "company, customer, item, salesperson and item group.",
    ),
)
