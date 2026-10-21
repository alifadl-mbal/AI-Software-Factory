import "server-only";

import { UNASSIGNED_CODE } from "@/lib/filters";

import { BRAND_MAP } from "../brand-map";
import { run } from "../db";
import {
  ALL_OTHER,
  companyWhere as companyFilter,
  foldTop,
  labelOrUnassigned,
  num,
  UNASSIGNED,
} from "../sql";
import type { Binds, Query } from "../types";
import { companies } from "./common";
import type { FilterOption } from "./sales-filters";

/**
 * What the inventory figures cover: the selected companies, or the companies and the brand filter
 * (brand codes of the per-item map in `brand-map.ts`, `UNASSIGNED_CODE` for items without one). A
 * plain list is the companies alone, as the Overview and the item page pass it.
 */
export type StockScope = readonly string[] | { companies: readonly string[]; brands?: readonly string[] };

function scopeParts(scope: StockScope): { companies: readonly string[]; brands: readonly string[] } {
  return isCompanyList(scope)
    ? { companies: scope, brands: [] }
    : { companies: scope.companies, brands: scope.brands ?? [] };
}

function isCompanyList(scope: StockScope): scope is readonly string[] {
  return Array.isArray(scope);
}

/** The company and brand filters of one query: a join to add after its `FROM`, and a `WHERE` fragment. */
interface StockWhere {
  /** The brand map, LEFT JOINed as `brand_map` on the item code; empty without a brand filter. */
  join: string;
  /** `1 = 1` when every company and brand is selected. */
  sql: string;
  binds: Binds;
}

/**
 * The company and brand filters. Brand is the per-item map of `brand-map.ts`, as on Sales, but
 * joined and filtered on its brand code rather than tested with `IN (subquery)` as `salesWhere`
 * does: on live Orion the subquery made the reorder query (live stock × item master) run past the
 * 120 s call timeout, the join takes about 1 s. Items without a brand are `UNASSIGNED_CODE`.
 * `joined` says the query already joins the map as `brand_map`.
 */
function companyWhere(
  scope: StockScope,
  companyColumn: string,
  itemColumn: string,
  joined = false,
): StockWhere {
  const { companies: codes, brands } = scopeParts(scope);
  const company = companyFilter(codes, companyColumn);
  const clauses = company ? [company.sql] : [];
  const binds: Binds = { ...company?.binds };
  if (brands.length > 0) {
    brands.forEach((code, index) => {
      binds[`brand_${index}`] = code;
    });
    const list = brands.map((_, index) => `:brand_${index}`).join(", ");
    clauses.push(`COALESCE(brand_map.brand_code, '${UNASSIGNED_CODE}') IN (${list})`);
  }
  return {
    join:
      brands.length > 0 && !joined
        ? `
LEFT JOIN (${BRAND_MAP}) brand_map ON brand_map.item_code = TRIM(${itemColumn})`
        : "",
    sql: clauses.length > 0 ? clauses.join(" AND ") : "1 = 1",
    binds,
  };
}

/** The company and brand filters, narrowed to one item code when the item page passes one. */
function scopeWhere(
  scope: StockScope,
  companyColumn: string,
  item: string | undefined,
  itemColumn: string,
): StockWhere {
  const where = companyWhere(scope, companyColumn, itemColumn);
  if (item === undefined) return where;
  return {
    ...where,
    sql: `${where.sql} AND ${itemColumn} = :item_code`,
    binds: { ...where.binds, item_code: item },
  };
}

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
 *
 * Every query follows the brand filter (`StockScope`) through the per-item brand map, as Sales does
 * (see `companyWhere` for how); without one the SQL is exactly the company-only SQL. Stock has no
 * salesperson.
 *
 * The month-end trend and reorder alerts take an optional item code (`ZSL_ITEM_CODE`, `CS_ITEM_CODE`:
 * the code space of `ZF_ITEM.IM_ITEM_CODE`) for the item page; without one the SQL is the dashboard's.
 */

const STOCK = "MBALI.ZF_CURR_STK_BI";
const ITEM = "MBALI.ZF_ITEM";
const CLOSING = "MBALI.ZF_STK_MTH_SUMM_BI";

const TOTAL_QTY = "NVL(s.CS_UNCONF_QTY, 0)";
const AVAILABLE_QTY = `(${TOTAL_QTY} - NVL(s.CS_RESV_QTY, 0))`;
const STOCK_VALUE = "NVL(s.CS_VAL, 0)";
const AVAILABLE_VALUE = `(${AVAILABLE_QTY} * NVL(s.CS_WAC, 0))`;
const ITEM_JOIN = `LEFT JOIN ${ITEM} i ON i.IM_COMP_CODE = s.CS_COMP_CODE AND i.IM_ITEM_CODE = s.CS_ITEM_CODE`;

/**
 * Every distinct period from `:from_period` on, newest first, numbered from 1. Closing-stock queries
 * join to it and filter on the same bound, so Orion reads a few months instead of all 8M rows (the
 * trend took 3.4 s and dead stock up to 5.5 s without it).
 */
const RANKED_PERIODS = `periods AS (
    SELECT period, ROW_NUMBER() OVER (ORDER BY period DESC) AS rn
    FROM (
        SELECT DISTINCT ZSL_PERIOD AS period FROM ${CLOSING}
        WHERE ZSL_PERIOD >= :from_period
    ) distinct_periods
)`;

/** Months of slack before the newest `count` periods, in case Orion's month-end run is late. */
const PERIOD_SLACK = 3;

/**
 * The oldest period (`YYYYMM`) a query for the newest `count` periods reads, as of `today`: `count`
 * months back plus some slack. The ranking still picks the newest periods from there on.
 */
export function fromPeriod(today: string, count: number): string {
  const months = Number(today.slice(0, 4)) * 12 + Number(today.slice(5, 7)) - 1 - (count - 1) - PERIOD_SLACK;
  return `${Math.floor(months / 12)}${String((months % 12) + 1).padStart(2, "0")}`;
}

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
  /** Only meaningful for one item. */
  closeQty: number;
  /** Part of `closeValue` on lines with a negative closing quantity (so a negative amount). */
  negativeValue: number;
  negativeLines: number;
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

export function kpiQuery(scope: StockScope): Query {
  const where = companyWhere(scope, "s.CS_COMP_CODE", "s.CS_ITEM_CODE");
  return {
    sql: `
SELECT
    SUM(${STOCK_VALUE}) AS stock_value,
    SUM(${AVAILABLE_VALUE}) AS available_value,
    COUNT(DISTINCT CASE WHEN ${TOTAL_QTY} > 0 THEN s.CS_COMP_CODE || '-' || s.CS_ITEM_CODE END) AS stocked_items,
    SUM(CASE WHEN i.IM_FRZ_FLAG = 'Freeze' THEN ${STOCK_VALUE} ELSE 0 END) AS frozen_value,
    SUM(CASE WHEN i.IM_ITEM_CODE IS NULL THEN ${STOCK_VALUE} ELSE 0 END) AS unmatched_value
FROM ${STOCK} s
${ITEM_JOIN}${where.join}
WHERE ${where.sql}`,
    binds: where.binds,
  };
}

/** Live stock value by one dimension. With `topN`, the rest is folded into 'All other'. */
export function breakdownQuery(scope: StockScope, dimension: InventoryDimension, topN?: number): Query {
  // labelOrUnassigned trims, which also takes the padding off CS_GRADE.
  const label = labelOrUnassigned(DIMENSIONS[dimension]);
  const where = companyWhere(scope, "s.CS_COMP_CODE", "s.CS_ITEM_CODE");
  const grouped = `
SELECT ${label} AS label, SUM(${STOCK_VALUE}) AS stock_value
FROM ${STOCK} s${where.join}
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

/**
 * Closing stock value of the newest `periods` periods as of `today`, oldest first, with the part of
 * it on lines with a negative closing quantity (month-end stock can go below zero; live stock can't).
 */
export function monthEndQuery(
  scope: StockScope,
  today: string,
  periods = TREND_PERIODS,
  item?: string,
): Query {
  const where = scopeWhere(scope, "z.ZSL_COMP_CODE", item, "z.ZSL_ITEM_CODE");
  return {
    sql: `
WITH ${RANKED_PERIODS}
SELECT z.ZSL_PERIOD AS period, SUM(NVL(z.ZSL_CLOSE_VAL, 0)) AS close_value,
    SUM(NVL(z.ZSL_CLOSE_QTY, 0)) AS close_qty,
    SUM(CASE WHEN z.ZSL_CLOSE_QTY < 0 THEN NVL(z.ZSL_CLOSE_VAL, 0) ELSE 0 END) AS negative_value,
    SUM(CASE WHEN z.ZSL_CLOSE_QTY < 0 THEN 1 ELSE 0 END) AS negative_lines
FROM ${CLOSING} z
JOIN periods p ON p.period = z.ZSL_PERIOD${where.join}
WHERE z.ZSL_PERIOD >= :from_period AND p.rn <= :period_count AND ${where.sql}
GROUP BY z.ZSL_PERIOD
ORDER BY z.ZSL_PERIOD`,
    binds: { ...where.binds, from_period: fromPeriod(today, periods), period_count: periods },
  };
}

/**
 * Items (per company × location, grades added together) holding stock with no movement for the
 * last `months` months: the same closing qty, above zero, in each of the newest `months + 1`
 * periods. Ranked by closing value, with the count and value of every dead item on each row.
 */
export function deadStockQuery(
  scope: StockScope,
  months: DeadStockMonths,
  today: string,
  topN = DEAD_STOCK_TOP_N,
): Query {
  const where = companyWhere(scope, "z.ZSL_COMP_CODE", "z.ZSL_ITEM_CODE");
  return {
    sql: `
WITH ${RANKED_PERIODS},
keyed AS (
    SELECT z.ZSL_COMP_CODE AS comp_code, z.ZSL_LOCN_CODE AS locn_code, z.ZSL_ITEM_CODE AS item_code,
        p.rn, MAX(z.ZSL_PERIOD) AS period, MAX(z.ZSL_LOCN_NAME) AS locn_name, MAX(z.ZSL_ITEM_NAME) AS item_name,
        SUM(NVL(z.ZSL_CLOSE_QTY, 0)) AS close_qty, SUM(NVL(z.ZSL_CLOSE_VAL, 0)) AS close_value
    FROM ${CLOSING} z
    JOIN periods p ON p.period = z.ZSL_PERIOD${where.join}
    WHERE z.ZSL_PERIOD >= :from_period AND p.rn <= :period_count AND ${where.sql}
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
    binds: {
      ...where.binds,
      from_period: fromPeriod(today, months + 1),
      period_count: months + 1,
      top_n: topN,
    },
  };
}

/**
 * Active items at or below their reorder level, per company × location × item (grades added
 * together). Only items with a reorder level above zero alert.
 */
export function reorderAlertsQuery(scope: StockScope, item?: string): Query {
  const where = scopeWhere(scope, "s.CS_COMP_CODE", item, "s.CS_ITEM_CODE");
  return {
    // A LEFT JOIN like everywhere else; the WHERE on the item columns then keeps only matched,
    // active items, which is right here: an item with no master row has no reorder level.
    sql: `
SELECT s.CS_COMP_CODE AS comp_code, s.CS_LOCN_CODE AS locn_code, MAX(s.CS_LOCN_NAME) AS locn_name,
    s.CS_ITEM_CODE AS item_code, MAX(s.CS_ITEM_NAME) AS item_name,
    SUM(${AVAILABLE_QTY}) AS available_qty,
    MAX(i.IM_RORD_LVL) AS reorder_level, MAX(i.IM_RORD_QTY) AS reorder_qty
FROM ${STOCK} s
${ITEM_JOIN}${where.join}
WHERE i.IM_FRZ_FLAG = 'Active' AND i.IM_RORD_LVL > 0 AND ${where.sql}
GROUP BY s.CS_COMP_CODE, s.CS_LOCN_CODE, s.CS_ITEM_CODE
HAVING SUM(${AVAILABLE_QTY}) <= MAX(i.IM_RORD_LVL)
ORDER BY SUM(${AVAILABLE_QTY}) - MAX(i.IM_RORD_LVL), s.CS_COMP_CODE, s.CS_LOCN_CODE, s.CS_ITEM_CODE`,
    binds: where.binds,
  };
}

export interface StockLocation {
  companyCode: string;
  company: string;
  locationCode: string;
  location: string;
  qty: number;
  availableQty: number;
  reservedQty: number;
  value: number;
  availableValue: number;
  reservedValue: number;
}

/**
 * One item's live stock per company × location (grades added together), with the same quantity
 * and value rules as the dashboard's KPIs, so its rows add up to the item's share of them.
 */
export function stockByLocationQuery(scope: StockScope, item: string): Query {
  const where = scopeWhere(scope, "s.CS_COMP_CODE", item, "s.CS_ITEM_CODE");
  return {
    sql: `
SELECT s.CS_COMP_CODE AS comp_code, s.CS_LOCN_CODE AS locn_code, MAX(s.CS_LOCN_NAME) AS locn_name,
    SUM(${TOTAL_QTY}) AS total_qty, SUM(${AVAILABLE_QTY}) AS available_qty,
    SUM(${STOCK_VALUE}) AS stock_value, SUM(${AVAILABLE_VALUE}) AS available_value
FROM ${STOCK} s${where.join}
WHERE ${where.sql}
GROUP BY s.CS_COMP_CODE, s.CS_LOCN_CODE
ORDER BY SUM(${STOCK_VALUE}) DESC, s.CS_COMP_CODE, s.CS_LOCN_CODE`,
    binds: where.binds,
  };
}

/** Headline figures for live stock. */
export async function inventoryKpis(scope: StockScope): Promise<InventoryKpis> {
  const [row] = await run(kpiQuery(scope));
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
  scope: StockScope,
  dimension: InventoryDimension,
  topN?: number,
): Promise<StockBreakdownRow[]> {
  const [rows, names] = await Promise.all([
    run(breakdownQuery(scope, dimension, topN)),
    dimension === "company" ? companyNames() : Promise.resolve(new Map<string, string>()),
  ]);
  return rows.map((row) => ({
    label: names.get(String(row.label)) ?? String(row.label),
    value: num(row.stock_value),
  }));
}

/** Closing value of the newest periods as of `today`, oldest first. */
export async function monthEndTrend(
  scope: StockScope,
  today: string,
  periods = TREND_PERIODS,
  item?: string,
): Promise<MonthEnd[]> {
  const rows = await run(monthEndQuery(scope, today, periods, item));
  return rows.map((row) => ({
    month: periodToMonth(row.period),
    closeValue: num(row.close_value),
    closeQty: num(row.close_qty),
    negativeValue: num(row.negative_value),
    negativeLines: num(row.negative_lines),
  }));
}

export async function deadStock(
  scope: StockScope,
  months: DeadStockMonths,
  today: string,
  topN = DEAD_STOCK_TOP_N,
): Promise<DeadStock> {
  const [rows, names] = await Promise.all([run(deadStockQuery(scope, months, today, topN)), companyNames()]);
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

export async function reorderAlerts(scope: StockScope, item?: string): Promise<ReorderAlert[]> {
  const [rows, names] = await Promise.all([run(reorderAlertsQuery(scope, item)), companyNames()]);
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

/** One item's live stock per company × location, largest value first; companies by name. */
export async function stockByLocation(scope: StockScope, item: string): Promise<StockLocation[]> {
  const [rows, names] = await Promise.all([run(stockByLocationQuery(scope, item)), companyNames()]);
  return rows.map((row) => {
    const qty = num(row.total_qty);
    const availableQty = num(row.available_qty);
    const value = num(row.stock_value);
    const availableValue = num(row.available_value);
    return {
      companyCode: String(row.comp_code),
      company: names.get(String(row.comp_code)) ?? String(row.comp_code),
      locationCode: String(row.locn_code),
      location: row.locn_name ? String(row.locn_name) : String(row.locn_code),
      qty,
      availableQty,
      reservedQty: qty - availableQty,
      value,
      availableValue,
      reservedValue: value - availableValue,
    };
  });
}

// ---------------------------------------------------------------------------------------------
// Month-end hover card and drill-down

/** Slices per dimension on the hover card; the rest fold into 'All other'. */
export const HOVER_TOP_N = 5;
/** Rows the month-end drill-down lists (the largest values); its totals cover every item. */
export const MONTH_END_ITEM_LIMIT = 500;

/** What the hover card of a month-end bar breaks it down by. */
export const MONTH_END_DIMENSIONS = ["company", "brand", "itemGroup"] as const;
export type MonthEndDimension = (typeof MONTH_END_DIMENSIONS)[number];

/** Result-row aliases of the dimensions (rows come back with lower-case keys). */
const MONTH_END_ALIASES: Record<MonthEndDimension, string> = {
  company: "company_label",
  brand: "brand_label",
  itemGroup: "group_label",
};

/**
 * Month-end lines with each item's brand (the per-item map, as the brand filter) and item group
 * (`ZF_ITEM.IM_GROUP_NAME`; the closing view has no item group). Both joins are LEFT and match at
 * most one row, so no line is lost or counted twice.
 */
const CLOSING_WITH_ITEM = `${CLOSING} z
LEFT JOIN ${ITEM} i ON i.IM_COMP_CODE = z.ZSL_COMP_CODE AND i.IM_ITEM_CODE = z.ZSL_ITEM_CODE
LEFT JOIN (${BRAND_MAP}) brand_map ON brand_map.item_code = TRIM(z.ZSL_ITEM_CODE)`;

const MONTH_END_LABELS: Record<MonthEndDimension, string> = {
  company: labelOrUnassigned("z.ZSL_COMP_CODE"),
  brand: labelOrUnassigned("brand_map.brand_name"),
  itemGroup: labelOrUnassigned("i.IM_GROUP_NAME"),
};

/** `2026-10` → `202610`. */
export function monthToPeriod(month: string): string {
  return month.replace("-", "");
}

/** `2026-10` → `2025-10`. */
function yearEarlier(month: string): string {
  return `${Number(month.slice(0, 4)) - 1}${month.slice(4)}`;
}

/**
 * Closing value of one month-end and of the same month-end a year earlier, by company × brand ×
 * item group. One small aggregate per card: its totals and every section come from it, so each
 * section adds up to the bar.
 */
export function monthEndHoverQuery(scope: StockScope, month: string): Query {
  const where = companyWhere(scope, "z.ZSL_COMP_CODE", "z.ZSL_ITEM_CODE", true);
  const labels = MONTH_END_DIMENSIONS.map((dimension) => MONTH_END_LABELS[dimension]);
  return {
    sql: `
SELECT z.ZSL_PERIOD AS period, ${MONTH_END_DIMENSIONS.map(
      (dimension) => `${MONTH_END_LABELS[dimension]} AS ${MONTH_END_ALIASES[dimension]}`,
    ).join(", ")},
    SUM(NVL(z.ZSL_CLOSE_VAL, 0)) AS close_value
FROM ${CLOSING_WITH_ITEM}
WHERE z.ZSL_PERIOD IN (:period, :last_year_period) AND ${where.sql}
GROUP BY z.ZSL_PERIOD, ${labels.join(", ")}`,
    binds: {
      ...where.binds,
      period: monthToPeriod(month),
      last_year_period: monthToPeriod(yearEarlier(month)),
    },
  };
}

export interface MonthEndHover {
  /** `YYYY-MM`. */
  month: string;
  closeValue: number;
  /** The same month-end a year earlier. */
  lastYearCloseValue: number;
  breakdowns: { dimension: MonthEndDimension; rows: StockBreakdownRow[] }[];
}

/**
 * What one month-end bar is made of: its closing value, the same month-end last year, and the top
 * `HOVER_TOP_N` companies, brands and item groups plus 'All other'. Companies are shown by name.
 */
export async function monthEndHover(scope: StockScope, month: string): Promise<MonthEndHover> {
  const [rows, names] = await Promise.all([run(monthEndHoverQuery(scope, month)), companyNames()]);
  const period = monthToPeriod(month);
  const current = rows.filter((row) => String(row.period).trim() === period);
  const sum = (list: typeof rows) => list.reduce((total, row) => total + num(row.close_value), 0);
  return {
    month,
    closeValue: sum(current),
    lastYearCloseValue: sum(rows.filter((row) => String(row.period).trim() !== period)),
    breakdowns: MONTH_END_DIMENSIONS.map((dimension) => {
      const slices = current.map((row) => {
        const code = String(row[MONTH_END_ALIASES[dimension]]);
        return {
          label: dimension === "company" ? (names.get(code) ?? code) : code,
          value: num(row.close_value),
        };
      });
      return { dimension, rows: foldTop(slices, HOVER_TOP_N) };
    }),
  };
}

export interface MonthEndItem {
  companyCode: string;
  company: string;
  itemCode: string;
  item: string;
  brand: string;
  itemGroup: string;
  closeQty: number;
  closeValue: number;
}

export interface MonthEndItems {
  /** `YYYY-MM`. */
  month: string;
  /** Every item of the month-end, not only the listed ones. */
  count: number;
  /** The bar: the closing value of every item. */
  closeValue: number;
  /** The largest {@link MONTH_END_ITEM_LIMIT} by closing value. */
  rows: MonthEndItem[];
}

/**
 * One month-end's items (company × item, locations and grades added together), largest closing
 * value first, with the count and value of all of them on every row. Items whose lines are all
 * zero are left out: they add nothing to the bar.
 */
export function monthEndItemsQuery(scope: StockScope, month: string, limit = MONTH_END_ITEM_LIMIT): Query {
  const where = companyWhere(scope, "z.ZSL_COMP_CODE", "z.ZSL_ITEM_CODE", true);
  return {
    sql: `
WITH items AS (
    SELECT z.ZSL_COMP_CODE AS comp_code, z.ZSL_ITEM_CODE AS item_code, MAX(z.ZSL_ITEM_NAME) AS item_name,
        MAX(${MONTH_END_LABELS.brand}) AS brand, MAX(${MONTH_END_LABELS.itemGroup}) AS item_group,
        SUM(NVL(z.ZSL_CLOSE_QTY, 0)) AS close_qty, SUM(NVL(z.ZSL_CLOSE_VAL, 0)) AS close_value
    FROM ${CLOSING_WITH_ITEM}
    WHERE z.ZSL_PERIOD = :period AND ${where.sql}
    GROUP BY z.ZSL_COMP_CODE, z.ZSL_ITEM_CODE
    HAVING SUM(NVL(z.ZSL_CLOSE_VAL, 0)) <> 0 OR SUM(NVL(z.ZSL_CLOSE_QTY, 0)) <> 0
)
SELECT comp_code, item_code, item_name, brand, item_group, close_qty, close_value, total_count, total_value
FROM (
    SELECT items.*,
        ROW_NUMBER() OVER (ORDER BY close_value DESC, comp_code, item_code) AS row_num,
        COUNT(*) OVER () AS total_count,
        SUM(close_value) OVER () AS total_value
    FROM items
) ranked
WHERE row_num <= :row_limit
ORDER BY row_num`,
    binds: { ...where.binds, period: monthToPeriod(month), row_limit: limit },
  };
}

/** The drill-down of a month-end bar: its items, largest first; companies by name. */
export async function monthEndItems(
  scope: StockScope,
  month: string,
  limit = MONTH_END_ITEM_LIMIT,
): Promise<MonthEndItems> {
  const [rows, names] = await Promise.all([run(monthEndItemsQuery(scope, month, limit)), companyNames()]);
  return {
    month,
    count: num(rows[0]?.total_count),
    closeValue: num(rows[0]?.total_value),
    rows: rows.map((row) => ({
      companyCode: String(row.comp_code),
      company: names.get(String(row.comp_code)) ?? String(row.comp_code),
      itemCode: String(row.item_code),
      item: row.item_name ? String(row.item_name) : String(row.item_code),
      brand: row.brand ? String(row.brand) : UNASSIGNED,
      itemGroup: row.item_group ? String(row.item_group) : UNASSIGNED,
      closeQty: num(row.close_qty),
      closeValue: num(row.close_value),
    })),
  };
}

// ---------------------------------------------------------------------------------------------
// Brand filter choices

/** Brands of the items in live stock for the selected companies, the brand filter ignored. */
export function stockBrandOptionsQuery(companyCodes: readonly string[]): Query {
  const where = companyWhere(companyCodes, "s.CS_COMP_CODE", "s.CS_ITEM_CODE");
  return {
    sql: `
SELECT COALESCE(brand_map.brand_code, '${UNASSIGNED_CODE}') AS code, MAX(brand_map.brand_name) AS name
FROM (
    SELECT DISTINCT TRIM(s.CS_ITEM_CODE) AS item_code
    FROM ${STOCK} s
    WHERE ${where.sql}
) stocked
LEFT JOIN (${BRAND_MAP}) brand_map ON brand_map.item_code = stocked.item_code
GROUP BY COALESCE(brand_map.brand_code, '${UNASSIGNED_CODE}')`,
    binds: where.binds,
  };
}

/** The brand filter's choices on the Inventory page, unsorted. */
export async function stockBrandOptions(companyCodes: readonly string[]): Promise<FilterOption[]> {
  const rows = await run(stockBrandOptionsQuery(companyCodes));
  return rows.map((row) => ({ code: String(row.code), name: row.name ? String(row.name) : "" }));
}
