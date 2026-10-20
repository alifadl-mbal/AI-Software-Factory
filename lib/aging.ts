import { addDays, isoDate } from "./filters";

/**
 * The aging ladder shared by receivables and payables (mbal-db `business-rules.md`, "Aging
 * buckets"), always shown in this order:
 *
 *   <30 D · 1-2 M · 2-3 M · 3-6 M · 6-12 M · 1-2 Y · 2+ Y
 *
 * A document is `<30 D` while fewer than 30 days have passed since its date. After that it goes by
 * whole calendar months since the date: under 2 months is `1-2 M` (so `1-2 M` also takes the few
 * days between day 30 and the one-month mark), under 3 is `2-3 M`, and so on up to `2+ Y`.
 *
 * "At least N months old" means the document date is on or before `asOf` moved back N months, with
 * the day clamped to the end of a shorter month (30 June back 4 months is 28 February). Dates are
 * `YYYY-MM-DD` strings, as everywhere else in the app. This module is safe on client and server.
 */
export const AGING_BUCKETS = ["<30 D", "1-2 M", "2-3 M", "3-6 M", "6-12 M", "1-2 Y", "2+ Y"] as const;

export type AgingBucket = (typeof AGING_BUCKETS)[number];

/** Month thresholds for buckets 3..7: a document this many whole months old is in that bucket. */
const MONTH_STEPS = [2, 3, 6, 12, 24] as const;

/** Days after which a balance counts as "over 90 days". */
export const OVERDUE_DAYS = 90;

function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/** `date` moved by whole calendar months, the day clamped to the target month's length. */
export function shiftMonths(date: string, months: number): string {
  const year = Number(date.slice(0, 4));
  const month = Number(date.slice(5, 7));
  const day = Number(date.slice(8, 10));
  const index = year * 12 + (month - 1) + months;
  const targetYear = Math.floor(index / 12);
  const targetMonth = (index % 12) + 1;
  return isoDate(targetYear, targetMonth, Math.min(day, daysInMonth(targetYear, targetMonth)));
}

/**
 * The cut-off dates for `asOf`. A document dated *after* `under30Days` is `<30 D`; one dated after
 * `months[0]` (and not `<30 D`) is `1-2 M`; after `months[1]` is `2-3 M`; … ; on or before
 * `months[4]` is `2+ Y`. `over90Days`: documents dated *before* it are more than 90 days old.
 */
export function agingCutoffs(asOf: string): { under30Days: string; months: string[]; over90Days: string } {
  return {
    under30Days: addDays(asOf, -30),
    months: MONTH_STEPS.map((step) => shiftMonths(asOf, -step)),
    over90Days: addDays(asOf, -OVERDUE_DAYS),
  };
}

/** The bucket index (0 = `<30 D` … 6 = `2+ Y`) of a document dated `docDate`, as of `asOf`. */
export function agingBucketIndex(docDate: string, asOf: string): number {
  const { under30Days, months } = agingCutoffs(asOf);
  if (docDate > under30Days) return 0;
  const index = months.findIndex((cutoff) => docDate > cutoff);
  return index === -1 ? AGING_BUCKETS.length - 1 : index + 1;
}
