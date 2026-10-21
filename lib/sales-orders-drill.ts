import { AGING_BUCKETS } from "./aging";

/**
 * The Sales orders drill-downs live in the URL, so a reload or a shared link reopens them:
 *
 *   ?drill=2026-10            a month of the booked trend (as on Sales, see `lib/sales-drill.ts`)
 *   ?bucket=3                 a column of "Open value by order age": 1 = `<30 D` … 7 = `2+ Y`
 *   &doc=101~SO5~1001         the open order: company, transaction code, number
 *
 * This module is safe to import on the client and the server.
 */

export const BUCKET_PARAM = "bucket";

/** The bucket a `?bucket=` value names, 1-based; `null` if malformed. */
export function parseBucket(value: string | null | undefined): number | null {
  if (!value || !/^\d$/.test(value)) return null;
  const bucket = Number(value);
  return bucket >= 1 && bucket <= AGING_BUCKETS.length ? bucket : null;
}

/** "Orders 3-6 M old" for the dialog title. */
export function bucketLabel(bucket: number): string {
  return AGING_BUCKETS[bucket - 1];
}
