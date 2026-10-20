"""The data-source layer: one ``run_query`` for every page, whatever the data source.

Queries are written once, in Oracle SQL, and run unchanged in both modes:

* **oracle**: sent to Orion through :mod:`mbal_bi.db`.
* **sample**: each ``sample_data/<VIEW>.csv`` is loaded into an in-memory SQLite table
  ``MBALI.<VIEW>``, and the same SQL runs there. SQLite gets small shims for the Oracle functions
  we use (``NVL``, ``TO_CHAR`` on dates). Keep query SQL to that portable subset: plain
  ``GROUP BY``, ``CASE``, ``COALESCE``/``NULLIF``/``TRIM``, window functions, named binds.
  Fixture dates are ``YYYY-MM-DD`` text, which compares correctly against date binds.

Every query goes through the read-only guard, is cached for 15 minutes, and on failure raises
:class:`DataSourceError` whose ``user_message`` is safe to put on screen.
"""

from __future__ import annotations

import logging
import re
import sqlite3
from collections.abc import Mapping
from datetime import date, datetime
from pathlib import Path
from typing import Any

import pandas as pd
import streamlit as st

from mbal_bi import config, db

logger = logging.getLogger(__name__)

SAMPLE_DIR = Path(__file__).parent / "sample_data"
SAMPLE_SCHEMA = "MBALI"

_ISO_DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")
_ERROR_CODE_RE = re.compile(r"\b((?:ORA|DPY)-\d{4,5})\b")
_CONNECT_ERROR_CODES = {
    "DPY-4011",  # connection closed
    "DPY-6000",  # listener refused
    "DPY-6005",  # cannot connect (timeout, refused, DNS)
    "ORA-12170",  # connect timeout
    "ORA-12514",  # unknown service
    "ORA-12541",  # no listener
    "ORA-12543",  # destination host unreachable
}
_LOGIN_ERROR_CODES = {"ORA-01017", "ORA-28000", "ORA-28001"}


class DataSourceError(Exception):
    """Loading data failed. ``user_message`` is friendly and contains no stack trace or secrets."""

    def __init__(self, user_message: str):
        super().__init__(user_message)
        self.user_message = user_message


class SampleSource:
    """Runs Oracle-flavoured SQL against the CSV fixtures through in-memory SQLite.

    ``rebase_to_year`` shifts every fixture date by whole years so the newest fixture year becomes
    that year. The app passes the current year, so "year to date" always has data to show.
    """

    def __init__(self, fixture_dir: Path = SAMPLE_DIR, rebase_to_year: int | None = None):
        self.fixture_dir = Path(fixture_dir)
        self.rebase_to_year = rebase_to_year

    def query(self, sql: str, binds: Mapping[str, Any] | None = None) -> pd.DataFrame:
        db.ensure_read_only(sql)
        connection = self._connect()
        try:
            frame = pd.read_sql_query(sql, connection, params=_sqlite_binds(binds))
        finally:
            connection.close()
        frame.columns = [column.lower() for column in frame.columns]
        return frame

    def _connect(self) -> sqlite3.Connection:
        connection = sqlite3.connect(":memory:")
        connection.execute(f"ATTACH DATABASE ':memory:' AS {SAMPLE_SCHEMA}")
        connection.create_function("NVL", 2, _nvl, deterministic=True)
        connection.create_function("TO_CHAR", 2, _to_char, deterministic=True)
        for csv_path in sorted(self.fixture_dir.glob("*.csv")):
            header = pd.read_csv(csv_path, nrows=0).columns
            # Codes like '107' are VARCHAR2 in Orion; keep them text, not numbers.
            text_columns = {name: str for name in header if name.endswith(("_CODE", "_NAME"))}
            frame = pd.read_csv(csv_path, dtype=text_columns)
            if self.rebase_to_year is not None:
                frame = _rebase_dates(frame, self.rebase_to_year)
            _load_table(connection, f'{SAMPLE_SCHEMA}."{csv_path.stem.upper()}"', frame)
        return connection


class OracleSource:
    """Runs queries against live Orion."""

    def query(self, sql: str, binds: Mapping[str, Any] | None = None) -> pd.DataFrame:
        return db.fetch_dataframe(sql, binds)


def get_source(mode: str):
    if mode == config.ORACLE:
        return OracleSource()
    return SampleSource(rebase_to_year=date.today().year)


@st.cache_data(ttl=config.CACHE_TTL_SECONDS, show_spinner="Loading data...", max_entries=500)
def _cached_query(mode: str, sql: str, binds: dict[str, Any]) -> pd.DataFrame:
    return get_source(mode).query(sql, binds)


def run_query(sql: str, binds: Mapping[str, Any] | None = None) -> pd.DataFrame:
    """Run one read-only query on the configured source. Results are cached for 15 minutes."""
    try:
        db.ensure_read_only(sql)
        return _cached_query(config.data_source(), sql, dict(binds or {}))
    except config.ConfigError as exc:
        raise DataSourceError(str(exc)) from exc
    except Exception as exc:
        logger.exception("Query failed")
        raise DataSourceError(friendly_message(exc)) from exc


def clear_cache() -> None:
    _cached_query.clear()


def friendly_message(exc: BaseException) -> str:
    """Turn a driver or guard exception into a short message fit for the page."""
    if isinstance(exc, db.ReadOnlyViolation):
        return f"A query was blocked by the read-only guard: {exc}"
    match = _ERROR_CODE_RE.search(str(exc))
    code = match.group(1) if match else None
    if code in _CONNECT_ERROR_CODES:
        return (
            f"Couldn't connect to Orion ({code}). Check you are on the office network or VPN "
            "and that ORACLE_DSN is right, then press Refresh data."
        )
    if code in _LOGIN_ERROR_CODES:
        return f"Orion rejected the login ({code}). Check ORACLE_USER and ORACLE_PASSWORD."
    if code:
        return f"The Orion query failed ({code}). Details are in the server log."
    return "Loading data failed. Details are in the server log."


def _nvl(value, default):
    return default if value is None else value


def _to_char(value, fmt):
    """The two ``TO_CHAR(date, fmt)`` formats our queries use."""
    if value is None:
        return None
    text = str(value)
    formats = {"YYYY-MM": text[:7], "YYYY": text[:4], "YYYY-MM-DD": text[:10]}
    if fmt not in formats:
        raise ValueError(f"TO_CHAR format {fmt!r} is not supported in sample mode")
    return formats[fmt]


def _sqlite_binds(binds: Mapping[str, Any] | None) -> dict[str, Any]:
    converted = {}
    for name, value in (binds or {}).items():
        if isinstance(value, datetime):
            value = value.date().isoformat()
        elif isinstance(value, date):
            value = value.isoformat()
        converted[name] = value
    return converted


def _rebase_dates(frame: pd.DataFrame, target_year: int) -> pd.DataFrame:
    frame = frame.copy()
    for column in frame.columns:
        values = frame[column].dropna()
        if values.empty or pd.api.types.is_numeric_dtype(values):
            continue
        if not values.astype(str).str.match(_ISO_DATE_RE).all():
            continue
        offset = target_year - int(values.str[:4].astype(int).max())
        if offset:
            frame[column] = frame[column].map(
                lambda text, offset=offset: _shift_year(text, offset)
            )
    return frame


def _shift_year(text, offset: int):
    if not isinstance(text, str):
        return text
    year, month, day = (int(part) for part in text.split("-"))
    if month == 2 and day == 29:
        day = 28
    return date(year + offset, month, day).isoformat()


def _load_table(connection: sqlite3.Connection, table: str, frame: pd.DataFrame) -> None:
    def sqlite_type(dtype) -> str:
        if pd.api.types.is_integer_dtype(dtype):
            return "INTEGER"
        if pd.api.types.is_float_dtype(dtype):
            return "REAL"
        return "TEXT"

    columns = ", ".join(f'"{name}" {sqlite_type(dtype)}' for name, dtype in frame.dtypes.items())
    connection.execute(f"CREATE TABLE {table} ({columns})")
    placeholders = ", ".join("?" for _ in frame.columns)
    rows = frame.astype(object).where(frame.notna(), None).itertuples(index=False, name=None)
    connection.executemany(f"INSERT INTO {table} VALUES ({placeholders})", rows)
