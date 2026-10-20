import "server-only";

/**
 * Runtime configuration, read from environment variables on the server only.
 *
 * `MBAL_DATA_SOURCE` picks where data comes from:
 * - `sample` (default): synthetic CSV fixtures in `data/sample`. No network or credentials.
 * - `oracle`: live Orion, using `ORACLE_USER`, `ORACLE_PASSWORD` and `ORACLE_DSN`.
 *
 * There are deliberately no fallback values for the Oracle settings: if one is missing, oracle
 * mode fails with a clear message instead of silently connecting somewhere.
 */

export type DataSourceMode = "sample" | "oracle";

export const DATA_SOURCE_ENV = "MBAL_DATA_SOURCE";
export const ORACLE_ENV_VARS = ["ORACLE_USER", "ORACLE_PASSWORD", "ORACLE_DSN"] as const;

/** How long a cached query result stays fresh. The Refresh button clears the cache early. */
export const CACHE_TTL_MS = 15 * 60 * 1000;

/**
 * Past the TTL a result is still served at once while one background refresh replaces it, up to
 * this age. Older than this, the request waits for fresh data, so nobody sees yesterday's figures.
 */
export const CACHE_MAX_AGE_MS = 2 * 60 * 60 * 1000;

/** How many query results the cache keeps; the least recently used one goes first. */
export const CACHE_MAX_ENTRIES = 500;

/** The environment is set up wrongly. The message is safe to show to users. */
export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConfigError";
  }
}

export function dataSource(): DataSourceMode {
  const value = (process.env[DATA_SOURCE_ENV] || "sample").trim().toLowerCase();
  if (value !== "sample" && value !== "oracle") {
    throw new ConfigError(`${DATA_SOURCE_ENV} must be 'sample' or 'oracle', not '${value}'.`);
  }
  return value;
}

export function isSampleMode(): boolean {
  try {
    return dataSource() === "sample";
  } catch {
    return false;
  }
}

export interface OracleSettings {
  user: string;
  password: string;
  connectString: string;
}

export function oracleSettings(): OracleSettings {
  const missing = ORACLE_ENV_VARS.filter((name) => !process.env[name]);
  if (missing.length > 0) {
    throw new ConfigError(
      `Oracle mode needs these environment variables: ${missing.join(", ")}. See .env.example.`,
    );
  }
  return {
    user: process.env.ORACLE_USER!,
    password: process.env.ORACLE_PASSWORD!,
    connectString: process.env.ORACLE_DSN!,
  };
}
