import { addDays, isoDate, isValidIsoDate, type Filters } from "./filters";
import { formatDate, formatMonth } from "./format";

/**
 * The Sales drill-down lives in the URL, so a reload or a shared link reopens it:
 *
 *   ?drill=2026-10                      a month (a bar of the monthly chart, a month row)
 *   ?drill=2026-10-13..2026-10-19       a week, already cut to its month (a week row)
 *   ?drill=2026-10-14                   a day (a day row)
 *   &doc=101~IU5~1260                   the open document: company, transaction code, number
 *
 * The period is always cut to the filtered date range, so the dialog covers exactly what the bar or
 * row it came from adds up. This module is safe to import on the client and the server.
 */

export const DRILL_PARAM = "drill";
export const DOC_PARAM = "doc";

const MONTH_RE = /^(\d{4})-(\d{2})$/;
const RANGE_SEPARATOR = "..";
const DOC_SEPARATOR = "~";
const DOC_PART_RE = /^[\w.-]{1,30}$/;

export interface DrillRange {
  /** Inclusive, YYYY-MM-DD. */
  start: string;
  end: string;
}

/** The last day of a `YYYY-MM` month. */
function monthEnd(month: string): string {
  const [, year, monthNumber] = MONTH_RE.exec(month)!;
  return addDays(isoDate(Number(year), Number(monthNumber) + 1, 1), -1);
}

/** The whole period a drill value names, before it is cut to the filters; `null` if malformed. */
export function parseDrill(drill: string | null | undefined): DrillRange | null {
  if (!drill) return null;
  const month = MONTH_RE.exec(drill);
  if (month) {
    const monthNumber = Number(month[2]);
    if (monthNumber < 1 || monthNumber > 12) return null;
    return { start: `${drill}-01`, end: monthEnd(drill) };
  }
  const [start, end = start, ...rest] = drill.split(RANGE_SEPARATOR);
  if (rest.length === 0 && isValidIsoDate(start) && isValidIsoDate(end) && start <= end) {
    return { start, end };
  }
  return null;
}

/** The drill period cut to the filtered range; `null` if malformed or outside it. */
export function drillRange(
  drill: string | null | undefined,
  filters: Pick<Filters, "start" | "end">,
): DrillRange | null {
  const period = parseDrill(drill);
  if (!period) return null;
  const start = period.start > filters.start ? period.start : filters.start;
  const end = period.end < filters.end ? period.end : filters.end;
  return start <= end ? { start, end } : null;
}

/** The filters narrowed to a drill period, so every other filter still applies. */
export function drillFilters(filters: Filters, range: DrillRange): Filters {
  return { ...filters, range: "custom", start: range.start, end: range.end };
}

/** The drill value for a range: a day on its own, otherwise `start..end`. */
export function rangeDrill(start: string, end: string): string {
  return start === end ? start : `${start}${RANGE_SEPARATOR}${end}`;
}

/** "Oct 2026", "14 Oct 2026", or "Week 42 · 13–19 Oct 2026". */
export function drillTitle(drill: string, range: DrillRange): string {
  if (MONTH_RE.test(drill)) {
    const partial = range.start !== `${drill}-01` || range.end !== monthEnd(drill);
    return partial
      ? `${formatMonth(drill)} (${formatDate(range.start)} – ${formatDate(range.end)})`
      : formatMonth(drill);
  }
  if (range.start === range.end) return formatDate(range.start);
  return `Week ${isoWeek(range.start).week} · ${shortRange(range.start, range.end)}`;
}

/** `13–19 Oct 2026`, or `29 Sep – 5 Oct 2026` across months. */
export function shortRange(start: string, end: string): string {
  if (start === end) return formatDate(start);
  if (start.slice(0, 7) === end.slice(0, 7)) return `${Number(start.slice(8, 10))}–${formatDate(end)}`;
  if (start.slice(0, 4) === end.slice(0, 4)) return `${formatDate(start).slice(0, -5)} – ${formatDate(end)}`;
  return `${formatDate(start)} – ${formatDate(end)}`;
}

/**
 * The ISO 8601 week of a calendar date: weeks start on Monday and week 1 holds the year's first
 * Thursday. Dates are plain `YYYY-MM-DD` business days (Asia/Dubai), so no time zone moves them.
 */
export function isoWeek(date: string): { year: number; week: number } {
  const day = new Date(`${date}T00:00:00Z`);
  const weekday = day.getUTCDay() || 7;
  // The Thursday of this week decides the year.
  const thursday = new Date(day.getTime() + (4 - weekday) * 86_400_000);
  const year = thursday.getUTCFullYear();
  const firstJan = Date.UTC(year, 0, 1);
  return { year, week: Math.floor((thursday.getTime() - firstJan) / 86_400_000 / 7) + 1 };
}

/** One sales document, as `CSL_COMP_CODE` + `CSL_TXN_CODE` + `CSL_NO`. */
export interface DocumentKey {
  company: string;
  txnCode: string;
  no: string;
}

export function docParam(key: DocumentKey): string {
  return [key.company, key.txnCode, key.no].join(DOC_SEPARATOR);
}

export function parseDocParam(value: string | null | undefined): DocumentKey | null {
  const parts = (value ?? "").split(DOC_SEPARATOR);
  if (parts.length !== 3 || !parts.every((part) => DOC_PART_RE.test(part))) return null;
  const [company, txnCode, no] = parts;
  return { company, txnCode, no };
}
