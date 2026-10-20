"""The shared dashboard filters and how they turn into a bound SQL ``WHERE`` fragment."""

from __future__ import annotations

from dataclasses import dataclass, field, replace
from datetime import date, timedelta
from typing import Any


def year_to_date(today: date | None = None) -> tuple[date, date]:
    today = today or date.today()
    return date(today.year, 1, 1), today


def shift_years(day: date, years: int) -> date:
    """Same calendar day ``years`` later (earlier if negative). 29 Feb maps to 28 Feb."""
    try:
        return day.replace(year=day.year + years)
    except ValueError:
        return day.replace(year=day.year + years, day=28)


@dataclass(frozen=True)
class Filters:
    """Date range (inclusive) and companies. No companies selected means all companies."""

    start: date
    end: date
    companies: tuple[str, ...] = field(default_factory=tuple)

    def previous_year(self) -> Filters:
        """The same period one year earlier, for year-on-year comparisons."""
        return replace(self, start=shift_years(self.start, -1), end=shift_years(self.end, -1))

    def where(self, date_column: str, company_column: str) -> tuple[str, dict[str, Any]]:
        """Return ``(sql_fragment, binds)``.

        Column names come from query code, never from users. Every user-chosen value travels as a
        bind variable. The end date is turned into an exclusive upper bound so Oracle ``DATE``
        values with a time part on the last day are still included.
        """
        clauses = [f"{date_column} >= :start_date", f"{date_column} < :end_date_exclusive"]
        binds: dict[str, Any] = {
            "start_date": self.start,
            "end_date_exclusive": self.end + timedelta(days=1),
        }
        if self.companies:
            names = [f"company_{index}" for index in range(len(self.companies))]
            clauses.append(f"{company_column} IN ({', '.join(':' + name for name in names)})")
            binds.update(zip(names, self.companies, strict=True))
        return " AND ".join(clauses), binds
