import { shiftMonths } from "./aging";
import type { SearchParams } from "./filters";

/**
 * How far back the "as of today" order books reach: pending POs on Purchasing and the open book on
 * Sales orders. Orion holds years of order lines that were received, delivered or cancelled without
 * being closed, so by default only orders placed in the last 2 years count.
 *
 *   ?since=12m     orders placed in the last 12 months
 *   ?since=all     every open line, whatever its age
 *
 * The default (last 2 years) is left out of the URL, like the date presets in `lib/filters.ts`;
 * `?since=2y` is read as the default too. A line is in when its order date (`PO_DATE`, `H_DT`) is
 * on or after the cut-off: today moved back N calendar months, the day clamped to the end of a
 * shorter month. The cut-off is bound as a `YYYY-MM-DD` date. Safe on the client and the server.
 */

export const ORDER_AGE_OPTIONS = [
  { id: "2y", label: "last 2 years", short: "2 years", months: 24 },
  { id: "12m", label: "last 12 months", short: "12 months", months: 12 },
  { id: "all", label: "all", short: "all", months: null },
] as const;

export type OrderAge = (typeof ORDER_AGE_OPTIONS)[number]["id"];

export const DEFAULT_ORDER_AGE: OrderAge = "2y";

/** The URL parameter that holds the choice. */
export const ORDER_AGE_PARAM = "since";

function option(age: OrderAge) {
  return ORDER_AGE_OPTIONS.find((entry) => entry.id === age)!;
}

/** The choice from the URL; anything missing or unknown is the default. */
export function parseOrderAge(
  params: SearchParams | URLSearchParams | string | string[] | undefined,
): OrderAge {
  let value: string | string[] | undefined | null;
  if (params instanceof URLSearchParams) value = params.get(ORDER_AGE_PARAM);
  else if (typeof params === "object" && !Array.isArray(params)) value = params[ORDER_AGE_PARAM];
  else value = params;
  const text = Array.isArray(value) ? value[0] : value;
  return ORDER_AGE_OPTIONS.find((entry) => entry.id === text)?.id ?? DEFAULT_ORDER_AGE;
}

/** The first order date (`YYYY-MM-DD`, inclusive) that counts on `today`; `null` for all. */
export function orderAgeCutoff(age: OrderAge, today: string): string | null {
  const { months } = option(age);
  return months === null ? null : shiftMonths(today, -months);
}

/** `since=…` for links, or `""` for the default. */
export function orderAgeSearch(age: OrderAge): string {
  return age === DEFAULT_ORDER_AGE ? "" : `${ORDER_AGE_PARAM}=${age}`;
}

/** A query string (`""` or `?…`, as `filtersToSearch` gives) with the order-age choice added. */
export function withOrderAge(search: string, age: OrderAge): string {
  const extra = orderAgeSearch(age);
  if (!extra) return search;
  return search ? `${search}&${extra}` : `?${extra}`;
}

/** "orders from the last 2 years" / "orders from the last 12 months" / "all open orders". */
export function orderAgeScope(age: OrderAge): string {
  return age === "all" ? "orders of any age" : `orders from the ${option(age).label}`;
}
