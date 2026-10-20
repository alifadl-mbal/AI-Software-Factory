import "server-only";

import { monthsInRange, previousYear, shiftMonth, type Filters } from "@/lib/filters";

import { run } from "../db";
import { ALL_OTHER, filterWhere, labelOrUnassigned, num } from "../sql";
import type { Query } from "../types";

/**
 * Sales dashboard queries on `MBALI.ZF_CSL_BI`, one row per invoice, delivery or return line.
 *
 * Business rules (see the mbal-db skill, `references/business-rules.md`):
 * - Net revenue = `SUM(NVL(CSL_NET_SL_VALUE, 0))` over `CSL_TXN_TYPE IN ('INV', 'SARTN')`.
 *   Return lines (`SARTN`) are already negative, so they subtract themselves.
 * - Returns = the `SARTN` part of that sum (a negative number).
 * - Cost = `SUM(NVL(CSL_WAC_VALUE, 0))` over the same rows; also negative on returns. Delivery
 *   notes (`INV` type, codes like `DNP`) carry the cost with zero revenue and the invoice raised
 *   from them carries the revenue with zero cost, so both must stay in.
 * - Gross margin = net revenue − cost.
 * - Never use `CSL_GROSS_SL_VALUE` (pre-discount) as revenue.
 * - Invoice count = distinct `comp-txn_code-no` documents of type `INV` with a non-zero net value;
 *   this leaves out the zero-value delivery notes.
 * - Blank dimension values show as 'Unassigned' and are never dropped.
 *
 * Every query takes an optional customer code (`CSL_CUST_CODE`, the code space of
 * `ZF_CUSTOMER.CUST_CODE`) for the customer page. Without one the SQL is exactly the dashboard's.
 */

const VIEW = "MBALI.ZF_CSL_BI";
const DATE_COLUMN = "CSL_DATE";
const COMPANY_COLUMN = "CSL_COMP_CODE";
const CUSTOMER_COLUMN = "CSL_CUST_CODE";
const REVENUE_TXN_TYPES = "CSL_TXN_TYPE IN ('INV', 'SARTN')";
const NET_VALUE = "NVL(CSL_NET_SL_VALUE, 0)";
const COST_VALUE = "NVL(CSL_WAC_VALUE, 0)";

const MEASURES = `
    SUM(${NET_VALUE}) AS net_revenue,
    SUM(${COST_VALUE}) AS cost,
    SUM(CASE WHEN CSL_TXN_TYPE = 'SARTN' THEN ${NET_VALUE} ELSE 0 END) AS returns_value,
    COUNT(DISTINCT CASE WHEN CSL_TXN_TYPE = 'INV' AND ${NET_VALUE} <> 0
        THEN CSL_COMP_CODE || '-' || CSL_TXN_CODE || '-' || CSL_NO END) AS invoice_count`;

/** Dimension → view column, for the breakdowns. */
export const DIMENSIONS = {
  company: "CSL_COMP_NAME",
  customer: "CSL_CUST_NAME",
  item: "CSL_NAME",
  salesperson: "CSL_SM_NAME",
  itemGroup: "CSL_GROUP_NAME",
} as const;

export type Dimension = keyof typeof DIMENSIONS;

export const TOP_N = 20;

export interface SalesKpis {
  netRevenue: number;
  cost: number;
  grossMargin: number;
  /** Fraction (0.25 = 25%); `null` with no revenue. */
  marginPct: number | null;
  /** Negative: returns reduce revenue. */
  returnsValue: number;
  invoiceCount: number;
}

export interface SalesMonth extends SalesKpis {
  /** `YYYY-MM`. */
  month: string;
  /** Net revenue of the same month a year earlier. */
  lastYearNetRevenue: number;
}

export interface BreakdownRow {
  label: string;
  netRevenue: number;
  grossMargin: number;
  marginPct: number | null;
}

function where(filters: Filters, customer?: string): ReturnType<typeof filterWhere> {
  const fragment = filterWhere(filters, DATE_COLUMN, COMPANY_COLUMN);
  if (customer === undefined) {
    return { sql: `${REVENUE_TXN_TYPES} AND ${fragment.sql}`, binds: fragment.binds };
  }
  return {
    sql: `${REVENUE_TXN_TYPES} AND ${fragment.sql} AND ${CUSTOMER_COLUMN} = :cust_code`,
    binds: { ...fragment.binds, cust_code: customer },
  };
}

function toKpis(row: Record<string, unknown> | undefined): SalesKpis {
  const netRevenue = num(row?.net_revenue);
  const cost = num(row?.cost);
  const grossMargin = netRevenue - cost;
  return {
    netRevenue,
    cost,
    grossMargin,
    marginPct: netRevenue ? grossMargin / netRevenue : null,
    returnsValue: num(row?.returns_value),
    invoiceCount: num(row?.invoice_count),
  };
}

export function kpiQuery(filters: Filters, customer?: string): Query {
  const { sql, binds } = where(filters, customer);
  return { sql: `SELECT${MEASURES}\nFROM ${VIEW}\nWHERE ${sql}`, binds };
}

export function monthlyQuery(filters: Filters, customer?: string): Query {
  const { sql, binds } = where(filters, customer);
  return {
    sql: `
SELECT TO_CHAR(${DATE_COLUMN}, 'YYYY-MM') AS sales_month,${MEASURES}
FROM ${VIEW}
WHERE ${sql}
GROUP BY TO_CHAR(${DATE_COLUMN}, 'YYYY-MM')
ORDER BY sales_month`,
    binds,
  };
}

/** Net revenue and cost by one dimension. With `topN`, the rest is folded into 'All other'. */
export function breakdownQuery(
  filters: Filters,
  dimension: Dimension,
  topN?: number,
  customer?: string,
): Query {
  const label = labelOrUnassigned(DIMENSIONS[dimension]);
  const { sql, binds } = where(filters, customer);
  const grouped = `
SELECT ${label} AS label, SUM(${NET_VALUE}) AS net_revenue, SUM(${COST_VALUE}) AS cost
FROM ${VIEW}
WHERE ${sql}
GROUP BY ${label}`;
  if (topN === undefined) {
    return { sql: `${grouped}\nORDER BY net_revenue DESC, label`, binds };
  }
  // The bucket is computed in a subquery and grouped by alias: Oracle rejects a GROUP BY on an
  // expression that contains a bind variable (ORA-00979).
  return {
    sql: `
SELECT bucket AS label, SUM(net_revenue) AS net_revenue, SUM(cost) AS cost, MIN(rn) AS sort_order
FROM (
    SELECT CASE WHEN rn <= :top_n THEN label ELSE '${ALL_OTHER}' END AS bucket, net_revenue, cost, rn
    FROM (
        SELECT label, net_revenue, cost, ROW_NUMBER() OVER (ORDER BY net_revenue DESC, label) AS rn
        FROM (${grouped}
        ) grouped
    ) ranked
) bucketed
GROUP BY bucket
ORDER BY sort_order`,
    binds: { ...binds, top_n: topN },
  };
}

/** Headline figures for the period, of one customer if `customer` is given. */
export async function salesKpis(filters: Filters, customer?: string): Promise<SalesKpis> {
  const [row] = await run(kpiQuery(filters, customer));
  return toKpis(row);
}

/**
 * Every month of the period with its figures, and net revenue of the same month a year earlier.
 * Months without sales are zeros.
 */
export async function salesMonthly(filters: Filters, customer?: string): Promise<SalesMonth[]> {
  const [current, previous] = await Promise.all([
    run(monthlyQuery(filters, customer)),
    run(monthlyQuery(previousYear(filters), customer)),
  ]);
  const byMonth = new Map(current.map((row) => [String(row.sales_month), row]));
  const lastYear = new Map(
    previous.map((row) => [shiftMonth(String(row.sales_month), 1), num(row.net_revenue)]),
  );
  return monthsInRange(filters.start, filters.end).map((month) => ({
    month,
    ...toKpis(byMonth.get(month)),
    lastYearNetRevenue: lastYear.get(month) ?? 0,
  }));
}

/** Net revenue by one dimension. With `topN` the last row may be 'All other'. */
export async function salesBreakdown(
  filters: Filters,
  dimension: Dimension,
  topN?: number,
  customer?: string,
): Promise<BreakdownRow[]> {
  const rows = await run(breakdownQuery(filters, dimension, topN, customer));
  return rows.map((row) => {
    const netRevenue = num(row.net_revenue);
    const grossMargin = netRevenue - num(row.cost);
    return {
      label: String(row.label),
      netRevenue,
      grossMargin,
      marginPct: netRevenue ? grossMargin / netRevenue : null,
    };
  });
}

/** The returns table shows at most this many lines (the largest first). */
export const RETURN_ROW_LIMIT = 200;

export interface ReturnLine {
  /** YYYY-MM-DD. */
  date: string;
  companyCode: string;
  /** `TXN_CODE-NO`, the credit note. */
  document: string;
  item: string;
  /** Positive: the quantity taken back. */
  quantity: number;
  /** Negative, as in net revenue. */
  value: number;
}

/**
 * One customer's returns (`SARTN` lines) in the period, per credit note and item, largest first.
 * They add up to `SalesKpis.returnsValue` for the same customer. Ranked in a subquery: Oracle
 * rejects a GROUP BY on an expression with a bind (ORA-00979), and SQLite has no FETCH FIRST.
 */
export function returnsQuery(filters: Filters, customer: string, limit = RETURN_ROW_LIMIT): Query {
  const { sql, binds } = where(filters, customer);
  return {
    sql: `
SELECT return_date, company_code, txn_code, txn_no, item, quantity, net_value
FROM (
    SELECT return_date, company_code, txn_code, txn_no, item, quantity, net_value,
        ROW_NUMBER() OVER (ORDER BY net_value, return_date, company_code, txn_code, txn_no, item) AS rn
    FROM (
        SELECT TO_CHAR(${DATE_COLUMN}, 'YYYY-MM-DD') AS return_date, CSL_COMP_CODE AS company_code,
            CSL_TXN_CODE AS txn_code, CSL_NO AS txn_no, ${labelOrUnassigned(DIMENSIONS.item)} AS item,
            -SUM(NVL(CSL_QTY, 0)) AS quantity, SUM(${NET_VALUE}) AS net_value
        FROM ${VIEW}
        WHERE ${sql} AND CSL_TXN_TYPE = 'SARTN'
        GROUP BY TO_CHAR(${DATE_COLUMN}, 'YYYY-MM-DD'), CSL_COMP_CODE, CSL_TXN_CODE, CSL_NO, ${labelOrUnassigned(DIMENSIONS.item)}
    ) grouped
) ranked
WHERE rn <= :row_limit
ORDER BY rn`,
    binds: { ...binds, row_limit: limit },
  };
}

/** One customer's returns in the period, largest (most negative) first, at most `limit` lines. */
export async function salesReturns(
  filters: Filters,
  customer: string,
  limit = RETURN_ROW_LIMIT,
): Promise<ReturnLine[]> {
  const rows = await run(returnsQuery(filters, customer, limit));
  return rows.map((row) => ({
    date: String(row.return_date),
    companyCode: String(row.company_code),
    document: `${String(row.txn_code ?? "")}-${String(row.txn_no ?? "")}`,
    item: String(row.item),
    quantity: num(row.quantity),
    value: num(row.net_value),
  }));
}
