import "server-only";

import { AsyncLocalStorage } from "node:async_hooks";

import { cache as perRequest } from "react";

import { todayIso } from "@/lib/filters";

import { accessMode } from "./access";
import {
  CACHE_MAX_AGE_MS,
  CACHE_MAX_ENTRIES,
  CACHE_TTL_MS,
  ConfigError,
  dataSource,
  type DataSourceMode,
} from "./config";
import { DataSourceError, friendlyMessage } from "./errors";
import { ensureReadOnly } from "./guard";
import { SampleSource } from "./sample";
import type { Binds, Query, Row } from "./types";

/**
 * The data layer: one `runQuery` for every dashboard, whatever the data source.
 *
 * Queries are written once, in Oracle SQL, and run unchanged in both modes. Every query goes
 * through the read-only guard and on failure throws a `DataSourceError` whose `userMessage` is safe
 * to put on screen.
 *
 * Results are cached keyed by mode + SQL + binds, stale-while-revalidate:
 * - up to `CACHE_TTL_MS` (15 minutes) old, a result is served as it is;
 * - up to `CACHE_MAX_AGE_MS` (2 hours), it is still served at once, and one background refresh,
 *   shared by every request, replaces it. A failed refresh keeps it and the next request retries;
 * - older than that, or not cached, the request waits for the source.
 * At most `CACHE_MAX_ENTRIES` results are kept, least recently used first out.
 */

interface Fetched {
  rows: Row[];
  /** When the query was sent, so "data as of" never claims more than it knows. */
  fetchedAt: number;
}

interface CacheEntry {
  /** The last good result; absent until the first fetch succeeds. */
  value?: Fetched;
  /** The fetch in flight, shared by every request that needs it. */
  pending?: Promise<Fetched>;
}

type Runner = (sql: string, binds: Binds) => Promise<Row[]>;

// On globalThis so every route bundle in the process shares one cache (the warm-up route and the
// pages must hit the same entries).
const shared = globalThis as typeof globalThis & { __mbalBiQueryCache?: Map<string, CacheEntry> };
const cache = (shared.__mbalBiQueryCache ??= new Map<string, CacheEntry>());
let sampleSource: { today: string; source: SampleSource } | undefined;
let runnerOverride: Runner | undefined;

/** Set by `refreshedSince`: results fetched before `since` are re-read, and the caller waits. */
const refreshScope = new AsyncLocalStorage<{ since: number }>();

/** When the oldest result this request rendered was fetched. Per request inside React only. */
const requestScope = perRequest((): { oldest?: number } => ({}));

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

function logFailure(error: unknown): void {
  // The full driver message (with codes and host) goes to the server log only.
  console.error(`[mbal-bi] query failed: ${error instanceof Error ? error.message : String(error)}`);
}

/** The entry for `key`, marked most recently used; the least recently used ones beyond the bound go. */
function touch(key: string): CacheEntry {
  const entry = cache.get(key) ?? {};
  cache.delete(key);
  cache.set(key, entry);
  for (const oldest of cache.keys()) {
    if (cache.size <= CACHE_MAX_ENTRIES) break;
    cache.delete(oldest);
  }
  return entry;
}

/** Start the one fetch for `entry`, or join the one in flight. */
function refresh(key: string, entry: CacheEntry, read: () => Promise<Row[]>): Promise<Fetched> {
  if (entry.pending) return entry.pending;
  const fetchedAt = Date.now();
  const pending = read().then(
    (rows) => {
      const fetched = { rows, fetchedAt };
      // Unless Refresh (or the LRU bound) dropped the entry meanwhile: then it's not wanted.
      if (cache.get(key) === entry) entry.value = fetched;
      return fetched;
    },
    (error: unknown) => {
      // Never keep a failure; an older good result stays, and the next request tries again.
      if (!entry.value && cache.get(key) === entry) cache.delete(key);
      throw error;
    },
  );
  entry.pending = pending;
  pending
    .finally(() => {
      if (entry.pending === pending) entry.pending = undefined;
    })
    .catch(() => {});
  return pending;
}

function shown(fetched: Fetched): Row[] {
  const scope = requestScope();
  scope.oldest = Math.min(scope.oldest ?? fetched.fetchedAt, fetched.fetchedAt);
  return fetched.rows;
}

/** Run one read-only query on the configured source, through the cache (see above). */
export async function runQuery<T extends Row = Row>(sql: string, binds: Binds = {}): Promise<T[]> {
  try {
    ensureReadOnly(sql);
    // Live figures are never served without sign-in, whatever reaches this far.
    if (accessMode() === "locked") {
      throw new ConfigError("Sign-in is not configured, so MBAL BI serves no data. See docs/deployment.md.");
    }
    const mode = dataSource();
    const key = cacheKey(mode, sql, binds);
    const entry = touch(key);
    const read = () => runner(mode)(sql, binds);
    const { value } = entry;
    const age = value ? Date.now() - value.fetchedAt : Infinity;
    const since = refreshScope.getStore()?.since;

    if (since !== undefined) {
      if (value && value.fetchedAt >= since) return shown(value) as T[];
    } else if (value && age <= CACHE_TTL_MS) {
      return shown(value) as T[];
    } else if (value && age <= CACHE_MAX_AGE_MS) {
      refresh(key, entry, read).catch(logFailure);
      return shown(value) as T[];
    }
    return shown(await refresh(key, entry, read)) as T[];
  } catch (error) {
    logFailure(error);
    throw new DataSourceError(friendlyMessage(error), { cause: error });
  }
}

/** Shorthand for `runQuery(query.sql, query.binds)`. */
export function run<T extends Row = Row>(query: Query): Promise<T[]> {
  return runQuery<T>(query.sql, query.binds);
}

/**
 * Run `work` so that every query it makes returns a result fetched at `since` or later, waiting for
 * the source when the cached one is older. Other requests keep being served the cached result in
 * the meantime. The warm-up job uses it to replace results before they go stale.
 */
export function refreshedSince<T>(since: number, work: () => Promise<T>): Promise<T> {
  return refreshScope.run({ since }, work);
}

/** Drop every cached result, so the next request reads fresh data. */
export function clearCache(): void {
  cache.clear();
}

/**
 * When the oldest result on screen was fetched, stale ones included; `now` if none. Shown as
 * "data as of" next to the Refresh button. While React renders a page it is the oldest result
 * that page used so far; elsewhere, the oldest result the cache would still serve.
 */
export function dataAsOf(): Date {
  const now = Date.now();
  const scope = requestScope();
  if (scope === requestScope()) return new Date(scope.oldest ?? now);
  let oldest = now;
  for (const { value } of cache.values()) {
    if (value && now - value.fetchedAt <= CACHE_MAX_AGE_MS) oldest = Math.min(oldest, value.fetchedAt);
  }
  return new Date(oldest);
}

/** Test hook: route every query to `override` (or back to the configured source). */
export function setRunnerForTests(override: Runner | undefined): void {
  runnerOverride = override;
  cache.clear();
}
