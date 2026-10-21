import type { Filters } from "./filters";
import { bucketFilters, bucketTitle, periodBuckets } from "./periods";

/**
 * The Monthly P&L drill-down lives in the URL, so a reload or a shared link reopens it:
 *
 *   ?pnl=2026-10                 a bar of the Monthly P&L chart: a month, or `YYYY` for a year
 *   &pnlLine=cost-of-sales       the open P&L line (a statement row id): its GL accounts
 *   &pnlAccount=40711            the open GL account: its posted journal lines
 *
 * The bar is cut to the filtered date range, so the dialog covers exactly what the bar adds up.
 * The parameters differ from the Sales drill-down's, so both can sit on the Overview. Safe to
 * import on the client and the server.
 */

export const PNL_PARAM = "pnl";
export const LINE_PARAM = "pnlLine";
export const ACCOUNT_PARAM = "pnlAccount";

const LINE_RE = /^[a-z-]{1,60}$/;
const ACCOUNT_RE = /^[\w.-]{1,30}$/;

/** The filters narrowed to the bar's days; `null` if malformed or outside the range. */
export function pnlDrillFilters<T extends Pick<Filters, "start" | "end">>(
  filters: T,
  period: string | null | undefined,
): T | null {
  return bucketFilters(filters, period);
}

/** "Oct 2026", "Oct 2026 (1–21 Oct)", or "2026". */
export function pnlDrillTitle(period: string, filters: Pick<Filters, "start" | "end">): string {
  const range = pnlDrillFilters(filters, period);
  if (!range) return period;
  return bucketTitle(periodBuckets(range.start, range.end, period.length === 4 ? "year" : "month")[0]);
}

export function parseLineParam(value: string | null | undefined): string | null {
  return value && LINE_RE.test(value) ? value : null;
}

export function parseAccountParam(value: string | null | undefined): string | null {
  return value && ACCOUNT_RE.test(value) ? value : null;
}
