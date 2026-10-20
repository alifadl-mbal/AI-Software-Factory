import { addDays, type Filters } from "@/lib/filters";

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
  filters: Pick<Filters, "start" | "end" | "companies">,
  dateColumn: string,
  companyColumn: string,
): { sql: string; binds: Binds } {
  const clauses = [
    `${dateColumn} >= TO_DATE(:start_date, 'YYYY-MM-DD')`,
    `${dateColumn} < TO_DATE(:end_date_exclusive, 'YYYY-MM-DD')`,
  ];
  const binds: Binds = {
    start_date: filters.start,
    end_date_exclusive: addDays(filters.end, 1),
  };
  if (filters.companies.length > 0) {
    const company = companyWhere(filters.companies, companyColumn);
    clauses.push(company.sql);
    Object.assign(binds, company.binds);
  }
  return { sql: clauses.join(" AND "), binds };
}

/**
 * The `WHERE` fragment for the company filter alone, for views without a date filter (live stock).
 * No companies means all of them: the fragment is then `1 = 1`.
 */
export function companyWhere(companies: string[], companyColumn: string): { sql: string; binds: Binds } {
  if (companies.length === 0) return { sql: "1 = 1", binds: {} };
  const names = companies.map((_, index) => `company_${index}`);
  return {
    sql: `${companyColumn} IN (${names.map((name) => `:${name}`).join(", ")})`,
    binds: Object.fromEntries(names.map((name, index) => [name, companies[index]])),
  };
}

/** Numeric column from a result row; `NULL` (an empty SUM) counts as 0. */
export function num(value: unknown): number {
  if (value === null || value === undefined) return 0;
  const result = Number(value);
  return Number.isFinite(result) ? result : 0;
}
