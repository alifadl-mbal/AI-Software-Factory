/**
 * The filters shared by every dashboard, and how they live in the URL query string.
 *
 *   ?range=ytd                       a preset: mtd, qtd, ytd (default) or 12m
 *   ?range=custom&from=…&to=…        a custom range, both ends inclusive, as YYYY-MM-DD
 *   &company=101,107                 company codes; absent means all companies
 *
 * Dates are plain `YYYY-MM-DD` strings throughout, so no time zone can shift a day. This module is
 * safe to import on the client and the server.
 */

export const DATE_PRESETS = [
  { id: "mtd", label: "Month to date" },
  { id: "qtd", label: "Quarter to date" },
  { id: "ytd", label: "Year to date" },
  { id: "12m", label: "Last 12 months" },
] as const;

export type PresetId = (typeof DATE_PRESETS)[number]["id"];
export type RangeId = PresetId | "custom";

export const DEFAULT_RANGE: PresetId = "ytd";

export interface Filters {
  range: RangeId;
  /** Inclusive first day, YYYY-MM-DD. */
  start: string;
  /** Inclusive last day, YYYY-MM-DD. */
  end: string;
  /** Company codes; empty means all companies. */
  companies: string[];
}

export type SearchParams = Record<string, string | string[] | undefined>;

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const COMPANY_CODE_RE = /^[\w.-]{1,30}$/;

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

export function isoDate(year: number, month: number, day: number): string {
  return `${year}-${pad(month)}-${pad(day)}`;
}

/** MBAL's time zone: "today" for the date presets is today in the UAE, wherever the server runs. */
export const BUSINESS_TIME_ZONE = "Asia/Dubai";

/** Today in the business time zone, as YYYY-MM-DD. */
export function todayIso(now: Date = new Date()): string {
  // en-CA formats dates as YYYY-MM-DD.
  return new Intl.DateTimeFormat("en-CA", { timeZone: BUSINESS_TIME_ZONE }).format(now);
}

function parts(date: string): [number, number, number] {
  return [Number(date.slice(0, 4)), Number(date.slice(5, 7)), Number(date.slice(8, 10))];
}

export function isValidIsoDate(value: unknown): value is string {
  if (typeof value !== "string" || !ISO_DATE_RE.test(value)) return false;
  const [year, month, day] = parts(value);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

/** Add whole days to a YYYY-MM-DD date. */
export function addDays(date: string, days: number): string {
  const [year, month, day] = parts(date);
  const shifted = new Date(Date.UTC(year, month - 1, day + days));
  return isoDate(shifted.getUTCFullYear(), shifted.getUTCMonth() + 1, shifted.getUTCDate());
}

/** The same calendar day `years` later (earlier if negative). 29 Feb maps to 28 Feb. */
export function shiftYears(date: string, years: number): string {
  const [year, month, day] = parts(date);
  return isoDate(year + years, month, month === 2 && day === 29 ? 28 : day);
}

/** The inclusive date range a preset covers on `today`. */
export function presetRange(preset: PresetId, today: string): { start: string; end: string } {
  const [year, month] = parts(today);
  switch (preset) {
    case "mtd":
      return { start: isoDate(year, month, 1), end: today };
    case "qtd":
      return { start: isoDate(year, Math.floor((month - 1) / 3) * 3 + 1, 1), end: today };
    case "12m":
      return { start: addDays(shiftYears(today, -1), 1), end: today };
    case "ytd":
      return { start: isoDate(year, 1, 1), end: today };
  }
}

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

/** Read filters from URL search params. Anything invalid falls back to the default. */
export function parseFilters(params: SearchParams | URLSearchParams, today: string): Filters {
  const get = (name: string) =>
    params instanceof URLSearchParams ? (params.get(name) ?? undefined) : first(params[name]);

  const companies = [
    ...new Set(
      (get("company") ?? "")
        .split(",")
        .map((code) => code.trim())
        .filter((code) => COMPANY_CODE_RE.test(code)),
    ),
  ].sort();

  const range = get("range");
  if (range === "custom") {
    const from = get("from");
    const to = get("to");
    if (isValidIsoDate(from) && isValidIsoDate(to)) {
      const [start, end] = from <= to ? [from, to] : [to, from];
      return { range: "custom", start, end, companies };
    }
  }
  const preset = DATE_PRESETS.some((option) => option.id === range) ? (range as PresetId) : DEFAULT_RANGE;
  return { range: preset, ...presetRange(preset, today), companies };
}

/** The query string for `filters`, leaving defaults out so URLs stay short. */
export function filtersToSearch(filters: Pick<Filters, "range" | "start" | "end" | "companies">): string {
  const params = new URLSearchParams();
  if (filters.range === "custom") {
    params.set("range", "custom");
    params.set("from", filters.start);
    params.set("to", filters.end);
  } else if (filters.range !== DEFAULT_RANGE) {
    params.set("range", filters.range);
  }
  if (filters.companies.length > 0) {
    params.set("company", [...filters.companies].sort().join(","));
  }
  const search = params.toString().replaceAll("%2C", ",");
  return search ? `?${search}` : "";
}

/** The same period one year earlier, for year-on-year comparisons. */
export function previousYear(filters: Filters): Filters {
  return { ...filters, start: shiftYears(filters.start, -1), end: shiftYears(filters.end, -1) };
}

/** Every month (`YYYY-MM`) the range touches, in order. */
export function monthsInRange(start: string, end: string): string[] {
  const months: string[] = [];
  let [year, month] = parts(start);
  const [endYear, endMonth] = parts(end);
  while (year < endYear || (year === endYear && month <= endMonth)) {
    months.push(`${year}-${pad(month)}`);
    month += 1;
    if (month > 12) {
      month = 1;
      year += 1;
    }
  }
  return months;
}

/** `YYYY-MM` shifted by whole years. */
export function shiftMonth(month: string, years: number): string {
  return `${Number(month.slice(0, 4)) + years}${month.slice(4)}`;
}
