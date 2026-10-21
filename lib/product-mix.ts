/**
 * The Product mix page's shapes and its YoY colour scale. Client-safe: the treemap imports it.
 * The tree and the watchlists are built on the server, in `lib/server/product-mix.ts`.
 */

/** One tile: a brand, an item code, or the 'All other' rest of a brand. */
export interface MixTile {
  label: string;
  /** `CSL_ITEM_CODE` of an item tile, for its page; `null` on brands, 'All other' and blank codes. */
  code: string | null;
  netRevenue: number;
  /** The same days a year earlier. */
  lastYearNetRevenue: number;
  grossMargin: number;
}

export interface MixBrand extends MixTile {
  /** Largest first; the last one may be 'All other'. They add up to the brand. */
  items: MixTile[];
}

export interface WatchRow {
  label: string;
  code: string | null;
  netRevenue: number;
  lastYearNetRevenue: number;
  /** Net revenue − last year's. */
  change: number;
  /** Discount ÷ gross sales; `null` without gross sales. */
  discountPct: number | null;
  /** Returns ÷ invoiced sales, as a positive fraction; `null` without invoiced sales. */
  returnsPct: number | null;
}

export type WatchMetric = "change" | "discountPct" | "returnsPct";

export interface Watchlist {
  id: "growers" | "decliners" | "discount" | "returns";
  title: string;
  /** The list's rule, in one line. */
  rule: string;
  /** What each row's figure is. */
  metric: WatchMetric;
  rows: WatchRow[];
}

/**
 * YoY change as a fraction of last year's net revenue. `null` ("new") when last year is zero or
 * negative: there is no base to grow from.
 */
export function yoyChange(current: number, lastYear: number): number | null {
  return lastYear > 0 ? (current - lastYear) / lastYear : null;
}

export function marginPct(tile: Pick<MixTile, "netRevenue" | "grossMargin">): number | null {
  return tile.netRevenue ? tile.grossMargin / tile.netRevenue : null;
}

/** Bucket edges of the YoY scale, as fractions: below −30%, −30 to −15%, … , 30% and above. */
export const YOY_EDGES = [-0.3, -0.15, -0.05, 0.05, 0.15, 0.3] as const;

/** −3 (steepest fall) … 0 (about flat) … 3 (steepest rise), or "new" without last year. */
export type YoyBucket = -3 | -2 | -1 | 0 | 1 | 2 | 3 | "new";

/** Which step of the scale a YoY change falls in. An edge belongs to the step above it. */
export function yoyBucket(change: number | null): YoyBucket {
  if (change === null || !Number.isFinite(change)) return "new";
  let bucket = -3;
  for (const edge of YOY_EDGES) if (change >= edge) bucket += 1;
  return bucket as YoyBucket;
}

const BUCKET_NAMES: Record<string, string> = {
  "-3": "down-3",
  "-2": "down-2",
  "-1": "down-1",
  "0": "flat",
  "1": "up-1",
  "2": "up-2",
  "3": "up-3",
  new: "new",
};

/**
 * Tile fill and label colour of a bucket: CSS variables in `app/globals.css`, with light and dark
 * values. A diverging orange ← grey → blue scale, readable with red-green colour blindness.
 */
export function yoyColors(bucket: YoyBucket): { fill: string; text: string } {
  const name = BUCKET_NAMES[String(bucket)];
  return { fill: `var(--yoy-${name})`, text: `var(--yoy-${name}-fg)` };
}

/** The legend, falls first. */
export const YOY_LEGEND: readonly { bucket: YoyBucket; label: string }[] = [
  { bucket: -3, label: "Below −30%" },
  { bucket: -2, label: "−30 to −15%" },
  { bucket: -1, label: "−15 to −5%" },
  { bucket: 0, label: "−5 to +5%" },
  { bucket: 1, label: "+5 to +15%" },
  { bucket: 2, label: "+15 to +30%" },
  { bucket: 3, label: "+30% and above" },
  { bucket: "new", label: "New: no sales last year" },
];
