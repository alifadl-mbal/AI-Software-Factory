"""Oracle connection and the read-only guard that every query passes through.

Orion is the ERP's source of truth and the account we use can technically write, so the guard is
the line of defence: only a single ``SELECT`` or ``WITH`` statement is ever sent to a cursor.
The check is textual and deliberately strict. A forbidden word anywhere in the statement, even
inside a string literal or a comment, gets it rejected; reword the query or use a bind variable.
"""

from __future__ import annotations

import re
from collections.abc import Mapping
from typing import Any

import pandas as pd

from mbal_bi import config

CONNECT_TIMEOUT_SECONDS = 15
# Upper bound on a single round trip, so a runaway query can't hang a page forever.
CALL_TIMEOUT_MS = 120_000

FORBIDDEN_KEYWORDS = (
    "ALTER",
    "BEGIN",
    "CALL",
    "COMMIT",
    "CREATE",
    "DECLARE",
    "DELETE",
    "DROP",
    "EXEC",
    "EXECUTE",
    "GRANT",
    "INSERT",
    "LOCK",
    "MERGE",
    "RENAME",
    "REVOKE",
    "ROLLBACK",
    "SAVEPOINT",
    "TRUNCATE",
    "UPDATE",
    "UPSERT",
)
_FORBIDDEN_RE = re.compile(r"\b(" + "|".join(FORBIDDEN_KEYWORDS) + r")\b", re.IGNORECASE)
_LEADING_COMMENTS_RE = re.compile(r"^\s*(?:(?:--[^\n]*\n?|/\*.*?\*/)\s*)*", re.DOTALL)
_FIRST_WORD_RE = re.compile(r"[A-Za-z]+")


class ReadOnlyViolation(ValueError):
    """The statement is not a single read-only query."""


def ensure_read_only(sql: str) -> str:
    """Return ``sql`` unchanged if it is a single SELECT/WITH statement, else raise."""
    if not sql or not sql.strip():
        raise ReadOnlyViolation("Empty statement.")
    if ";" in sql:
        raise ReadOnlyViolation("Only a single statement is allowed (found ';').")
    forbidden = _FORBIDDEN_RE.search(sql)
    if forbidden:
        raise ReadOnlyViolation(f"Forbidden keyword: {forbidden.group(1).upper()}.")
    body = _LEADING_COMMENTS_RE.sub("", sql, count=1)
    first_word = _FIRST_WORD_RE.match(body)
    if not first_word or first_word.group(0).upper() not in ("SELECT", "WITH"):
        raise ReadOnlyViolation("Only SELECT or WITH statements are allowed.")
    return sql


def connect():
    """Open a thin-mode python-oracledb connection using env settings."""
    import oracledb  # imported lazily so sample mode never touches the driver

    connection = oracledb.connect(
        **config.oracle_settings(), tcp_connect_timeout=CONNECT_TIMEOUT_SECONDS
    )
    connection.call_timeout = CALL_TIMEOUT_MS
    return connection


def fetch_dataframe(sql: str, binds: Mapping[str, Any] | None = None) -> pd.DataFrame:
    """Run a read-only query against Orion and return the rows. Column names are lower-cased."""
    ensure_read_only(sql)
    with connect() as connection, connection.cursor() as cursor:
        cursor.execute(sql, dict(binds or {}))
        columns = [description[0].lower() for description in cursor.description]
        rows = cursor.fetchall()
    return pd.DataFrame(rows, columns=columns)
