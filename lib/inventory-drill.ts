/**
 * The month-end stock drill-down lives in the URL, so a reload or a shared link reopens it:
 *
 *   ?stockMonth=2026-09        a bar of the month-end stock chart: its items
 *
 * Safe to import on the client and the server.
 */

export const STOCK_MONTH_PARAM = "stockMonth";

const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

/** A `YYYY-MM` month from a URL parameter, or `null`. */
export function parseStockMonth(value: string | null | undefined): string | null {
  return value && MONTH_RE.test(value) ? value : null;
}
