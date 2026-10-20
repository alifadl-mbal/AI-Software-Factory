import { filtersToSearch, type Filters } from "./filters";

/** The customer pages live under this path; they are detail pages, not in the sidebar. */
export const CUSTOMERS_PATH = "/customers";

/**
 * The customer page of `code`, keeping the period and companies of `filters` (or an already built
 * query string such as `?range=mtd`), so following a link never resets the filters.
 */
export function customerHref(
  code: string,
  filters: Pick<Filters, "range" | "start" | "end" | "companies"> | string,
) {
  const search = typeof filters === "string" ? filters : filtersToSearch(filters);
  return `${CUSTOMERS_PATH}/${encodeURIComponent(code)}${search}`;
}

export function isCustomerPath(pathname: string): boolean {
  return pathname.startsWith(`${CUSTOMERS_PATH}/`);
}
