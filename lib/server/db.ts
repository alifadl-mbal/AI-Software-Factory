import "server-only";

import { todayIso } from "@/lib/filters";

import { CACHE_TTL_MS, dataSource, type DataSourceMode } from "./config";
import { DataSourceError, friendlyMessage } from "./errors";
import { ensureReadOnly } from "./guard";
import { SampleSource } from "./sample";
import type { Binds, Query, Row } from "./types";

/**
 * The data layer: one `runQuery` for every dashboard, whatever the data source.
 *
 * Queries are written once, in Oracle SQL, and run unchanged in both modes. Every query goes
 * through the read-only guard, is cached for 15 minutes keyed by mode + SQL + binds, and on failure
 * throws a `DataSourceError` whose `userMessage` is safe to put on screen.
 */

interface CacheEntry {
  promise: Promise<Row[]>;
  fetchedAt: number;
}

type Runner = (sql: string, binds: Binds) => Promise<Row[]>;

const cache = new Map<string, CacheEntry>();
let sampleSource: { today: string; source: SampleSource } | undefined;
let runnerOverride: Runner | undefined;

function runner(mode: DataSourceMode): Runner {
  if (runnerOverride) return runnerOverride;
  if (mode === "oracle") {
    // Imported lazily so sample mode never loads the driver.
    return async (sql, binds) => (await import("./oracle")).queryOracle(sql, binds);
  }
  // Sample dates move with the calendar, so it is rebuilt when the (business) day changes: balance
  // fixtures are anchored to today, periods to this month and the rest to this year.
  const today = todayIso();
  if (sampleSource?.today !== today) {
    sampleSource = {
      today,
      source: new SampleSource({
        rebaseToYear: Number(today.slice(0, 4)),
        rebaseToMonth: today.slice(0, 7),
        anchorToDate: today,
      }),
    };
  }
  const source = sampleSource.source;
  return (sql, binds) => source.query(sql, binds);
}

function cacheKey(mode: DataSourceMode, sql: string, binds: Binds): string {
  const sortedBinds = Object.keys(binds)
    .sort()
    .map((name) => [name, binds[name]]);
  return JSON.stringify([mode, sql, sortedBinds]);
}

/** Run one read-only query on the configured source. Results are cached for 15 minutes. */
export async function runQuery<T extends Row = Row>(sql: string, binds: Binds = {}): Promise<T[]> {
  try {
    ensureReadOnly(sql);
    const mode = dataSource();
    const key = cacheKey(mode, sql, binds);
    const now = Date.now();
    let entry = cache.get(key);
    if (!entry || now - entry.fetchedAt > CACHE_TTL_MS) {
      const promise = runner(mode)(sql, binds);
      entry = { promise, fetchedAt: now };
      cache.set(key, entry);
      // Never keep a failure: the next request (or Retry) tries again.
      promise.catch(() => {
        if (cache.get(key)?.promise === promise) cache.delete(key);
      });
    }
    return (await entry.promise) as T[];
  } catch (error) {
    // The full driver message (with codes and host) goes to the server log only.
    console.error(`[mbal-bi] query failed: ${error instanceof Error ? error.message : String(error)}`);
    throw new DataSourceError(friendlyMessage(error), { cause: error });
  }
}

/** Shorthand for `runQuery(query.sql, query.binds)`. */
export function run<T extends Row = Row>(query: Query): Promise<T[]> {
  return runQuery<T>(query.sql, query.binds);
}

/** Drop every cached result, so the next request reads fresh data. */
export function clearCache(): void {
  cache.clear();
}

/**
 * When the oldest cached result still in use was fetched; `now` if nothing is cached. Shown as
 * "data as of" next to the Refresh button.
 */
export function dataAsOf(): Date {
  const now = Date.now();
  let oldest = now;
  for (const entry of cache.values()) {
    if (now - entry.fetchedAt <= CACHE_TTL_MS) oldest = Math.min(oldest, entry.fetchedAt);
  }
  return new Date(oldest);
}

/** Test hook: route every query to `override` (or back to the configured source). */
export function setRunnerForTests(override: Runner | undefined): void {
  runnerOverride = override;
  cache.clear();
}
