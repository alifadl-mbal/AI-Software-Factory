import "server-only";

import { run } from "../db";
import { ALL_OTHER, companyWhere, labelOrUnassigned, num } from "../sql";
import type { Query } from "../types";
import { companies } from "./common";

/**
 * Inventory dashboard queries on three Orion views:
 *
 * - `MBALI.ZF_CURR_STK_BI`, live stock, one row per company × location × item × grade.
 * - `MBALI.ZF_STK_MTH_SUMM_BI`, month-end stock, one row per period × company × location × item ×
 *   grade 1 × grade 2. Every key carries a row in every period, zero quantities included.
 * - `MBALI.ZF_ITEM`, the item master, unique on `(IM_COMP_CODE, IM_ITEM_CODE)`.
 *
 * Business rules (see the mbal-db skill, `references/business-rules.md`):
 * - The live view has no `CS_AVAILABLE_QTY` / `CS_TOTAL_WAC*` columns: those are aliases the BI
 *   extract adds. Total qty = `CS_UNCONF_QTY`; available qty = `CS_UNCONF_QTY − CS_RESV_QTY`;
 *   stock value = `CS_VAL` (= qty × WAC); available value = available qty × `CS_WAC`. Reserved
 *   value = stock value − available value.
 * - `CS_GRADE` is space-padded: always `TRIM()` it.
 * - Item master joins are LEFT JOINs: about 1% of stock keys have no item row and still count.
 * - `IM_FRZ_FLAG` holds the words `Active` / `Freeze`. Reorder alerts cover `Active` items only.
 *   `IM_ABC` is unmaintained and never used.
 * - `ZSL_PERIOD` is `YYYYMM` (CHAR(6) in Oracle). The view has no opening quantity, so movement in a
 *   month is its closing qty minus the previous month's closing qty. The current month keeps
 *   receiving adjustments and is shown as provisional.
 * - The date filter doesn't apply: live stock is as of today, the trend is the last 24 periods.
 */

const STOCK = "MBALI.ZF_CURR_STK_BI";
const ITEM = "MBALI.ZF_ITEM";
const CLOSING = "MBALI.ZF_STK_MTH_SUMM_BI";

const TOTAL_QTY = "NVL(s.CS_UNCONF_QTY, 0)";
const AVAILABLE_QTY = `(${TOTAL_QTY} - NVL(s.CS_RESV_QTY, 0))`;
const STOCK_VALUE = "NVL(s.CS_VAL, 0)";
const AVAILABLE_VALUE = `(${AVAILABLE_QTY} * NVL(s.CS_WAC, 0))`;
const ITEM_JOIN = `LEFT JOIN ${ITEM} i ON i.IM_COMP_CODE = s.CS_COMP_CODE AND i.IM_ITEM_CODE = s.CS_ITEM_CODE`;

/** Every distinct period, newest first, numbered from 1. Closing-stock queries join to it. */
const RANKED_PERIODS = `periods AS (
    SELECT period, ROW_NUMBER() OVER (ORDER BY period DESC) AS rn
    FROM (SELECT DISTINCT ZSL_PERIOD AS period FROM ${CLOSING} WHERE ZSL_PERIOD IS NOT NULL) distinct_periods
)`;

/** Dimension → live-stock column, for the breakdowns. */
export const DIMENSIONS = {
  company: "s.CS_COMP_CODE",
  location: "s.CS_LOCN_NAME",
  itemGroup: "s.CS_GROUP_NAME",
  grade: "s.CS_GRADE",
} as const;

export type InventoryDimension = keyof typeof DIMENSIONS;

/** Months without movement that make stock "dead"; the page toggles between them. */
export const DEAD_STOCK_MONTHS = [3, 6, 12] as const;
export type DeadStockMonths = (typeof DEAD_STOCK_MONTHS)[number];
export const DEFAULT_DEAD_STOCK_MONTHS: DeadStockMonths = 6;
/** Rows listed in the dead-stock table; the total covers every dead item. */
export const DEAD_STOCK_TOP_N = 100;
/** Periods in the month-end trend. */
export const TREND_PERIODS = 24;

export interface InventoryKpis {
  stockValue: number;
  availableValue: number;
  reservedValue: number;
  /** Distinct company × item with a quantity on hand. */
  stockedItems: number;
  /** Stock value of items frozen in the item master. */
  frozenValue: number;
  /** Stock value of items with no item master row (still in every total). */
  unmatchedValue: number;
}

export interface MonthEnd {
  /** `YYYY-MM`. */
  month: string;
  closeValue: number;
}

export interface StockBreakdownRow {
  label: string;
  value: number;
}

export interface DeadStockRow {
  companyCode: string;
  company: string;
  location: string;
  itemCode: string;
  item: string;
  closeQty: number;
  closeValue: number;
}

export interface DeadStock {
  months: DeadStockMonths;
  /** The newest period the check ends on, `YYYY-MM`; `null` with no closing data. */
  asOfMonth: string | null;
  /** Every dead item, not just the listed ones. */
  count: number;
  /** Value at risk: the closing value of every dead item. */
  value: number;
  /** The top {@link DEAD_STOCK_TOP_N} by value. */
  rows: DeadStockRow[];
}

export interface ReorderAlert {
  companyCode: string;
  company: string;
  locationCode: string;
  location: string;
  itemCode: string;
  item: string;
  available: number;
  reorderLevel: number;
  reorderQty: number;
}

/** `202610` (number or CHAR) → `2026-10`. */
export function periodToMonth(period: unknown): string {
  const text = String(period).trim();
  return `${text.slice(0, 4)}-${text.slice(4, 6)}`;
}

/** The dead-stock toggle from the URL; anything else is the default. */
export function parseDeadStockMonths(value: string | string[] | undefined): DeadStockMonths {
  const months = Number(Array.isArray(value) ? value[0] : value);
  return DEAD_STOCK_MONTHS.find((option) => option === months) ?? DEFAULT_DEAD_STOCK_MONTHS;
}

async function companyNames(): Promise<Map<string, string>> {
  return new Map((await companies()).map((company) => [company.code, company.name]));
}

export function kpiQuery(companyCodes: string[]): Query {
  const where = companyWhere(companyCodes, "s.CS_COMP_CODE");
  return {
    sql: `
SELECT
    SUM(${STOCK_VALUE}) AS stock_value,
    SUM(${AVAILABLE_VALUE}) AS available_value,
    COUNT(DISTINCT CASE WHEN ${TOTAL_QTY} > 0 THEN s.CS_COMP_CODE || '-' || s.CS_ITEM_CODE END) AS stocked_items,
    SUM(CASE WHEN i.IM_FRZ_FLAG = 'Freeze' THEN ${STOCK_VALUE} ELSE 0 END) AS frozen_value,
    SUM(CASE WHEN i.IM_ITEM_CODE IS NULL THEN ${STOCK_VALUE} ELSE 0 END) AS unmatched_value
FROM ${STOCK} s
${ITEM_JOIN}
WHERE ${where.sql}`,
    binds: where.binds,
  };
}

/** Live stock value by one dimension. With `topN`, the rest is folded into 'All other'. */
export function breakdownQuery(companyCodes: string[], dimension: InventoryDimension, topN?: number): Query {
  // labelOrUnassigned trims, which also takes the padding off CS_GRADE.
  const label = labelOrUnassigned(DIMENSIONS[dimension]);
  const where = companyWhere(companyCodes, "s.CS_COMP_CODE");
  const grouped = `
SELECT ${label} AS label, SUM(${STOCK_VALUE}) AS stock_value
FROM ${STOCK} s
WHERE ${where.sql}
GROUP BY ${label}`;
  if (topN === undefined) {
    return { sql: `${grouped}\nORDER BY stock_value DESC, label`, binds: where.binds };
  }
  // As in sales: bucket in a subquery and group by the alias (Oracle rejects a bind in GROUP BY).
  return {
    sql: `
SELECT bucket AS label, SUM(stock_value) AS stock_value, MIN(rn) AS sort_order
FROM (
    SELECT CASE WHEN rn <= :top_n THEN label ELSE '${ALL_OTHER}' END AS bucket, stock_value, rn
    FROM (
        SELECT label, stock_value, ROW_NUMBER() OVER (ORDER BY stock_value DESC, label) AS rn
        FROM (${grouped}
        ) grouped
    ) ranked
) bucketed
GROUP BY bucket
ORDER BY sort_order`,
    binds: { ...where.binds, top_n: topN },
  };
}

/** Closing stock value of the newest `periods` periods, oldest first. */
export function monthEndQuery(companyCodes: string[], periods = TREND_PERIODS): Query {
  const where = companyWhere(companyCodes, "z.ZSL_COMP_CODE");
  return {
    sql: `
WITH ${RANKED_PERIODS}
SELECT z.ZSL_PERIOD AS period, SUM(NVL(z.ZSL_CLOSE_VAL, 0)) AS close_value
FROM ${CLOSING} z
JOIN periods p ON p.period = z.ZSL_PERIOD
WHERE p.rn <= :period_count AND ${where.sql}
GROUP BY z.ZSL_PERIOD
ORDER BY z.ZSL_PERIOD`,
    binds: { ...where.binds, period_count: periods },
  };
}

/**
 * Items (per company × location, grades added together) holding stock with no movement for the
 * last `months` months: the same closing qty, above zero, in each of the newest `months + 1`
 * periods. Ranked by closing value, with the count and value of every dead item on each row.
 */
export function deadStockQuery(
  companyCodes: string[],
  months: DeadStockMonths,
  topN = DEAD_STOCK_TOP_N,
): Query {
  const where = companyWhere(companyCodes, "z.ZSL_COMP_CODE");
  return {
    sql: `
WITH ${RANKED_PERIODS},
keyed AS (
    SELECT z.ZSL_COMP_CODE AS comp_code, z.ZSL_LOCN_CODE AS locn_code, z.ZSL_ITEM_CODE AS item_code,
        p.rn, MAX(z.ZSL_PERIOD) AS period, MAX(z.ZSL_LOCN_NAME) AS locn_name, MAX(z.ZSL_ITEM_NAME) AS item_name,
        SUM(NVL(z.ZSL_CLOSE_QTY, 0)) AS close_qty, SUM(NVL(z.ZSL_CLOSE_VAL, 0)) AS close_value
    FROM ${CLOSING} z
    JOIN periods p ON p.period = z.ZSL_PERIOD
    WHERE p.rn <= :period_count AND ${where.sql}
    GROUP BY z.ZSL_COMP_CODE, z.ZSL_LOCN_CODE, z.ZSL_ITEM_CODE, p.rn
),
dead AS (
    SELECT comp_code, locn_code, item_code,
        MAX(CASE WHEN rn = 1 THEN period END) AS period,
        MAX(locn_name) AS locn_name, MAX(item_name) AS item_name,
        SUM(CASE WHEN rn = 1 THEN close_qty ELSE 0 END) AS close_qty,
        SUM(CASE WHEN rn = 1 THEN close_value ELSE 0 END) AS close_value
    FROM keyed
    GROUP BY comp_code, locn_code, item_code
    HAVING COUNT(*) = :period_count AND MIN(close_qty) = MAX(close_qty) AND MIN(close_qty) > 0
)
SELECT comp_code, locn_code, item_code, period, locn_name, item_name, close_qty, close_value,
    total_count, total_value
FROM (
    SELECT dead.*,
        ROW_NUMBER() OVER (ORDER BY close_value DESC, comp_code, locn_code, item_code) AS row_num,
        COUNT(*) OVER () AS total_count,
        SUM(close_value) OVER () AS total_value
    FROM dead
) ranked
WHERE row_num <= :top_n
ORDER BY row_num`,
    binds: { ...where.binds, period_count: months + 1, top_n: topN },
  };
}

/**
 * Active items at or below their reorder level, per company × location × item (grades added
 * together). Only items with a reorder level above zero alert.
 */
export function reorderAlertsQuery(companyCodes: string[]): Query {
  const where = companyWhere(companyCodes, "s.CS_COMP_CODE");
  return {
    // A LEFT JOIN like everywhere else; the WHERE on the item columns then keeps only matched,
    // active items, which is right here: an item with no master row has no reorder level.
    sql: `
SELECT s.CS_COMP_CODE AS comp_code, s.CS_LOCN_CODE AS locn_code, MAX(s.CS_LOCN_NAME) AS locn_name,
    s.CS_ITEM_CODE AS item_code, MAX(s.CS_ITEM_NAME) AS item_name,
    SUM(${AVAILABLE_QTY}) AS available_qty,
    MAX(i.IM_RORD_LVL) AS reorder_level, MAX(i.IM_RORD_QTY) AS reorder_qty
FROM ${STOCK} s
${ITEM_JOIN}
WHERE i.IM_FRZ_FLAG = 'Active' AND i.IM_RORD_LVL > 0 AND ${where.sql}
GROUP BY s.CS_COMP_CODE, s.CS_LOCN_CODE, s.CS_ITEM_CODE
HAVING SUM(${AVAILABLE_QTY}) <= MAX(i.IM_RORD_LVL)
ORDER BY SUM(${AVAILABLE_QTY}) - MAX(i.IM_RORD_LVL), s.CS_COMP_CODE, s.CS_LOCN_CODE, s.CS_ITEM_CODE`,
    binds: where.binds,
  };
}

/** Headline figures for live stock. */
export async function inventoryKpis(companyCodes: string[]): Promise<InventoryKpis> {
  const [row] = await run(kpiQuery(companyCodes));
  const stockValue = num(row?.stock_value);
  const availableValue = num(row?.available_value);
  return {
    stockValue,
    availableValue,
    reservedValue: stockValue - availableValue,
    stockedItems: num(row?.stocked_items),
    frozenValue: num(row?.frozen_value),
    unmatchedValue: num(row?.unmatched_value),
  };
}

/** Live stock value by one dimension; companies are shown by name. */
export async function stockBreakdown(
  companyCodes: string[],
  dimension: InventoryDimension,
  topN?: number,
): Promise<StockBreakdownRow[]> {
  const [rows, names] = await Promise.all([
    run(breakdownQuery(companyCodes, dimension, topN)),
    dimension === "company" ? companyNames() : Promise.resolve(new Map<string, string>()),
  ]);
  return rows.map((row) => ({
    label: names.get(String(row.label)) ?? String(row.label),
    value: num(row.stock_value),
  }));
}

/** Closing value of the newest periods, oldest first. */
export async function monthEndTrend(companyCodes: string[], periods = TREND_PERIODS): Promise<MonthEnd[]> {
  const rows = await run(monthEndQuery(companyCodes, periods));
  return rows.map((row) => ({ month: periodToMonth(row.period), closeValue: num(row.close_value) }));
}

export async function deadStock(
  companyCodes: string[],
  months: DeadStockMonths,
  topN = DEAD_STOCK_TOP_N,
): Promise<DeadStock> {
  const [rows, names] = await Promise.all([run(deadStockQuery(companyCodes, months, topN)), companyNames()]);
  return {
    months,
    asOfMonth: rows[0] ? periodToMonth(rows[0].period) : null,
    count: num(rows[0]?.total_count),
    value: num(rows[0]?.total_value),
    rows: rows.map((row) => ({
      companyCode: String(row.comp_code),
      company: names.get(String(row.comp_code)) ?? String(row.comp_code),
      location: row.locn_name ? String(row.locn_name) : String(row.locn_code),
      itemCode: String(row.item_code),
      item: row.item_name ? String(row.item_name) : String(row.item_code),
      closeQty: num(row.close_qty),
      closeValue: num(row.close_value),
    })),
  };
}

export async function reorderAlerts(companyCodes: string[]): Promise<ReorderAlert[]> {
  const [rows, names] = await Promise.all([run(reorderAlertsQuery(companyCodes)), companyNames()]);
  return rows.map((row) => ({
    companyCode: String(row.comp_code),
    company: names.get(String(row.comp_code)) ?? String(row.comp_code),
    locationCode: String(row.locn_code),
    location: row.locn_name ? String(row.locn_name) : String(row.locn_code),
    itemCode: String(row.item_code),
    item: row.item_name ? String(row.item_name) : String(row.item_code),
    available: num(row.available_qty),
    reorderLevel: num(row.reorder_level),
    reorderQty: num(row.reorder_qty),
  }));
}
