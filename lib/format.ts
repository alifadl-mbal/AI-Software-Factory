/**
 * Number formatting shared by every dashboard. All money is AED.
 *
 * - Cards use compact money (`AED 1.2M`); tooltips and tables use full money (`AED 1,234,567`).
 * - Negatives always carry a leading minus (`-AED 1,234`), and `-0` never shows.
 */

export const MISSING = "—";

type Maybe = number | null | undefined;

function isMissing(value: Maybe): value is null | undefined {
  return value === null || value === undefined || Number.isNaN(value);
}

/** Round, and turn -0 into 0, so a tiny negative never prints as "-0". */
function rounded(value: number, decimals: number): number {
  const factor = 10 ** decimals;
  const result = Math.round(Math.abs(value) * factor) / factor;
  return value < 0 && result !== 0 ? -result : result;
}

function grouped(value: number, decimals: number): string {
  return value.toLocaleString("en-US", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

/** `1,234,567`; negatives get a leading minus: `-1,234`. */
export function formatNumber(value: Maybe, decimals = 0): string {
  if (isMissing(value)) return MISSING;
  const result = rounded(value, decimals);
  return `${result < 0 ? "-" : ""}${grouped(Math.abs(result), decimals)}`;
}

/** Full money: `AED 1,234,567`, `-AED 1,234`. For tables and tooltips. */
export function formatAed(value: Maybe, decimals = 0): string {
  if (isMissing(value)) return MISSING;
  const result = rounded(value, decimals);
  return `${result < 0 ? "-" : ""}AED ${grouped(Math.abs(result), decimals)}`;
}

const COMPACT = new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 });

/** Compact number: `1.2M`, `-845K`, `950`. */
export function formatCompact(value: Maybe): string {
  if (isMissing(value)) return MISSING;
  if (Math.abs(value) < 999.5) return formatNumber(value);
  const text = COMPACT.format(Math.abs(value));
  return value < 0 && text !== "0" ? `-${text}` : text;
}

/** Compact money: `AED 1.2M`, `-AED 845K`. For KPI cards and chart axes. */
export function formatAedCompact(value: Maybe): string {
  if (isMissing(value)) return MISSING;
  const text = formatCompact(value);
  return text.startsWith("-") ? `-AED ${text.slice(1)}` : `AED ${text}`;
}

export function formatInt(value: Maybe): string {
  return formatNumber(value, 0);
}

/** `value` is a fraction: 0.1234 → `12.3%`. */
export function formatPct(value: Maybe, decimals = 1): string {
  if (isMissing(value)) return MISSING;
  return `${formatNumber(value * 100, decimals)}%`;
}

/**
 * Change as a fraction of the previous value's size; `null` when there is no base.
 *
 * Uses `|previous|` so the sign always means "went up" or "went down", also for negative measures
 * like returns: -120 vs -100 is -20% (more returns, which is worse).
 */
export function pctChange(current: Maybe, previous: Maybe): number | null {
  if (isMissing(current) || isMissing(previous) || previous === 0) return null;
  return (current - previous) / Math.abs(previous);
}

/** `+12.3%` / `-4.0%`. */
export function formatDeltaPct(change: Maybe): string {
  if (isMissing(change)) return MISSING;
  const percent = rounded(change * 100, 1);
  return `${percent > 0 ? "+" : ""}${formatNumber(percent, 1)}%`;
}

/** Difference of two fractions in percentage points: `+5.0 pp`. */
export function formatDeltaPp(difference: Maybe): string {
  if (isMissing(difference)) return MISSING;
  const points = rounded(difference * 100, 1);
  return `${points > 0 ? "+" : ""}${formatNumber(points, 1)} pp`;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** `2026-03` → `Mar 2026`; with `short`, `Mar 26`. */
export function formatMonth(month: string, short = false): string {
  const name = MONTHS[Number(month.slice(5, 7)) - 1] ?? month;
  return short ? `${name} ${month.slice(2, 4)}` : `${name} ${month.slice(0, 4)}`;
}

/** `2026-03-05` → `5 Mar 2026`. */
export function formatDate(date: string): string {
  return `${Number(date.slice(8, 10))} ${MONTHS[Number(date.slice(5, 7)) - 1]} ${date.slice(0, 4)}`;
}
