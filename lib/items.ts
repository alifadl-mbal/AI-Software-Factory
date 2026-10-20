import { filtersToSearch, type Filters } from "./filters";

/** The item pages live under this path; they are detail pages, not in the sidebar. */
export const ITEMS_PATH = "/items";

/** Months of sales the average behind months of cover is taken over. */
export const COVER_MONTHS = 12;

/**
 * The item page of `code`, keeping the period and companies of `filters` (or an already built
 * query string such as `?range=mtd`), so following a link never resets the filters. Item codes can
 * hold `/`, `#`, `&`, `?` or spaces, so the code is always encoded.
 */
export function itemHref(
  code: string,
  filters: Pick<Filters, "range" | "start" | "end" | "companies"> | string,
) {
  const search = typeof filters === "string" ? filters : filtersToSearch(filters);
  return `${ITEMS_PATH}/${encodeURIComponent(code)}${search}`;
}

export function isItemPath(pathname: string): boolean {
  return pathname.startsWith(`${ITEMS_PATH}/`);
}

/**
 * Average monthly quantity sold over the last {@link COVER_MONTHS} months, from the quantity sold in
 * that whole window (returns already netted out).
 */
export function averageMonthlyQty(quantity: number): number {
  return quantity / COVER_MONTHS;
}

/**
 * How many months the available stock lasts at the average monthly sales rate. `null` when the
 * item has no recent sales (an average of zero, or below zero when returns outweigh sales): there
 * is no rate to divide by. No available stock is zero months, never negative.
 */
export function monthsOfCover(availableQty: number, averageQty: number): number | null {
  if (!(averageQty > 0)) return null;
  return Math.max(availableQty, 0) / averageQty;
}
