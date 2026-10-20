/**
 * The query cache in lib/server/db.ts: fresh, stale-while-revalidate, max age, Refresh, the LRU
 * bound and "data as of". The clock is faked; the runner is a stub that counts and can be held.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { clearCache, dataAsOf, refreshedSince, runQuery, setRunnerForTests } from "@/lib/server/db";
import { DataSourceError } from "@/lib/server/errors";
import { CACHE_MAX_AGE_MS, CACHE_MAX_ENTRIES, CACHE_TTL_MS } from "@/lib/server/config";

const SQL = "SELECT :v AS v FROM dual";
const START = new Date("2026-10-20T06:00:00Z").getTime();
const MINUTE = 60_000;

interface Call {
  binds: Record<string, unknown>;
  resolve: () => void;
  reject: (error: Error) => void;
}

/** A runner whose calls stay pending until resolved; each answers `[{ v, version }]`. */
function heldRunner() {
  const calls: Call[] = [];
  let version = 0;
  setRunnerForTests(
    (_sql, binds) =>
      new Promise((resolve, reject) => {
        const answer = { ...binds, version: ++version };
        calls.push({ binds, resolve: () => resolve([answer]), reject });
      }),
  );
  return calls;
}

/** A runner that answers at once, counting calls. */
function countingRunner() {
  const counter = { calls: 0 };
  setRunnerForTests(async (_sql, binds) => [{ ...binds, version: ++counter.calls }]);
  return counter;
}

/** Let pending promise callbacks run. */
const settle = () => new Promise((resolve) => setImmediate(resolve));

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(START);
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  setRunnerForTests(undefined);
});

describe("query cache", () => {
  it("serves a fresh result from the cache", async () => {
    const counter = countingRunner();
    expect(await runQuery(SQL, { v: 1 })).toEqual([{ v: 1, version: 1 }]);
    vi.setSystemTime(START + CACHE_TTL_MS);
    expect(await runQuery(SQL, { v: 1 })).toEqual([{ v: 1, version: 1 }]);
    expect(counter.calls).toBe(1);
  });

  it("serves a stale result at once and refreshes it exactly once", async () => {
    const calls = heldRunner();
    const first = runQuery(SQL, { v: 1 });
    calls[0].resolve();
    await first;

    vi.setSystemTime(START + CACHE_TTL_MS + MINUTE);
    expect(await runQuery(SQL, { v: 1 })).toEqual([{ v: 1, version: 1 }]);
    expect(calls).toHaveLength(2); // the background refresh

    // Before it lands, everyone gets the stale result and no second refresh starts.
    expect(await runQuery(SQL, { v: 1 })).toEqual([{ v: 1, version: 1 }]);
    expect(calls).toHaveLength(2);

    calls[1].resolve();
    await settle();
    expect(await runQuery(SQL, { v: 1 })).toEqual([{ v: 1, version: 2 }]);
    expect(calls).toHaveLength(2);
  });

  it("shares one fetch between concurrent requests", async () => {
    const calls = heldRunner();
    const requests = [runQuery(SQL, { v: 1 }), runQuery(SQL, { v: 1 }), runQuery(SQL, { v: 1 })];
    expect(calls).toHaveLength(1);
    calls[0].resolve();
    expect(await Promise.all(requests)).toEqual([
      [{ v: 1, version: 1 }],
      [{ v: 1, version: 1 }],
      [{ v: 1, version: 1 }],
    ]);
  });

  it("keeps the stale result when the refresh fails, logs it and retries on the next request", async () => {
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    const calls = heldRunner();
    const first = runQuery(SQL, { v: 1 });
    calls[0].resolve();
    await first;

    vi.setSystemTime(START + CACHE_TTL_MS + MINUTE);
    expect(await runQuery(SQL, { v: 1 })).toEqual([{ v: 1, version: 1 }]);
    calls[1].reject(new Error("ORA-12541: TNS:no listener"));
    await settle();
    expect(errors.mock.calls.flat().join("\n")).toContain("[mbal-bi] query failed: ORA-12541");

    expect(await runQuery(SQL, { v: 1 })).toEqual([{ v: 1, version: 1 }]);
    expect(calls).toHaveLength(3); // tried again
    calls[2].resolve();
    await settle();
    expect(await runQuery(SQL, { v: 1 })).toEqual([{ v: 1, version: 3 }]);
  });

  it("makes the request wait for fresh data past the maximum age", async () => {
    const calls = heldRunner();
    const first = runQuery(SQL, { v: 1 });
    calls[0].resolve();
    await first;

    vi.setSystemTime(START + CACHE_MAX_AGE_MS + MINUTE);
    let answered = false;
    const late = runQuery(SQL, { v: 1 }).then((rows) => {
      answered = true;
      return rows;
    });
    await settle();
    expect(answered).toBe(false);
    calls[1].resolve();
    expect(await late).toEqual([{ v: 1, version: 2 }]);
  });

  it("fails past the maximum age when the source does, instead of serving the old result", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const calls = heldRunner();
    const first = runQuery(SQL, { v: 1 });
    calls[0].resolve();
    await first;

    vi.setSystemTime(START + CACHE_MAX_AGE_MS + MINUTE);
    const late = runQuery(SQL, { v: 1 });
    calls[1].reject(new Error("ORA-12541: TNS:no listener"));
    await expect(late).rejects.toBeInstanceOf(DataSourceError);
  });

  it("reads fresh data after Refresh clears the cache, even during a refresh", async () => {
    const calls = heldRunner();
    const first = runQuery(SQL, { v: 1 });
    calls[0].resolve();
    await first;

    vi.setSystemTime(START + CACHE_TTL_MS + MINUTE);
    await runQuery(SQL, { v: 1 }); // starts a background refresh (calls[1])
    clearCache();
    const afterRefresh = runQuery(SQL, { v: 1 });
    expect(calls).toHaveLength(3); // didn't join the old refresh, didn't serve the old result
    calls[2].resolve();
    expect(await afterRefresh).toEqual([{ v: 1, version: 3 }]);

    // The refresh started before Refresh lands late and must not replace the newer result.
    calls[1].resolve();
    await settle();
    expect(await runQuery(SQL, { v: 1 })).toEqual([{ v: 1, version: 3 }]);
  });

  it(`keeps at most ${CACHE_MAX_ENTRIES} results, dropping the least recently used`, async () => {
    const counter = countingRunner();
    for (let v = 0; v < CACHE_MAX_ENTRIES; v++) await runQuery(SQL, { v });
    await runQuery(SQL, { v: 0 }); // now the most recently used
    await runQuery(SQL, { v: CACHE_MAX_ENTRIES }); // pushes out v=1, the least recently used
    expect(counter.calls).toBe(CACHE_MAX_ENTRIES + 1);

    await runQuery(SQL, { v: 0 });
    await runQuery(SQL, { v: CACHE_MAX_ENTRIES - 1 });
    expect(counter.calls).toBe(CACHE_MAX_ENTRIES + 1); // both still cached
    await runQuery(SQL, { v: 1 });
    expect(counter.calls).toBe(CACHE_MAX_ENTRIES + 2); // read again
  });

  it("dates the data by the oldest result still served, stale ones included", async () => {
    const calls = heldRunner();
    const first = runQuery(SQL, { v: 1 });
    calls[0].resolve();
    await first;
    vi.setSystemTime(START + 5 * MINUTE);
    const second = runQuery(SQL, { v: 2 });
    calls[1].resolve();
    await second;
    expect(dataAsOf().getTime()).toBe(START);

    // Stale but still served: still counts.
    vi.setSystemTime(START + CACHE_TTL_MS + MINUTE);
    await runQuery(SQL, { v: 1 });
    expect(dataAsOf().getTime()).toBe(START);
    // Once its refresh lands, the other result is the oldest.
    calls[2].resolve();
    await settle();
    expect(dataAsOf().getTime()).toBe(START + 5 * MINUTE);

    // Past the maximum age nothing is served from the cache any more.
    const later = START + CACHE_TTL_MS + CACHE_MAX_AGE_MS + 2 * MINUTE;
    vi.setSystemTime(later);
    expect(dataAsOf().getTime()).toBe(later);
  });

  it("re-reads results older than the warm-up's start inside refreshedSince, once", async () => {
    const counter = countingRunner();
    await runQuery(SQL, { v: 1 });
    vi.setSystemTime(START + 10 * MINUTE);
    const since = Date.now();
    const rows = await refreshedSince(since, async () => {
      const a = await runQuery(SQL, { v: 1 });
      const b = await runQuery(SQL, { v: 1 }); // already re-read in this run
      return [a, b];
    });
    expect(rows).toEqual([[{ v: 1, version: 2 }], [{ v: 1, version: 2 }]]);
    expect(counter.calls).toBe(2);
    // Outside it, the new result is served as usual.
    expect(await runQuery(SQL, { v: 1 })).toEqual([{ v: 1, version: 2 }]);
    expect(counter.calls).toBe(2);
  });
});
