import "server-only";

import oracledb from "oracledb";

import { oracleSettings } from "./config";
import { ensureReadOnly } from "./guard";
import type { Binds, Row } from "./types";

/** Seconds to wait for a connection to Orion before giving up. */
export const CONNECT_TIMEOUT_SECONDS = 15;
/** Upper bound on a single round trip, so a runaway query can't hang a page forever. */
const CALL_TIMEOUT_MS = 120_000;

let poolPromise: Promise<oracledb.Pool> | undefined;

function pool(): Promise<oracledb.Pool> {
  if (!poolPromise) {
    const settings = oracleSettings();
    poolPromise = oracledb
      .createPool({
        ...settings,
        poolMin: 0,
        // Enough for every query on a page to run at once, so a dead host fails them all in one
        // connect timeout rather than one queue round after another.
        poolMax: 12,
        poolIncrement: 1,
        // A request waiting for a pooled connection gives up about when a fresh connect would,
        // so a dead host shows the ErrorCard in ~15 s rather than after queue rounds.
        queueTimeout: (CONNECT_TIMEOUT_SECONDS + 2) * 1000,
        connectTimeout: CONNECT_TIMEOUT_SECONDS,
        transportConnectTimeout: CONNECT_TIMEOUT_SECONDS,
      })
      .catch((error: unknown) => {
        poolPromise = undefined;
        throw error;
      });
  }
  return poolPromise;
}

/** Run one read-only query on live Orion (node-oracledb thin mode, pooled). */
export async function queryOracle<T extends Row = Row>(sql: string, binds: Binds = {}): Promise<T[]> {
  ensureReadOnly(sql);
  const connection = await (await pool()).getConnection();
  try {
    connection.callTimeout = CALL_TIMEOUT_MS;
    const result = await connection.execute<Record<string, unknown>>(sql, binds, {
      outFormat: oracledb.OUT_FORMAT_OBJECT,
    });
    return (result.rows ?? []).map(
      (row) => Object.fromEntries(Object.entries(row).map(([key, value]) => [key.toLowerCase(), value])) as T,
    );
  } finally {
    await connection.close();
  }
}
