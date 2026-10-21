import "server-only";

import { monthsInRange, previousYear, shiftMonth, type Filters } from "@/lib/filters";
import type { DayFigures } from "@/lib/sales-calendar";
import type { DocumentKey } from "@/lib/sales-drill";

import { BRAND_MAP } from "../brand-map";
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
 * - Quantity = `SUM(CSL_QTY)` over the same rows, signed (negative on returns). A delivery note
 *   carries the quantity and the invoice raised from it carries none (`INP`, `INID`, `CIN`, `LSIN`
 *   lines have `CSL_QTY = 0` on live Orion), so nothing is counted twice. It only means something
 *   for one item; the dashboards don't show it.
 *
 * Every query follows the salesperson filter on `CSL_SM_CODE` and the brand filter through the
 * per-item brand map (`lib/server/brand-map.ts`: the view has no brand column), both in `where()`,
 * so a query built on it honours them without more work. The brand breakdown joins the same map;
 * items without a brand show as 'Unassigned'.
 *
 * Every query takes an optional scope for the detail pages: a customer code (`CSL_CUST_CODE`, the
 * code space of `ZF_CUSTOMER.CUST_CODE`) for the customer page, an item code (`CSL_ITEM_CODE`, the
 * code space of `ZF_ITEM.IM_ITEM_CODE`) for the item page. Without one the SQL filters on nothing
 * more than the dashboard's.
 */

const VIEW = "MBALI.ZF_CSL_BI";
const DATE_COLUMN = "CSL_DATE";
const COMPANY_COLUMN = "CSL_COMP_CODE";
const CUSTOMER_COLUMN = "CSL_CUST_CODE";
const ITEM_COLUMN = "CSL_ITEM_CODE";
const SALESPERSON_COLUMN = "CSL_SM_CODE";
/** The view with each line's brand (`CSL_BRAND_NAME`), for the brand breakdown only. */
const VIEW_WITH_BRAND = `(
    SELECT csl.*, brand_map.brand_name AS CSL_BRAND_NAME
    FROM ${VIEW} csl
    LEFT JOIN (${BRAND_MAP}) brand_map ON brand_map.item_code = TRIM(csl.${ITEM_COLUMN})
) csl_brand`;
const REVENUE_TXN_TYPES = "CSL_TXN_TYPE IN ('INV', 'SARTN')";
const NET_VALUE = "NVL(CSL_NET_SL_VALUE, 0)";
const COST_VALUE = "NVL(CSL_WAC_VALUE, 0)";

const MEASURES = `
    SUM(${NET_VALUE}) AS net_revenue,
    SUM(${COST_VALUE}) AS cost,
    SUM(NVL(CSL_QTY, 0)) AS quantity,
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
  /** Not a column of the view: joined from the brand map (see `VIEW_WITH_BRAND`). */
  brand: "CSL_BRAND_NAME",
} as const;

export type Dimension = keyof typeof DIMENSIONS;

export const TOP_N = 20;

/** One bar of a breakdown: the rows whose `dimension` label (as the breakdown shows it) is `label`. */
export interface SalesSlice {
  dimension: Dimension;
  label: string;
}

/**
 * Narrows a query to one customer and/or one item, or to one breakdown bar (`slice`). A plain
 * string is a customer code, as the customer page passes it.
 */
export type SalesScope = string | { customer?: string; item?: string; slice?: SalesSlice };

export interface SalesKpis {
  netRevenue: number;
  cost: number;
  grossMargin: number;
  /** Fraction (0.25 = 25%); `null` with no revenue. */
  marginPct: number | null;
  /** Negative: returns reduce revenue. */
  returnsValue: number;
  invoiceCount: number;
  /** Units sold less units returned; only meaningful for one item. */
  quantity: number;
}

export interface SalesMonth extends SalesKpis {
  /** `YYYY-MM`. */
  month: string;
  /** Net revenue of the same month a year earlier. */
  lastYearNetRevenue: number;
  /** Quantity of the same month a year earlier. */
  lastYearQuantity: number;
}

export interface BreakdownRow {
  label: string;
  /** Units sold less units returned; only meaningful within one item. */
  quantity: number;
  netRevenue: number;
  grossMargin: number;
  marginPct: number | null;
}

function where(filters: Filters, scope?: SalesScope): ReturnType<typeof filterWhere> {
  const fragment = filterWhere(filters, DATE_COLUMN, COMPANY_COLUMN, {
    salesperson: SALESPERSON_COLUMN,
    item: ITEM_COLUMN,
  });
  const { customer, item, slice } =
    typeof scope === "string" ? { customer: scope, item: undefined, slice: undefined } : (scope ?? {});
  const clauses = [REVENUE_TXN_TYPES, fragment.sql];
  const binds = { ...fragment.binds };
  if (customer !== undefined) {
    clauses.push(`${CUSTOMER_COLUMN} = :cust_code`);
    binds.cust_code = customer;
  }
  if (item !== undefined) {
    clauses.push(`${ITEM_COLUMN} = :item_code`);
    binds.item_code = item;
  }
  if (slice !== undefined) {
    // The same expression the breakdown groups by, so a bar's slices add up to the bar.
    clauses.push(`${labelOrUnassigned(DIMENSIONS[slice.dimension])} = :slice_label`);
    binds.slice_label = slice.label;
  }
  return { sql: clauses.join(" AND "), binds };
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
    quantity: num(row?.quantity),
  };
}

export function kpiQuery(filters: Filters, scope?: SalesScope): Query {
  const { sql, binds } = where(filters, scope);
  return { sql: `SELECT${MEASURES}\nFROM ${VIEW}\nWHERE ${sql}`, binds };
}

export function monthlyQuery(filters: Filters, scope?: SalesScope): Query {
  const { sql, binds } = where(filters, scope);
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
  scope?: SalesScope,
): Query {
  const label = labelOrUnassigned(DIMENSIONS[dimension]);
  const { sql, binds } = where(filters, scope);
  const grouped = `
SELECT ${label} AS label, SUM(${NET_VALUE}) AS net_revenue, SUM(${COST_VALUE}) AS cost,
    SUM(NVL(CSL_QTY, 0)) AS quantity
FROM ${dimension === "brand" ? VIEW_WITH_BRAND : VIEW}
WHERE ${sql}
GROUP BY ${label}`;
  if (topN === undefined) {
    return { sql: `${grouped}\nORDER BY net_revenue DESC, label`, binds };
  }
  // The bucket is computed in a subquery and grouped by alias: Oracle rejects a GROUP BY on an
  // expression that contains a bind variable (ORA-00979).
  return {
    sql: `
SELECT bucket AS label, SUM(net_revenue) AS net_revenue, SUM(cost) AS cost, SUM(quantity) AS quantity,
    MIN(rn) AS sort_order
FROM (
    SELECT CASE WHEN rn <= :top_n THEN label ELSE '${ALL_OTHER}' END AS bucket, net_revenue, cost, quantity, rn
    FROM (
        SELECT label, net_revenue, cost, quantity, ROW_NUMBER() OVER (ORDER BY net_revenue DESC, label) AS rn
        FROM (${grouped}
        ) grouped
    ) ranked
) bucketed
GROUP BY bucket
ORDER BY sort_order`,
    binds: { ...binds, top_n: topN },
  };
}

/** Headline figures for the period, narrowed to one customer or item by `scope`. */
export async function salesKpis(filters: Filters, scope?: SalesScope): Promise<SalesKpis> {
  const [row] = await run(kpiQuery(filters, scope));
  return toKpis(row);
}

/**
 * Every month of the period with its figures, and net revenue of the same month a year earlier.
 * Months without sales are zeros.
 */
export async function salesMonthly(filters: Filters, scope?: SalesScope): Promise<SalesMonth[]> {
  const [current, previous] = await Promise.all([
    run(monthlyQuery(filters, scope)),
    run(monthlyQuery(previousYear(filters), scope)),
  ]);
  const byMonth = new Map(current.map((row) => [String(row.sales_month), row]));
  const lastYear = new Map(previous.map((row) => [shiftMonth(String(row.sales_month), 1), row]));
  return monthsInRange(filters.start, filters.end).map((month) => ({
    month,
    ...toKpis(byMonth.get(month)),
    lastYearNetRevenue: num(lastYear.get(month)?.net_revenue),
    lastYearQuantity: num(lastYear.get(month)?.quantity),
  }));
}

/** Net revenue by one dimension. With `topN` the last row may be 'All other'. */
export async function salesBreakdown(
  filters: Filters,
  dimension: Dimension,
  topN?: number,
  scope?: SalesScope,
): Promise<BreakdownRow[]> {
  const rows = await run(breakdownQuery(filters, dimension, topN, scope));
  return rows.map((row) => {
    const netRevenue = num(row.net_revenue);
    const grossMargin = netRevenue - num(row.cost);
    return {
      label: String(row.label),
      quantity: num(row.quantity),
      netRevenue,
      grossMargin,
      marginPct: netRevenue ? grossMargin / netRevenue : null,
    };
  });
}

// ---------------------------------------------------------------------------------------------
// Customer and discount KPIs

/**
 * Active customers, discount and gross sales value.
 *
 * - Active customers = distinct `CSL_CUST_CODE` whose net revenue over the period (or month) is
 *   not zero to the fils. A customer whose invoices are fully returned is not active.
 * - Discount = `SUM(CSL_NET_DISC_VALUE)`, negative on returns like revenue. On live Orion
 *   `CSL_GROSS_SL_VALUE − CSL_NET_SL_VALUE = CSL_NET_DISC_VALUE` on every INV and SARTN line
 *   (checked 21 Oct 2026), so discount % = discount / gross.
 */
export interface SalesExtras {
  activeCustomers: number;
  discount: number;
  grossValue: number;
  /** Fraction of gross sales value; `null` with no gross value. */
  discountPct: number | null;
}

export interface SalesExtrasMonth extends SalesExtras {
  /** `YYYY-MM`. */
  month: string;
}

const DISCOUNT_VALUE = "NVL(CSL_NET_DISC_VALUE, 0)";
const GROSS_VALUE = "NVL(CSL_GROSS_SL_VALUE, 0)";

/** Totals per customer (and month, with `byMonth`), then summed: one query for all three. */
export function extrasQuery(filters: Filters, byMonth = false, scope?: SalesScope): Query {
  const { sql, binds } = where(filters, scope);
  const month = `TO_CHAR(${DATE_COLUMN}, 'YYYY-MM')`;
  return {
    sql: `
SELECT ${byMonth ? "sales_month, " : ""}SUM(discount) AS discount, SUM(gross_value) AS gross_value,
    SUM(CASE WHEN cust_code IS NOT NULL AND ABS(net_revenue) >= 0.005 THEN 1 ELSE 0 END) AS active_customers
FROM (
    SELECT ${byMonth ? `${month} AS sales_month, ` : ""}${CUSTOMER_COLUMN} AS cust_code,
        SUM(${NET_VALUE}) AS net_revenue, SUM(${DISCOUNT_VALUE}) AS discount, SUM(${GROSS_VALUE}) AS gross_value
    FROM ${VIEW}
    WHERE ${sql}
    GROUP BY ${byMonth ? `${month}, ` : ""}${CUSTOMER_COLUMN}
) per_customer${byMonth ? "\nGROUP BY sales_month\nORDER BY sales_month" : ""}`,
    binds,
  };
}

function toExtras(row: Record<string, unknown> | undefined): SalesExtras {
  const discount = num(row?.discount);
  const grossValue = num(row?.gross_value);
  return {
    activeCustomers: num(row?.active_customers),
    discount,
    grossValue,
    discountPct: grossValue ? discount / grossValue : null,
  };
}

/** Active customers, discount and gross value for the period. */
export async function salesExtras(filters: Filters, scope?: SalesScope): Promise<SalesExtras> {
  const [row] = await run(extrasQuery(filters, false, scope));
  return toExtras(row);
}

/** The same per month of the period, for the sparklines. Months without sales are zeros. */
export async function salesExtrasMonthly(filters: Filters, scope?: SalesScope): Promise<SalesExtrasMonth[]> {
  const rows = await run(extrasQuery(filters, true, scope));
  const byMonth = new Map(rows.map((row) => [String(row.sales_month), row]));
  return monthsInRange(filters.start, filters.end).map((month) => ({
    month,
    ...toExtras(byMonth.get(month)),
  }));
}

/** Net revenue per invoice; `null` without invoices. */
export function averageInvoiceValue(kpis: Pick<SalesKpis, "netRevenue" | "invoiceCount">): number | null {
  return kpis.invoiceCount ? kpis.netRevenue / kpis.invoiceCount : null;
}

// ---------------------------------------------------------------------------------------------
// Hover breakdown

/** Slices per dimension on the hover card; the rest fold into 'All other'. */
export const HOVER_TOP_N = 5;

/** What the card of a month bar, and of a "Revenue by company" bar, breaks it down by. */
export const MONTH_CARD_DIMENSIONS: readonly Dimension[] = ["company", "salesperson", "itemGroup"];
export const COMPANY_CARD_DIMENSIONS: readonly Dimension[] = ["salesperson", "itemGroup"];
/** What the card of a month bar on the customer page breaks it down by. */
export const CUSTOMER_CARD_DIMENSIONS: readonly Dimension[] = ["company", "itemGroup"];

export interface HoverBreakdown {
  netRevenue: number;
  /** The same days a year earlier. */
  lastYearNetRevenue: number;
  breakdowns: { dimension: Dimension; rows: BreakdownRow[] }[];
}

/**
 * What makes up one bar: its net revenue, last year's, and the top `HOVER_TOP_N` of each dimension
 * plus 'All other'. `filters` is already narrowed to the bar's days (a month bar) and `slice`
 * narrows it to one breakdown bar (a company bar), `customer` to one customer (the customer page).
 * Each dimension's rows add up to `netRevenue`.
 */
export async function salesHoverBreakdown(
  filters: Filters,
  dimensions: readonly Dimension[],
  slice?: SalesSlice,
  customer?: string,
): Promise<HoverBreakdown> {
  const scope = slice || customer !== undefined ? { slice, customer } : undefined;
  const [[current], [previous], breakdowns] = await Promise.all([
    run(kpiQuery(filters, scope)),
    run(kpiQuery(previousYear(filters), scope)),
    Promise.all(dimensions.map((dimension) => salesBreakdown(filters, dimension, HOVER_TOP_N, scope))),
  ]);
  return {
    netRevenue: toKpis(current).netRevenue,
    lastYearNetRevenue: toKpis(previous).netRevenue,
    breakdowns: dimensions.map((dimension, index) => ({ dimension, rows: breakdowns[index] })),
  };
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

/** Figures per day of the period, for the month → week → day table. Days without sales are absent. */
export function dailyQuery(filters: Filters, scope?: SalesScope): Query {
  const { sql, binds } = where(filters, scope);
  return {
    sql: `
SELECT TO_CHAR(${DATE_COLUMN}, 'YYYY-MM-DD') AS sales_day,${MEASURES}
FROM ${VIEW}
WHERE ${sql}
GROUP BY TO_CHAR(${DATE_COLUMN}, 'YYYY-MM-DD')
ORDER BY sales_day`,
    binds,
  };
}

/**
 * Every day of the period that had sales lines, with its figures. A document is dated once, so the
 * days' invoice counts add up to the period's.
 */
export async function salesDaily(filters: Filters, scope?: SalesScope): Promise<DayFigures[]> {
  const rows = await run(dailyQuery(filters, scope));
  return rows.map((row) => {
    const kpis = toKpis(row);
    return {
      date: String(row.sales_day),
      netRevenue: kpis.netRevenue,
      cost: kpis.cost,
      returnsValue: kpis.returnsValue,
      invoiceCount: kpis.invoiceCount,
    };
  });
}

/** The drill-down lists at most this many documents (the largest first). */
export const DOCUMENT_LIMIT = 300;

export interface SalesDocument extends DocumentKey {
  /** YYYY-MM-DD. */
  date: string;
  /** `CSL_TXN_TYPE`: `INV` or `SARTN`. */
  txnType: string;
  /** `CSL_CUST_CODE`; empty when blank. */
  customerCode: string;
  customer: string;
  salesperson: string;
  netValue: number;
  cost: number;
  marginPct: number | null;
}

export interface SalesDocuments {
  documents: SalesDocument[];
  /** Every document in the period; `documents` stops at `limit`. */
  total: number;
  /** The period's exact figures, whatever the limit (the KPI query on the same filters). */
  totals: SalesKpis;
  limit: number;
}

/**
 * The period's documents (`CSL_COMP_CODE` + `CSL_TXN_CODE` + `CSL_NO`), largest net value first
 * whatever its sign, so big returns show too. Zero-value delivery notes are listed with their cost,
 * as they count in the KPIs. Ranked in a subquery: Oracle rejects a GROUP BY on an expression with a
 * bind (ORA-00979), and SQLite has no FETCH FIRST.
 */
export function documentsQuery(filters: Filters, limit = DOCUMENT_LIMIT, scope?: SalesScope): Query {
  const { sql, binds } = where(filters, scope);
  return {
    sql: `
SELECT doc_date, company_code, txn_code, txn_no, txn_type, cust_code, customer, salesperson,
    net_value, cost, total_documents
FROM (
    SELECT doc_date, company_code, txn_code, txn_no, txn_type, cust_code, customer, salesperson,
        net_value, cost, COUNT(*) OVER () AS total_documents,
        ROW_NUMBER() OVER (
            ORDER BY ABS(net_value) DESC, ABS(cost) DESC, doc_date, company_code, txn_code, txn_no
        ) AS rn
    FROM (
        SELECT TO_CHAR(MIN(${DATE_COLUMN}), 'YYYY-MM-DD') AS doc_date, CSL_COMP_CODE AS company_code,
            CSL_TXN_CODE AS txn_code, CSL_NO AS txn_no, MAX(CSL_TXN_TYPE) AS txn_type,
            MAX(TRIM(${CUSTOMER_COLUMN})) AS cust_code,
            MAX(${labelOrUnassigned(DIMENSIONS.customer)}) AS customer,
            MAX(${labelOrUnassigned(DIMENSIONS.salesperson)}) AS salesperson,
            SUM(${NET_VALUE}) AS net_value, SUM(${COST_VALUE}) AS cost
        FROM ${VIEW}
        WHERE ${sql}
        GROUP BY CSL_COMP_CODE, CSL_TXN_CODE, CSL_NO
    ) grouped
) ranked
WHERE rn <= :row_limit
ORDER BY rn`,
    binds: { ...binds, row_limit: limit },
  };
}

function text(value: unknown): string {
  return value === null || value === undefined ? "" : String(value).trim();
}

function margin(netValue: number, cost: number): number | null {
  return netValue ? (netValue - cost) / netValue : null;
}

/**
 * The documents behind a period, at most `limit` of them, with the period's exact totals from a
 * separate query (the same one as the KPI cards), so the totals never depend on the limit.
 */
export async function salesDocuments(
  filters: Filters,
  limit = DOCUMENT_LIMIT,
  scope?: SalesScope,
): Promise<SalesDocuments> {
  const [rows, totals] = await Promise.all([
    run(documentsQuery(filters, limit, scope)),
    salesKpis(filters, scope),
  ]);
  return {
    documents: rows.map((row) => {
      const netValue = num(row.net_value);
      const cost = num(row.cost);
      return {
        date: text(row.doc_date),
        company: text(row.company_code),
        txnCode: text(row.txn_code),
        no: text(row.txn_no),
        txnType: text(row.txn_type),
        customerCode: text(row.cust_code),
        customer: text(row.customer),
        salesperson: text(row.salesperson),
        netValue,
        cost,
        marginPct: margin(netValue, cost),
      };
    }),
    total: num(rows[0]?.total_documents),
    totals,
    limit,
  };
}

export interface SalesDocumentLine {
  /** `CSL_ITEM_CODE`; empty when blank. */
  itemCode: string;
  item: string;
  /** Signed: negative on returns. */
  quantity: number;
  netValue: number;
  cost: number;
  marginPct: number | null;
}

/** One document's lines within the period, largest first. One query per opened document. */
export function documentLinesQuery(filters: Filters, doc: DocumentKey, scope?: SalesScope): Query {
  const { sql, binds } = where(filters, scope);
  return {
    sql: `
SELECT TRIM(${ITEM_COLUMN}) AS item_code, ${labelOrUnassigned(DIMENSIONS.item)} AS item,
    NVL(CSL_QTY, 0) AS quantity, ${NET_VALUE} AS net_value, ${COST_VALUE} AS cost
FROM ${VIEW}
WHERE ${sql} AND CSL_COMP_CODE = :doc_company AND CSL_TXN_CODE = :doc_txn_code AND CSL_NO = :doc_no
ORDER BY ABS(${NET_VALUE}) DESC, ABS(${COST_VALUE}) DESC, item_code`,
    binds: { ...binds, doc_company: doc.company, doc_txn_code: doc.txnCode, doc_no: doc.no },
  };
}

export async function salesDocumentLines(
  filters: Filters,
  doc: DocumentKey,
  scope?: SalesScope,
): Promise<SalesDocumentLine[]> {
  const rows = await run(documentLinesQuery(filters, doc, scope));
  return rows.map((row) => {
    const netValue = num(row.net_value);
    const cost = num(row.cost);
    return {
      itemCode: text(row.item_code),
      item: text(row.item),
      quantity: num(row.quantity),
      netValue,
      cost,
      marginPct: margin(netValue, cost),
    };
  });
}

// ---------------------------------------------------------------------------------------------
// Product mix

/** One item's figures for a period, for the Product mix page. */
export interface ItemMixFigures {
  netRevenue: number;
  cost: number;
  /** `CSL_GROSS_SL_VALUE`, pre-discount; only the denominator of discount %. */
  grossValue: number;
  /** `CSL_NET_DISC_VALUE`, negative on returns like revenue. */
  discount: number;
  /** The `SARTN` part of net revenue (negative). */
  returnsValue: number;
  /** The `INV` part of net revenue: what was invoiced before returns. */
  invoicedValue: number;
}

export interface ItemMixRow {
  /** `CSL_ITEM_CODE` as stored (it may hold spaces), for the item page; `null` when blank. */
  code: string | null;
  name: string;
  /** The brand map's name, or 'Unassigned'. */
  brand: string;
  current: ItemMixFigures;
  /** The same days a year earlier: zeros for an item with no sales then. */
  lastYear: ItemMixFigures;
}

/**
 * Figures per item code (with its brand) for the period. Grouped by code, not by name: names
 * aren't unique, and grouping by name merges and splits codes. The brand is the same expression
 * the brand breakdown groups by, so brand totals match "Revenue by brand" on Sales.
 */
export function itemMixQuery(filters: Filters, scope?: SalesScope): Query {
  const { sql, binds } = where(filters, scope);
  const brand = labelOrUnassigned(DIMENSIONS.brand);
  return {
    sql: `
SELECT ${brand} AS brand, ${ITEM_COLUMN} AS item_code, MAX(${labelOrUnassigned(DIMENSIONS.item)}) AS item,
    SUM(${NET_VALUE}) AS net_revenue, SUM(${COST_VALUE}) AS cost, SUM(${GROSS_VALUE}) AS gross_value,
    SUM(${DISCOUNT_VALUE}) AS discount,
    SUM(CASE WHEN CSL_TXN_TYPE = 'SARTN' THEN ${NET_VALUE} ELSE 0 END) AS returns_value,
    SUM(CASE WHEN CSL_TXN_TYPE = 'INV' THEN ${NET_VALUE} ELSE 0 END) AS invoiced_value
FROM ${VIEW_WITH_BRAND}
WHERE ${sql}
GROUP BY ${brand}, ${ITEM_COLUMN}
ORDER BY net_revenue DESC, item_code`,
    binds,
  };
}

const NO_FIGURES: ItemMixFigures = {
  netRevenue: 0,
  cost: 0,
  grossValue: 0,
  discount: 0,
  returnsValue: 0,
  invoicedValue: 0,
};

function toMixFigures(row: Record<string, unknown>): ItemMixFigures {
  return {
    netRevenue: num(row.net_revenue),
    cost: num(row.cost),
    grossValue: num(row.gross_value),
    discount: num(row.discount),
    returnsValue: num(row.returns_value),
    invoicedValue: num(row.invoiced_value),
  };
}

function itemCode(value: unknown): string | null {
  return value === null || value === undefined || String(value).trim() === "" ? null : String(value);
}

/**
 * Every item sold in the period or in the same days a year earlier, with both periods' figures.
 * The period's rows add up to `salesKpis(filters)` exactly; an item sold only last year has zeros
 * for this period.
 */
export async function salesItemMix(filters: Filters, scope?: SalesScope): Promise<ItemMixRow[]> {
  const [current, previous] = await Promise.all([
    run(itemMixQuery(filters, scope)),
    run(itemMixQuery(previousYear(filters), scope)),
  ]);
  const items = new Map<string, ItemMixRow>();
  // A blank code can only be Unassigned (the brand map joins on the code), so the key is unique.
  const key = (row: Record<string, unknown>) => `${String(row.brand)}\u0000${itemCode(row.item_code) ?? ""}`;
  for (const row of current) {
    items.set(key(row), {
      code: itemCode(row.item_code),
      name: String(row.item),
      brand: String(row.brand),
      current: toMixFigures(row),
      lastYear: NO_FIGURES,
    });
  }
  for (const row of previous) {
    const existing = items.get(key(row));
    if (existing) {
      existing.lastYear = toMixFigures(row);
    } else {
      items.set(key(row), {
        code: itemCode(row.item_code),
        name: String(row.item),
        brand: String(row.brand),
        current: NO_FIGURES,
        lastYear: toMixFigures(row),
      });
    }
  }
  return [...items.values()];
}
