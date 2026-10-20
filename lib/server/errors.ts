import { ConfigError } from "./config";
import { ReadOnlyViolation } from "./guard";

const ERROR_CODE_RE = /\b((?:ORA|DPY|NJS)-\d{3,5})\b/;

const CONNECT_ERROR_CODES = new Set([
  "DPY-4011", // connection closed
  "DPY-6000", // listener refused
  "DPY-6005", // cannot connect (timeout, refused, DNS)
  "NJS-040", // timed out waiting for a pooled connection (the pool couldn't connect)
  "NJS-500", // connection to the database was lost
  "NJS-503", // connection to host could not be established
  "NJS-510", // connect timeout
  "NJS-511", // listener refused
  "ORA-12170", // connect timeout
  "ORA-12514", // unknown service
  "ORA-12541", // no listener
  "ORA-12543", // destination host unreachable
]);
const LOGIN_ERROR_CODES = new Set(["ORA-01017", "ORA-28000", "ORA-28001"]);

/** Loading data failed. `userMessage` is friendly and has no stack trace or secrets in it. */
export class DataSourceError extends Error {
  readonly userMessage: string;

  constructor(userMessage: string, options?: { cause?: unknown }) {
    super(userMessage, options);
    this.name = "DataSourceError";
    this.userMessage = userMessage;
  }
}

export type Loaded<T> = { ok: true; data: T } | { ok: false; message: string };

/**
 * Run a loader and capture a failure as a friendly message, so a dashboard section can render
 * an ErrorCard instead of throwing (production builds hide thrown messages from the client).
 */
export async function load<T>(loader: () => Promise<T>): Promise<Loaded<T>> {
  try {
    return { ok: true, data: await loader() };
  } catch (error) {
    return { ok: false, message: friendlyMessage(error) };
  }
}

/** Turn a driver, config or guard exception into a short message fit for the page. */
export function friendlyMessage(error: unknown): string {
  if (error instanceof DataSourceError) {
    return error.userMessage;
  }
  if (error instanceof ConfigError) {
    return error.message;
  }
  if (error instanceof ReadOnlyViolation) {
    return `A query was blocked by the read-only guard: ${error.message}`;
  }
  const text = error instanceof Error ? error.message : String(error);
  const code = ERROR_CODE_RE.exec(text)?.[1];
  if (code && CONNECT_ERROR_CODES.has(code)) {
    return (
      `Couldn't connect to Orion (${code}). Check you are on the office network or VPN ` +
      "and that ORACLE_DSN is right, then press Refresh."
    );
  }
  if (code && LOGIN_ERROR_CODES.has(code)) {
    return `Orion rejected the login (${code}). Check ORACLE_USER and ORACLE_PASSWORD.`;
  }
  if (code) {
    return `The Orion query failed (${code}). Details are in the server log.`;
  }
  return "Loading data failed. Details are in the server log.";
}
