"""Runtime configuration, read from environment variables.

``MBAL_DATA_SOURCE`` picks where data comes from:

* ``sample`` (default): synthetic CSV fixtures in ``mbal_bi/sample_data``. No network or
  credentials needed.
* ``oracle``: live Orion, using ``ORACLE_USER``, ``ORACLE_PASSWORD`` and ``ORACLE_DSN``.

There are deliberately no fallback values for the Oracle settings: if one is missing, oracle mode
fails with a clear message instead of silently connecting somewhere.
"""

from __future__ import annotations

import os

DATA_SOURCE_ENV = "MBAL_DATA_SOURCE"
SAMPLE = "sample"
ORACLE = "oracle"
DATA_SOURCES = (SAMPLE, ORACLE)

ORACLE_ENV_VARS = ("ORACLE_USER", "ORACLE_PASSWORD", "ORACLE_DSN")

# Seconds a cached query result stays fresh. The "Refresh data" button clears it early.
CACHE_TTL_SECONDS = 15 * 60


class ConfigError(Exception):
    """The environment is set up wrongly. The message is safe to show to users."""


def data_source() -> str:
    """Return the configured data source, ``sample`` or ``oracle``."""
    value = (os.getenv(DATA_SOURCE_ENV) or SAMPLE).strip().lower()
    if value not in DATA_SOURCES:
        raise ConfigError(
            f"{DATA_SOURCE_ENV} must be 'sample' or 'oracle', not '{value}'."
        )
    return value


def is_sample_mode() -> bool:
    try:
        return data_source() == SAMPLE
    except ConfigError:
        return False


def oracle_settings() -> dict[str, str]:
    """Return Oracle connection settings from the environment, or raise ``ConfigError``."""
    missing = [name for name in ORACLE_ENV_VARS if not os.getenv(name)]
    if missing:
        raise ConfigError(
            "Oracle mode needs these environment variables: "
            + ", ".join(missing)
            + ". See .env.example."
        )
    return {
        "user": os.environ["ORACLE_USER"],
        "password": os.environ["ORACLE_PASSWORD"],
        "dsn": os.environ["ORACLE_DSN"],
    }
