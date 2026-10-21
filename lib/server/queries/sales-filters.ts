import "server-only";

import { UNASSIGNED_CODE, type Filters } from "@/lib/filters";

import { BRAND_MAP } from "../brand-map";
import { run } from "../db";
import { filterWhere, UNASSIGNED } from "../sql";
import type { Query } from "../types";

/**
 * The choices of the salesperson and brand filters: only salespeople and brands with sales lines
 * (`ZF_CSL_BI`, `INV` + `SARTN`) in the selected companies and period, so the lists cascade from
 * the company and date filters. They ignore the salesperson and brand filters themselves, so a
 * list never hides what could be added to it.
 *
 * Salesperson is `CSL_SM_CODE` (code) and `CSL_SM_NAME`; brand comes from the per-item brand map
 * (`lib/server/brand-map.ts`). Lines without either are offered as Unassigned (`UNASSIGNED_CODE`).
 */

const VIEW = "MBALI.ZF_CSL_BI";
const REVENUE_TXN_TYPES = "CSL_TXN_TYPE IN ('INV', 'SARTN')";
const SALESPERSON_CODE = `COALESCE(NULLIF(TRIM(CSL_SM_CODE), ''), '${UNASSIGNED_CODE}')`;

export interface FilterOption {
  code: string;
  name: string;
}

export interface SalesFilterOptions {
  salespeople: FilterOption[];
  brands: FilterOption[];
}

type Scope = Pick<Filters, "start" | "end" | "companies">;

function scopeWhere(filters: Scope) {
  return filterWhere(
    { start: filters.start, end: filters.end, companies: filters.companies },
    "CSL_DATE",
    "CSL_COMP_CODE",
  );
}

export function salespersonOptionsQuery(filters: Scope): Query {
  const { sql, binds } = scopeWhere(filters);
  return {
    sql: `
SELECT ${SALESPERSON_CODE} AS code, MAX(TRIM(CSL_SM_NAME)) AS name
FROM ${VIEW}
WHERE ${REVENUE_TXN_TYPES} AND ${sql}
GROUP BY ${SALESPERSON_CODE}`,
    binds,
  };
}

export function brandOptionsQuery(filters: Scope): Query {
  const { sql, binds } = scopeWhere(filters);
  return {
    sql: `
SELECT COALESCE(brand_map.brand_code, '${UNASSIGNED_CODE}') AS code, MAX(brand_map.brand_name) AS name
FROM (
    SELECT DISTINCT TRIM(CSL_ITEM_CODE) AS item_code
    FROM ${VIEW}
    WHERE ${REVENUE_TXN_TYPES} AND ${sql}
) sold
LEFT JOIN (${BRAND_MAP}) brand_map ON brand_map.item_code = sold.item_code
GROUP BY COALESCE(brand_map.brand_code, '${UNASSIGNED_CODE}')`,
    binds,
  };
}

/** By name, with Unassigned last. */
function toOptions(rows: Record<string, unknown>[]): FilterOption[] {
  return rows
    .map((row) => {
      const code = String(row.code);
      const name = code === UNASSIGNED_CODE ? UNASSIGNED : row.name ? String(row.name) : code;
      return { code, name };
    })
    .sort((a, b) =>
      a.code === UNASSIGNED_CODE
        ? 1
        : b.code === UNASSIGNED_CODE
          ? -1
          : a.name.localeCompare(b.name) || a.code.localeCompare(b.code),
    );
}

/** The salespeople and brands with sales in the selected companies and period. */
export async function salesFilterOptions(filters: Scope): Promise<SalesFilterOptions> {
  const [salespeople, brands] = await Promise.all([
    run(salespersonOptionsQuery(filters)),
    run(brandOptionsQuery(filters)),
  ]);
  return { salespeople: toOptions(salespeople), brands: toOptions(brands) };
}
