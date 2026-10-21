/**
 * The Year and Month groups of the Filters panel, and how a pick becomes the one contiguous date
 * range the URL holds (`range`, `from`, `to`, unchanged; see `lib/filters.ts`).
 *
 * - Months run from the first selected to the last selected: Jan + Mar is Jan to Mar.
 * - Several years run from the first year's first selected month to the last year's last one:
 *   2025 + 2026 with Mar–May is 1 Mar 2025 to 31 May 2026.
 * - A range never ends after today. If it equals a preset (Jan to this month of this year is
 *   "Year to date"), the preset is used, so the URL stays as short as before.
 *
 * Going back, a range shows as the years it touches and the months from its first to its last;
 * `exact` says whether that pick gives the range back (it doesn't for "Last 12 months" or a
 * custom range that starts or ends mid-month).
 */

import { DATE_PRESETS, isoDate, presetRange, type Filters } from "./filters";

/** The first year with data in Orion's sales and finance views. */
export const FIRST_YEAR = 2019;

export const MONTH_NAMES = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
] as const;

export const ALL_MONTHS: readonly number[] = MONTH_NAMES.map((_, index) => index + 1);

export interface PeriodPick {
  /** Selected years, ascending. */
  years: number[];
  /** Selected months, 1–12, ascending. */
  months: number[];
}

type Period = Pick<Filters, "range" | "start" | "end">;

function yearOf(date: string): number {
  return Number(date.slice(0, 4));
}

function monthOf(date: string): number {
  return Number(date.slice(5, 7));
}

function lastDay(year: number, month: number): string {
  return isoDate(year, month, new Date(Date.UTC(year, month, 0)).getUTCDate());
}

function range(from: number, to: number): number[] {
  return Array.from({ length: to - from + 1 }, (_, index) => from + index);
}

/** The years the Year group offers, latest first. */
export function yearOptions(today: string): number[] {
  return range(FIRST_YEAR, Math.max(FIRST_YEAR, yearOf(today))).reverse();
}

/**
 * The period a pick stands for, or null when nothing is picked in one of the groups or the period
 * hasn't started yet.
 */
export function pickToPeriod(pick: PeriodPick, today: string): Period | null {
  if (pick.years.length === 0 || pick.months.length === 0) return null;
  const start = isoDate(Math.min(...pick.years), Math.min(...pick.months), 1);
  if (start > today) return null;
  const last = lastDay(Math.max(...pick.years), Math.max(...pick.months));
  const end = last > today ? today : last;
  const preset = DATE_PRESETS.find(({ id }) => {
    const candidate = presetRange(id, today);
    return candidate.start === start && candidate.end === end;
  });
  return { range: preset?.id ?? "custom", start, end };
}

/** The Year and Month selection that shows a range, and whether picking it gives the range back. */
export function periodToPick(period: Period, today: string): PeriodPick & { exact: boolean } {
  const [startYear, startMonth] = [yearOf(period.start), monthOf(period.start)];
  const [endYear, endMonth] = [yearOf(period.end), monthOf(period.end)];
  const years = range(startYear, endYear);
  // Over several years with the end month before the start month ("Last 12 months"), no month set
  // fits: show them all.
  const months =
    startYear === endYear || startMonth <= endMonth ? range(startMonth, endMonth) : [...ALL_MONTHS];
  const back = pickToPeriod({ years, months }, today);
  return { years, months, exact: back?.start === period.start && back.end === period.end };
}

/** True when a month can't start a period yet: it's later this year. */
export function isFutureMonth(year: number, month: number, today: string): boolean {
  return isoDate(year, month, 1) > today;
}

/** "2026", "2025, 2026", "2019 – 2026" or "Pick a year". */
export function yearsLabel(years: readonly number[]): string {
  if (years.length === 0) return "Pick a year";
  const sorted = [...years].sort((a, b) => a - b);
  const contiguous = sorted.every((year, index) => index === 0 || year === sorted[index - 1] + 1);
  if (sorted.length <= 2) return sorted.join(", ");
  return contiguous ? `${sorted[0]} – ${sorted[sorted.length - 1]}` : `${sorted.length} years`;
}

/** "All months", "October", "Jan – Mar", "Jan, Mar" or "Pick a month". */
export function monthsLabel(months: readonly number[]): string {
  if (months.length === 0) return "Pick a month";
  if (months.length === 12) return "All months";
  const sorted = [...months].sort((a, b) => a - b);
  if (sorted.length === 1) return MONTH_NAMES[sorted[0] - 1];
  const short = (month: number) => MONTH_NAMES[month - 1].slice(0, 3);
  const contiguous = sorted.every((month, index) => index === 0 || month === sorted[index - 1] + 1);
  if (contiguous) return `${short(sorted[0])} – ${short(sorted[sorted.length - 1])}`;
  return sorted.length <= 3 ? sorted.map(short).join(", ") : `${sorted.length} months`;
}
