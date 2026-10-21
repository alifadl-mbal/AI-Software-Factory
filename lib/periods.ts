/**
 * The bars of a period chart: which months (or years) a date range shows, which of them it only
 * partly covers, and the year-on-year change under each bar. Safe on the client and the server.
 *
 * A bar is partial when the range starts after its first day or ends before its last: the running
 * month of a "to date" range, or a month a custom range cuts. Its last-year figure covers the same
 * days a year earlier (`previousYear`), so the comparison stays like-for-like.
 */

import { addDays, isoDate, monthsInRange, type Filters } from "@/lib/filters";
import { pctChange } from "@/lib/format";

export type Granularity = "month" | "year";

/** A range of more months than this shows one bar per year. */
export const MAX_MONTHLY_BARS = 24;

export interface PeriodBucket {
  /** `YYYY-MM` for a month, `YYYY` for a year. */
  key: string;
  granularity: Granularity;
  /** First day the range covers in this bucket, YYYY-MM-DD. */
  from: string;
  /** Last day the range covers in this bucket, YYYY-MM-DD. */
  to: string;
  /** The range covers only part of the bucket. */
  partial: boolean;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function lastDayOfMonth(month: string): string {
  const [year, monthNumber] = [Number(month.slice(0, 4)), Number(month.slice(5, 7))];
  return addDays(monthNumber === 12 ? isoDate(year + 1, 1, 1) : isoDate(year, monthNumber + 1, 1), -1);
}

/** The first and last day of a `YYYY-MM` or `YYYY` bucket. */
export function bucketBounds(key: string): { first: string; last: string } {
  if (/^\d{4}$/.test(key)) return { first: `${key}-01-01`, last: `${key}-12-31` };
  return { first: `${key}-01`, last: lastDayOfMonth(key) };
}

/** Months up to `MAX_MONTHLY_BARS`, years beyond. */
export function granularityFor(start: string, end: string): Granularity {
  return monthsInRange(start, end).length > MAX_MONTHLY_BARS ? "year" : "month";
}

/** The bars a range shows, in order, each clipped to the range. */
export function periodBuckets(
  start: string,
  end: string,
  granularity: Granularity = granularityFor(start, end),
): PeriodBucket[] {
  const keys =
    granularity === "month"
      ? monthsInRange(start, end)
      : [...new Set(monthsInRange(start, end).map((month) => month.slice(0, 4)))];
  return keys.map((key) => {
    const { first, last } = bucketBounds(key);
    const from = first < start ? start : first;
    const to = last > end ? end : last;
    return { key, granularity, from, to, partial: from !== first || to !== last };
  });
}

/** The range narrowed to one bucket (`YYYY-MM` or `YYYY`); `null` when they don't overlap. */
export function clipToBucket<T extends Pick<Filters, "start" | "end">>(filters: T, key: string): T | null {
  const { first, last } = bucketBounds(key);
  const start = first < filters.start ? filters.start : first;
  const end = last > filters.end ? filters.end : last;
  return start > end ? null : { ...filters, start, end };
}

function dayMonth(date: string): string {
  return `${Number(date.slice(8, 10))} ${MONTHS[Number(date.slice(5, 7)) - 1]}`;
}

/**
 * The days a partial bucket covers: `1–21 Oct` for a month, `1 Jan–21 Oct` for a year. `null` for
 * a full bucket.
 */
export function partialLabel(bucket: PeriodBucket): string | null {
  if (!bucket.partial) return null;
  if (bucket.granularity === "month") {
    return `${Number(bucket.from.slice(8, 10))}–${dayMonth(bucket.to)}`;
  }
  return `${dayMonth(bucket.from)}–${dayMonth(bucket.to)}`;
}

/** `Oct 26` / `2026` on the axis; a partial bucket shows its days (`1–21 Oct`, `2026 to 21 Oct`). */
export function bucketTick(bucket: PeriodBucket): string {
  if (bucket.granularity === "year") {
    if (!bucket.partial) return bucket.key;
    const { first } = bucketBounds(bucket.key);
    if (bucket.from === first) return `${bucket.key} to ${dayMonth(bucket.to)}`;
    return `${bucket.key} from ${dayMonth(bucket.from)}`;
  }
  return partialLabel(bucket) ?? `${MONTHS[Number(bucket.key.slice(5, 7)) - 1]} ${bucket.key.slice(2, 4)}`;
}

/** `October 2026`-style title: `Oct 2026`, `Oct 2026 (1–21 Oct)`, `2026`, `2026 (1 Jan–21 Oct)`. */
export function bucketTitle(bucket: PeriodBucket): string {
  const name =
    bucket.granularity === "year"
      ? bucket.key
      : `${MONTHS[Number(bucket.key.slice(5, 7)) - 1]} ${bucket.key.slice(0, 4)}`;
  const days = partialLabel(bucket);
  return days ? `${name} (${days})` : name;
}

/**
 * Year-on-year change as a fraction (0.12 = +12%); `null` when last year is zero, shown as "—".
 * Signs follow `pctChange`: a fall from a loss to a bigger loss is negative.
 */
export function yoyChange(current: number, lastYear: number): number | null {
  return pctChange(current, lastYear);
}

export type PeriodPoint<K extends string> = { month: string } & Record<K, number>;

export type BucketPoint<K extends string> = Record<K, number> & {
  /** The bucket key, `YYYY-MM` or `YYYY`. */
  month: string;
  bucket: PeriodBucket;
};

/**
 * Monthly points summed into the range's buckets. Months outside the range are ignored and buckets
 * without a point are zeros. The sums are plain additions, so a year's bar is its months' total.
 */
export function rollUp<K extends string>(
  points: PeriodPoint<K>[],
  keys: readonly K[],
  start: string,
  end: string,
  granularity: Granularity = granularityFor(start, end),
): BucketPoint<K>[] {
  const buckets = periodBuckets(start, end, granularity);
  const totals = new Map(
    buckets.map((bucket) => [
      bucket.key,
      Object.fromEntries(keys.map((key) => [key, 0])) as Record<K, number>,
    ]),
  );
  for (const point of points) {
    const total = totals.get(granularity === "year" ? point.month.slice(0, 4) : point.month);
    if (!total) continue;
    for (const key of keys) total[key] += point[key];
  }
  return buckets.map((bucket) => ({ ...totals.get(bucket.key)!, month: bucket.key, bucket }));
}
