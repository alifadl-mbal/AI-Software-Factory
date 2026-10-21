import "server-only";

import type { Filters } from "@/lib/filters";
import type { MixBrand, MixTile, Watchlist, WatchRow } from "@/lib/product-mix";
import { formatAedCompact } from "@/lib/format";

import { salesItemMix, type ItemMixRow } from "./queries/sales";
import { ALL_OTHER } from "./sql";

/**
 * The Product mix page: the brand → item tree behind the treemap and the four watchlists, both
 * from `salesItemMix` (one row per item code, this period and the same days last year), so they
 * follow every filter `where()` in `queries/sales.ts` applies.
 */

/** Brands drawn as their own tile; the rest are one 'All other brands' tile. */
export const TREEMAP_BRANDS = 24;
/** Items drawn as their own tile within a brand; the rest are one 'All other' tile. */
export const TREEMAP_ITEMS = 30;
export const ALL_OTHER_BRANDS = "All other brands";

/** Rows per watchlist. */
export const WATCHLIST_SIZE = 10;
/**
 * The smallest base an item needs to be on a watchlist: last year's net revenue for growers and
 * decliners, this period's gross or invoiced sales for discount and returns. Keeps tiny items, where
 * a few dirhams make a big percentage, off the top of the lists.
 */
export const MIN_BASE_AED = 10_000;

function tile(label: string, code: string | null, rows: ItemMixRow[]): MixTile {
  let netRevenue = 0;
  let lastYearNetRevenue = 0;
  let cost = 0;
  for (const row of rows) {
    netRevenue += row.current.netRevenue;
    lastYearNetRevenue += row.lastYear.netRevenue;
    cost += row.current.cost;
  }
  return { label, code, netRevenue, lastYearNetRevenue, grossMargin: netRevenue - cost };
}

function largestFirst(a: MixTile, b: MixTile): number {
  return b.netRevenue - a.netRevenue || a.label.localeCompare(b.label);
}

/** The top `limit` with positive net revenue keep their own tile; the rest fold into `rest`. */
function topAndRest<T>(
  groups: { tile: MixTile; rows: ItemMixRow[]; value: T }[],
  limit: number,
): { kept: typeof groups; rest: ItemMixRow[] } {
  const sorted = [...groups].sort((a, b) => largestFirst(a.tile, b.tile));
  const kept = sorted.filter((group) => group.tile.netRevenue > 0).slice(0, limit);
  const keptSet = new Set(kept);
  return { kept, rest: sorted.filter((group) => !keptSet.has(group)).flatMap((group) => group.rows) };
}

function brandNode(label: string, rows: ItemMixRow[]): MixBrand {
  const groups = rows
    .filter((row) => row.current.netRevenue !== 0 || row.current.cost !== 0 || row.lastYear.netRevenue !== 0)
    .map((row) => ({ tile: tile(row.name, row.code, [row]), rows: [row], value: null }));
  const { kept, rest } = topAndRest(groups, TREEMAP_ITEMS);
  const items = kept.map((group) => group.tile);
  if (rest.length > 0) items.push(tile(ALL_OTHER, null, rest));
  return { ...tile(label, null, rows), items };
}

/**
 * Brand → item tree for the treemap. Every item of the period is in exactly one tile, so the
 * brands add up to the period's net revenue, and each brand's items add up to the brand.
 * Brands and items with no positive net revenue (returns outweighing sales) can't have an area,
 * so they always fold into the 'All other' tile of their level.
 */
export function buildMixTree(items: ItemMixRow[]): MixBrand[] {
  const byBrand = new Map<string, ItemMixRow[]>();
  for (const item of items) {
    const rows = byBrand.get(item.brand) ?? [];
    rows.push(item);
    byBrand.set(item.brand, rows);
  }
  const groups = [...byBrand].map(([label, rows]) => ({ tile: tile(label, null, rows), rows, value: label }));
  const { kept, rest } = topAndRest(groups, TREEMAP_BRANDS);
  const brands = kept.map((group) => brandNode(group.value, group.rows));
  if (rest.length > 0) brands.push(brandNode(ALL_OTHER_BRANDS, rest));
  return brands;
}

function watchRow(item: ItemMixRow): WatchRow {
  const { current, lastYear } = item;
  return {
    label: item.name,
    code: item.code,
    netRevenue: current.netRevenue,
    lastYearNetRevenue: lastYear.netRevenue,
    change: current.netRevenue - lastYear.netRevenue,
    discountPct: current.grossValue ? current.discount / current.grossValue : null,
    returnsPct: current.invoicedValue ? -current.returnsValue / current.invoicedValue : null,
  };
}

function compareCodes(a: string | null, b: string | null): number {
  const left = a ?? "";
  const right = b ?? "";
  return left < right ? -1 : left > right ? 1 : 0;
}

/**
 * The `WATCHLIST_SIZE` items with the highest `by`. Ties (common on discount %, where many items
 * carry the same rate) go to the larger `base`, then to the lower code, so the order is stable.
 */
function top(
  items: ItemMixRow[],
  by: (item: ItemMixRow) => number,
  base: (item: ItemMixRow) => number,
): WatchRow[] {
  return [...items]
    .sort((a, b) => by(b) - by(a) || base(b) - base(a) || compareCodes(a.code, b.code))
    .slice(0, WATCHLIST_SIZE)
    .map(watchRow);
}

const change = (item: ItemMixRow) => item.current.netRevenue - item.lastYear.netRevenue;
const lastYear = (item: ItemMixRow) => item.lastYear.netRevenue;
const gross = (item: ItemMixRow) => item.current.grossValue;
const invoiced = (item: ItemMixRow) => item.current.invoicedValue;

/**
 * The four watchlists, top `WATCHLIST_SIZE` each, per item code:
 * - growers and decliners: the largest rise and fall in net revenue in AED against the same days
 *   last year, among items with at least `MIN_BASE_AED` net revenue last year;
 * - discount %: `CSL_NET_DISC_VALUE` ÷ `CSL_GROSS_SL_VALUE` (as on the Sales discount card), among
 *   items with at least `MIN_BASE_AED` gross sales this period;
 * - returns %: the `SARTN` net value ÷ the `INV` net value (what was invoiced before returns),
 *   among items with at least `MIN_BASE_AED` invoiced this period.
 */
export function buildWatchlists(items: ItemMixRow[]): Watchlist[] {
  const base = formatAedCompact(MIN_BASE_AED);
  const withBase = items.filter((item) => lastYear(item) >= MIN_BASE_AED);
  return [
    {
      id: "growers",
      title: "Growers",
      rule: `Largest rise in net revenue vs the same days last year; items with at least ${base} last year.`,
      metric: "change",
      rows: top(
        withBase.filter((item) => change(item) > 0),
        change,
        lastYear,
      ),
    },
    {
      id: "decliners",
      title: "Decliners",
      rule: `Largest fall in net revenue vs the same days last year; items with at least ${base} last year.`,
      metric: "change",
      rows: top(
        withBase.filter((item) => change(item) < 0),
        (item) => -change(item),
        lastYear,
      ),
    },
    {
      id: "discount",
      title: "Highest discount %",
      rule: `Discount as a share of gross (pre-discount) sales; items with at least ${base} gross sales.`,
      metric: "discountPct",
      rows: top(
        items.filter((item) => gross(item) >= MIN_BASE_AED && item.current.discount > 0),
        (item) => item.current.discount / gross(item),
        gross,
      ),
    },
    {
      id: "returns",
      title: "Highest returns %",
      rule: `Returns (credit notes) as a share of invoiced sales; items with at least ${base} invoiced.`,
      metric: "returnsPct",
      rows: top(
        items.filter((item) => invoiced(item) >= MIN_BASE_AED && item.current.returnsValue < 0),
        (item) => -item.current.returnsValue / invoiced(item),
        invoiced,
      ),
    },
  ];
}

export interface ProductMix {
  brands: MixBrand[];
  watchlists: Watchlist[];
  /** The period's totals: the same as the Sales KPI cards. */
  netRevenue: number;
  lastYearNetRevenue: number;
  grossMargin: number;
  lastYearGrossMargin: number;
  /** Item codes (blank counts as one) with net revenue in the period, and last year. */
  itemCount: number;
  lastYearItemCount: number;
  /** Brands (Unassigned counts as one) with net revenue in the period, and last year. */
  brandCount: number;
  lastYearBrandCount: number;
}

/** Everything the Product mix page shows, from one pair of queries. */
export async function productMix(filters: Filters): Promise<ProductMix> {
  const items = await salesItemMix(filters);
  const sum = (pick: (item: ItemMixRow) => number) => items.reduce((total, item) => total + pick(item), 0);
  const sold = (pick: (item: ItemMixRow) => number) => items.filter((item) => Math.abs(pick(item)) >= 0.005);
  const current = sold((item) => item.current.netRevenue);
  const previous = sold((item) => item.lastYear.netRevenue);
  const netRevenue = sum((item) => item.current.netRevenue);
  const lastYearNetRevenue = sum((item) => item.lastYear.netRevenue);
  return {
    brands: buildMixTree(items),
    watchlists: buildWatchlists(items),
    netRevenue,
    lastYearNetRevenue,
    grossMargin: netRevenue - sum((item) => item.current.cost),
    lastYearGrossMargin: lastYearNetRevenue - sum((item) => item.lastYear.cost),
    itemCount: current.length,
    lastYearItemCount: previous.length,
    brandCount: new Set(current.map((item) => item.brand)).size,
    lastYearBrandCount: new Set(previous.map((item) => item.brand)).size,
  };
}
