import { addDays, UNASSIGNED_CODE, type Filters, type SalesFilterKey } from "@/lib/filters";

import { BRAND_VIEW } from "./brand-map";
import type { Binds } from "./types";

/** Label for blank dimension values. They are shown, never dropped. */
export const UNASSIGNED = "Unassigned";
/** Label for the rows folded together beyond a top-N list. */
export const ALL_OTHER = "All other";

/** SQL expression that shows a blank dimension value as 'Unassigned' instead of dropping it. */
export function labelOrUnassigned(column: string): string {
  return `COALESCE(NULLIF(TRIM(${column}), ''), '${UNASSIGNED}')`;
}

/**
 * The `WHERE` fragment for the shared filters, and its binds.
 *
 * Column names come from query code, never from users. Every user-chosen value travels as a bind
 * variable. The end date becomes an exclusive upper bound so Oracle `DATE` values with a time part
 * on the last day are still included.
 */
export function filterWhere(
  filters: Pick<Filters, "start" | "end" | "companies"> & Partial<Pick<Filters, SalesFilterKey>>,
  dateColumn: string,
  companyColumn: string,
  salesColumns?: SalesColumns,
): { sql: string; binds: Binds } {
  const clauses = [
    `${dateColumn} >= TO_DATE(:start_date, 'YYYY-MM-DD')`,
    `${dateColumn} < TO_DATE(:end_date_exclusive, 'YYYY-MM-DD')`,
  ];
  const binds: Binds = {
    start_date: filters.start,
    end_date_exclusive: addDays(filters.end, 1),
  };
  const company = companyWhere(filters.companies, companyColumn);
  if (company) {
    clauses.push(company.sql);
    Object.assign(binds, company.binds);
  }
  const sales = salesColumns && salesWhere(filters, salesColumns);
  if (sales) {
    clauses.push(sales.sql);
    Object.assign(binds, sales.binds);
  }
  return { sql: clauses.join(" AND "), binds };
}

/**
 * The columns a view filters salesperson and brand on. Leave one out and that filter isn't applied:
 * only views with sales lines have them, and the top bar disables the filters elsewhere.
 */
export interface SalesColumns {
  /** Salesperson code, in the code space of `ZF_CSL_BI.CSL_SM_CODE`. */
  salesperson?: string;
  /** Item code; brand comes from the per-item map in `brand-map.ts`. */
  item?: string;
}

/** `name_0, name_1, …` binds for `values`, and the `:name_0, :name_1` list to put in SQL. */
function bindList(prefix: string, values: readonly string[]): { list: string; binds: Binds } {
  const binds: Binds = {};
  values.forEach((value, index) => {
    binds[`${prefix}_${index}`] = value;
  });
  return {
    list: Object.keys(binds)
      .map((name) => `:${name}`)
      .join(", "),
    binds,
  };
}

/** `clauses` as one predicate: OR-ed in brackets when there are several. */
function anyOf(clauses: string[]): string {
  return clauses.length === 1 ? clauses[0] : `(${clauses.join(" OR ")})`;
}

/**
 * The salesperson and brand part of `filterWhere` on its own, for queries that build their own
 * date or company clauses. `undefined` when neither filter narrows anything. `UNASSIGNED_CODE`
 * matches lines with no salesperson, or items with no brand (or no item code).
 */
export function salesWhere(
  filters: Partial<Pick<Filters, SalesFilterKey>>,
  columns: SalesColumns,
): { sql: string; binds: Binds } | undefined {
  const clauses: string[] = [];
  const binds: Binds = {};
  const salespeople = filters.salespeople ?? [];
  if (columns.salesperson && salespeople.length > 0) {
    const codes = bindList(
      "salesperson",
      salespeople.filter((code) => code !== UNASSIGNED_CODE),
    );
    const any: string[] = [];
    if (codes.list) any.push(`TRIM(${columns.salesperson}) IN (${codes.list})`);
    if (salespeople.includes(UNASSIGNED_CODE)) any.push(`NULLIF(TRIM(${columns.salesperson}), '') IS NULL`);
    clauses.push(anyOf(any));
    Object.assign(binds, codes.binds);
  }
  const brands = filters.brands ?? [];
  if (columns.item && brands.length > 0) {
    const codes = bindList(
      "brand",
      brands.filter((code) => code !== UNASSIGNED_CODE),
    );
    const item = `TRIM(${columns.item})`;
    const any: string[] = [];
    if (codes.list) {
      any.push(`${item} IN (SELECT TRIM("Item") FROM ${BRAND_VIEW} WHERE TRIM("Brand") IN (${codes.list}))`);
    }
    if (brands.includes(UNASSIGNED_CODE)) {
      // NOT EXISTS, not NOT IN: one NULL item in the map would make NOT IN match nothing.
      any.push(
        `(NULLIF(${item}, '') IS NULL OR NOT EXISTS (SELECT 1 FROM ${BRAND_VIEW} brand_map WHERE TRIM(brand_map."Item") = ${item} AND NULLIF(TRIM(brand_map."Brand"), '') IS NOT NULL))`,
      );
    }
    clauses.push(anyOf(any));
    Object.assign(binds, codes.binds);
  }
  return clauses.length > 0 ? { sql: clauses.join(" AND "), binds } : undefined;
}

/**
 * The company-filter part of `filterWhere` on its own, for "as of today" views that ignore the
 * date range. `undefined` when every company is selected.
 */
export function companyWhere(
  companies: readonly string[],
  companyColumn: string,
): { sql: string; binds: Binds } | undefined {
  if (companies.length === 0) return undefined;
  const names = companies.map((_, index) => `company_${index}`);
  const binds: Binds = {};
  names.forEach((name, index) => {
    binds[name] = companies[index];
  });
  return { sql: `${companyColumn} IN (${names.map((name) => `:${name}`).join(", ")})`, binds };
}

/** Numeric column from a result row; `NULL` (an empty SUM) counts as 0. */
export function num(value: unknown): number {
  if (value === null || value === undefined) return 0;
  const result = Number(value);
  return Number.isFinite(result) ? result : 0;
}
