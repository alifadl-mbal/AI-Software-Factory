import "server-only";

import { AGING_BUCKETS } from "@/lib/aging";
import {
  daysBetween,
  monthsInRange,
  previousYear,
  shiftMonth,
  type Filters,
  type SalesFilterKey,
} from "@/lib/filters";
import { orderAgeCutoff, type OrderAge } from "@/lib/order-age";
import { orionDateSql, parseOrionDate } from "@/lib/orion-date";

import { BRAND_MAP } from "../brand-map";
import { run } from "../db";
import {
  ALL_OTHER,
  companyWhere,
  filterWhere,
  labelOrUnassigned,
  num,
  salesWhere,
  type SalesColumns,
} from "../sql";
import type { DocumentKey } from "@/lib/sales-drill";

import type { Binds, Query } from "../types";
import { agingBinds, bucketCase } from "./ar-ap";
import { companies as loadCompanies } from "./common";

/**
 * Sales-order book queries on `MBALI.ZF_SO_BI`. What was checked on live Orion (2026-10-20):
 *
 * - **Grain:** one row per order line; the `H_*` header columns repeat on every line. The documented
 *   key `(H_COMP_CODE, H_TXN_CODE, H_TXN_NO, D_ITEM_CODE)` is *not* unique: 1,479,756 keys over
 *   1,513,718 rows, because an item can sit on two lines of one order. `D_I_SYS_ID` is unique per
 *   row, so we never de-duplicate lines on the documented key. An order is
 *   `(H_COMP_CODE, H_TXN_CODE, H_TXN_NO)`, one-to-one with `H_SYS_ID` (403,429 of each). Order date
 *   is `H_DT` (DATE), company `H_COMP_CODE`. The view has 152 columns, not 150: `H_APPR_UID` and
 *   `H_APPR_DT` are new.
 * - **Statuses are words, not letters.** `H_DEL_STATUS` is `Pending` / `Partial` / `Delivered` /
 *   `Blank`; `H_DOC_STATUS` is `Approved` / `Approval Not Required` / `Pending for Approval` /
 *   `Pending for Submission` / `Closed`. There is no `'C'` (or `Cancelled`) anywhere. A cancelled or
 *   short-closed order is `H_DOC_STATUS = 'Closed'`, and its lines keep their quantities: 34,479
 *   Closed lines still show a quantity to deliver (127M in order currency). So the open book leaves
 *   Closed orders out, and for "booked" only the delivered part of a Closed line counts (the rest
 *   was cancelled). `H_DEL_STATUS` lags the quantities (a few `Delivered` lines still have quantity
 *   to deliver), so the quantities decide, not the status. Orders pending approval or submission
 *   are in the book: they are customer orders not yet released.
 * - **Lifecycle:** `D_QTY` ordered ≥ `D_DELIVERED_QTY` ≥ `D_INVOICED_QTY` holds on all but a few
 *   hundred lines (60 over-delivered, 654 over-invoiced, 40 with `D_QTY <= 0`). Pending delivery =
 *   `D_QTY − D_DELIVERED_QTY`, delivered not invoiced = `D_DELIVERED_QTY − D_INVOICED_QTY`; each only
 *   when above zero, and only on lines with `D_QTY > 0`. None of the three is ever NULL.
 * - **Value:** `D_FC_VAL` is the net line value in the order currency: quantity × rate less the line
 *   discount, before VAT (e.g. gross 29,750, line discount 7,437.50, `D_FC_VAL` 22,312.50).
 *   `D_TOT_VAL` = `D_FC_VAL` + `D_LINE_TAX` (5% VAT) + expenses, so it includes tax and isn't used.
 *   `D_FC_VAL_AFT_H_DISC` is NULL on most open lines and isn't used either. The header discount
 *   (`H_DISC_VAL`, repeated on every line) is on 283 open lines only and isn't spread over the lines
 *   in the view, so open values are before header discount. Pending value = `D_FC_VAL` × pending
 *   qty / `D_QTY`, pro rata like pending POs.
 * - **Currency:** no AED column and no exchange rate. Open lines are 99.2% AED by count; the rest is
 *   USD 890K, OMR 64K and SAR 17K in their own currencies (about 1.3% of the book as raw numbers,
 *   some 5% once USD is converted). AED totals use AED orders only; the others are listed per
 *   currency on the page.
 * - **Expected delivery:** `H_DEL_DT` is `VARCHAR2(11)` `DD-Mon-YYYY` (`10-Oct-2026`), English month
 *   names, never NULL, always 11 characters. `orionDateSql` turns it into `YYYY-MM-DD` with
 *   portable SQL; on every open line that matched Oracle's own `TO_DATE(..., 'DD-Mon-YYYY')`. A line
 *   is overdue once that date is before today.
 * - Blank salesperson (`H_SM_NAME`) or customer (`H_CUST_NAME`) shows as Unassigned. Customer is the
 *   account name (`H_CUST_NAME`, e.g. one chain), not the branch on the document (`H_DOC_CUST_NAME`).
 *   Orion fills `H_CUST_NAME` with a lookup on `ZF_CUSTOMER` by `H_CUST_CODE` for every row, which
 *   is slow to group by, so the customer breakdown groups by code and joins the names afterwards.
 * - Repair & service workorders (`R01`) are sales orders in this view too: 16,618 open lines, nearly
 *   all with zero value. They are counted as open lines but add almost nothing to the value.
 * - **Customer codes:** `H_CUST_CODE` is the code space of `ZF_CUSTOMER.CUST_CODE`: every code
 *   on orders since 2025 is in the master, under the same name. The customer page narrows the book
 *   with it.
 * - **Item codes:** `D_ITEM_CODE` is the code space of `ZF_ITEM.IM_ITEM_CODE`: every code on orders
 *   since 2025 is in the master. `D_ITEM_DESC` is the line's own text and differs from the master
 *   name on many lines, so the item page shows the master name. The item page narrows the book with
 *   the code.
 *
 * - **Salesperson and brand filters:** `H_SM_CODE` is the code space of `ZF_CSL_BI.CSL_SM_CODE`
 *   (99.9% of this year's net revenue is booked by a salesperson code that is also on orders), so
 *   the salesperson filter applies as it does to sales. Brand comes from the same per-item map as
 *   sales (`lib/server/brand-map.ts`) on `D_ITEM_CODE`; `D_FLEX_01_BRAND` isn't used, as it gives
 *   one item several brands.
 *
 * The open book is **as of today** and follows the company, salesperson and brand filters and the order-age choice
 * (`lib/order-age.ts`: by default orders placed in the last 2 years, on `H_DT`); "booked" figures
 * follow both filters and ignore order age. Order age uses the shared ladder in `lib/aging.ts` on `H_DT`, with the cut-offs
 * bound as dates (the same `CASE` as receivables).
 */

const VIEW = "MBALI.ZF_SO_BI";
/** Customer master, unique on `CUST_CODE`; `ZF_SO_BI.H_CUST_NAME` is its `CUST_NAME`. */
const CUSTOMER_VIEW = "MBALI.ZF_CUSTOMER";

/** Orders cancelled or short-closed in Orion. */
export const CLOSED_STATUS = "Closed";
const NOT_CLOSED = `COALESCE(H_DOC_STATUS, ' ') <> '${CLOSED_STATUS}'`;
const NET_VALUE = "NVL(D_FC_VAL, 0)";
const PENDING_QTY = "(D_QTY - NVL(D_DELIVERED_QTY, 0))";
const UNINVOICED_QTY = "(NVL(D_DELIVERED_QTY, 0) - NVL(D_INVOICED_QTY, 0))";
const ORDER_KEY = "H_COMP_CODE || '|' || H_TXN_CODE || '|' || H_TXN_NO";
/** The line's value as booked: a Closed line counts only for what was delivered before it closed. */
const BOOKED_VALUE = `CASE WHEN ${NOT_CLOSED} THEN ${NET_VALUE} ELSE ${NET_VALUE} * NVL(D_DELIVERED_QTY, 0) / NULLIF(D_QTY, 0) END`;
const BOOKED_LINE = `D_QTY > 0 AND (${NOT_CLOSED} OR NVL(D_DELIVERED_QTY, 0) > 0)`;

export const AED = "AED";
export const TOP_CUSTOMERS = 20;
export const TOP_SALESPEOPLE = 15;
/** The open-lines table shows at most this many lines (the largest by pending value). */
export const OPEN_ROW_LIMIT = 1000;

/** Pending value of a line: its net value pro rata to the quantity still to deliver. */
export function pendingValue(netValue: number, orderedQty: number, deliveredQty: number): number {
  const pending = orderedQty - deliveredQty;
  return orderedQty > 0 && pending > 0 ? (netValue * pending) / orderedQty : 0;
}

/**
 * `H_DT` on or after the order-age cut-off (`lib/order-age.ts`), worked out in TypeScript and bound.
 * A predicate on the base column, unlike the computed ones `OPEN_AED_VALUE` warns about.
 */
const IN_SCOPE = "H_DT >= TO_DATE(:since_date, 'YYYY-MM-DD')";

/** Narrows the book to one customer (`H_CUST_CODE`) and/or one item (`D_ITEM_CODE`). */
export interface BookScope {
  customer?: string;
  item?: string;
}

/** Salesperson and brand, as the shared filters apply them to order lines. */
const SALES_COLUMNS: SalesColumns = { salesperson: "H_SM_CODE", item: "D_ITEM_CODE" };

/**
 * What the open book follows: company codes alone (all salespeople and brands), or the page's
 * filters, whose salesperson and brand also narrow it.
 */
export type BookCompanies =
  readonly string[] | (Pick<Filters, "companies"> & Partial<Pick<Filters, SalesFilterKey>>);

function isCodeList(companies: BookCompanies): companies is readonly string[] {
  return Array.isArray(companies);
}

/** A plain string is a customer code, as the customer page passes it. */
function bookScope(scope: string | BookScope | undefined): BookScope {
  return typeof scope === "string" ? { customer: scope } : (scope ?? {});
}

/**
 * Lines of open orders with something still to deliver or to invoice, each with its pending and
 * not-invoiced quantity and value, currency flag, expected delivery (`YYYY-MM-DD`) and age bucket.
 * Aggregation happens outside: Oracle rejects a GROUP BY on an expression with a bind (ORA-00979).
 * Orders placed before the `age` cut-off are left out, or with `flagScope` kept and flagged
 * `in_scope = 0`, so the KPI query can say what the cut-off hides in the same round trip.
 */
function bookLines(
  companies: BookCompanies,
  today: string,
  age: OrderAge,
  columns: string[] = [],
  { flagScope = false, customer, item }: { flagScope?: boolean } & BookScope = {},
): Query {
  const filters: Exclude<BookCompanies, readonly string[]> = isCodeList(companies)
    ? { companies: [...companies] }
    : companies;
  const company = companyWhere(filters.companies, "H_COMP_CODE");
  const sales = salesWhere(filters, SALES_COLUMNS);
  // Order age has no "over 90 days" figure; an unused bind is an error on both sources.
  const ageBinds = Object.fromEntries(
    Object.entries(agingBinds(today)).filter(([name]) => name !== "age_90d"),
  );
  const cutoff = orderAgeCutoff(age, today);
  const select = [
    ...columns,
    `${ORDER_KEY} AS order_key`,
    `CASE WHEN H_CURR_CODE = '${AED}' THEN 1 ELSE 0 END AS is_aed`,
    `${PENDING_QTY} AS pend_qty`,
    `${NET_VALUE} * ${PENDING_QTY} / D_QTY AS pend_value`,
    `${UNINVOICED_QTY} AS uninv_qty`,
    `${NET_VALUE} * ${UNINVOICED_QTY} / D_QTY AS uninv_value`,
    `${orionDateSql("H_DEL_DT")} AS del_date`,
    `${bucketCase("H_DT")} AS bucket`,
  ];
  if (flagScope)
    select.push(cutoff ? `CASE WHEN ${IN_SCOPE} THEN 1 ELSE 0 END AS in_scope` : "1 AS in_scope");
  return {
    sql: `
    SELECT ${select.join(",\n        ")}
    FROM ${VIEW}
    WHERE ${NOT_CLOSED} AND D_QTY > 0
      AND (${PENDING_QTY} > 0 OR ${UNINVOICED_QTY} > 0)${company ? `\n      AND ${company.sql}` : ""}${
        sales ? `\n      AND ${sales.sql}` : ""
      }${customer === undefined ? "" : `\n      AND H_CUST_CODE = :cust_code`}${
        item === undefined
          ? ""
          : `
      AND D_ITEM_CODE = :item_code`
      }${
        cutoff && !flagScope
          ? `
      AND ${IN_SCOPE}`
          : ""
      }`,
    binds: {
      ...ageBinds,
      ...company?.binds,
      ...sales?.binds,
      ...(customer !== undefined && { cust_code: customer }),
      ...(item !== undefined && { item_code: item }),
      ...(cutoff ? { since_date: cutoff } : {}),
    },
  };
}

/** Open AED lines (something left to deliver), for the value breakdowns. */
const OPEN_AED = "pend_qty > 0 AND is_aed = 1";
/**
 * Pending value of open AED lines, 0 for the other book lines. The breakdowns sum this rather than
 * filter on `OPEN_AED` in a `WHERE`: on live Orion a `WHERE` on these computed columns made the first
 * run of every new query text take ~5 s (Oracle's first plan for the view is poor and is only
 * corrected on the next run), against ~0.8 s for the same figures summed conditionally.
 */
const OPEN_AED_VALUE = `CASE WHEN ${OPEN_AED} THEN pend_value ELSE 0 END`;
const OPEN_AED_LINE = `CASE WHEN ${OPEN_AED} THEN 1 ELSE 0 END`;

/** Rank `grouped` (label, amount) by value and fold everything past `topN` into 'All other'. */
function foldTopN(grouped: string, binds: Binds, topN: number): Query {
  return {
    sql: `
SELECT bucket AS label, SUM(amount) AS amount, MIN(rn) AS sort_order
FROM (
    SELECT CASE WHEN rn <= :top_n THEN label ELSE '${ALL_OTHER}' END AS bucket, amount, rn
    FROM (
        SELECT label, amount, ROW_NUMBER() OVER (ORDER BY amount DESC, label) AS rn
        FROM (${grouped}
        ) grouped
    ) ranked
) bucketed
GROUP BY bucket
ORDER BY sort_order`,
    binds: { ...binds, top_n: topN },
  };
}

// ---------------------------------------------------------------------------------------------
// The open book, as of today

export interface OpenBookKpis {
  /** AED orders: pending delivery value. */
  openValue: number;
  /** Orders and lines with quantity still to deliver, in any currency. */
  openOrders: number;
  openLines: number;
  /** Open lines of AED orders: the ones in `openValue` and the open-lines table. */
  openAedLines: number;
  /** AED orders: delivered but not yet invoiced. */
  uninvoicedValue: number;
  uninvoicedLines: number;
  /** AED orders: pending value whose expected delivery date has passed. */
  overdueValue: number;
  overdueLines: number;
  /** Open lines (any currency) on orders placed before the order-age cut-off, left out above. */
  hiddenLines: number;
  /** AED orders: pending value of those lines. */
  hiddenValue: number;
}

export interface LabelValue {
  label: string;
  value: number;
}

export interface CurrencyBook {
  currency: string;
  lines: number;
  /** Pending delivery value in `currency`. */
  openValue: number;
}

export interface OpenLine {
  companyCode: string;
  customerCode: string;
  orderNumber: string;
  /** YYYY-MM-DD. */
  orderDate: string;
  customer: string;
  salesperson: string;
  itemCode: string;
  item: string;
  orderedQty: number;
  deliveredQty: number;
  invoicedQty: number;
  pendingValue: number;
  /** YYYY-MM-DD; `null` if Orion's text date can't be read. */
  expectedDate: string | null;
  /** Days since the expected delivery date; `null` while it hasn't passed. */
  daysOverdue: number | null;
}

/** With `scope`, only that customer's (`H_CUST_CODE`) or item's (`D_ITEM_CODE`) orders. */
export function openKpiQuery(
  companies: BookCompanies,
  today: string,
  age: OrderAge,
  scope?: string | BookScope,
): Query {
  const lines = bookLines(companies, today, age, [], { flagScope: true, ...bookScope(scope) });
  return {
    sql: `
SELECT
    SUM(CASE WHEN in_scope = 1 AND ${OPEN_AED} THEN pend_value ELSE 0 END) AS open_value,
    COUNT(DISTINCT CASE WHEN in_scope = 1 AND pend_qty > 0 THEN order_key END) AS open_orders,
    SUM(CASE WHEN in_scope = 1 AND pend_qty > 0 THEN 1 ELSE 0 END) AS open_lines,
    SUM(CASE WHEN in_scope = 1 AND ${OPEN_AED} THEN 1 ELSE 0 END) AS open_aed_lines,
    SUM(CASE WHEN in_scope = 1 AND uninv_qty > 0 AND is_aed = 1 THEN uninv_value ELSE 0 END) AS uninv_value,
    SUM(CASE WHEN in_scope = 1 AND uninv_qty > 0 THEN 1 ELSE 0 END) AS uninv_lines,
    SUM(CASE WHEN in_scope = 1 AND ${OPEN_AED} AND del_date < :today THEN pend_value ELSE 0 END) AS overdue_value,
    SUM(CASE WHEN in_scope = 1 AND pend_qty > 0 AND del_date < :today THEN 1 ELSE 0 END) AS overdue_lines,
    SUM(CASE WHEN in_scope = 0 AND pend_qty > 0 THEN 1 ELSE 0 END) AS hidden_lines,
    SUM(CASE WHEN in_scope = 0 AND ${OPEN_AED} THEN pend_value ELSE 0 END) AS hidden_value
FROM (${lines.sql}
) book`,
    binds: { ...lines.binds, today },
  };
}

export function openByAgeQuery(companies: BookCompanies, today: string, age: OrderAge): Query {
  const lines = bookLines(companies, today, age);
  return {
    sql: `
SELECT bucket, SUM(${OPEN_AED_VALUE}) AS amount
FROM (${lines.sql}
) book
GROUP BY bucket`,
    binds: lines.binds,
  };
}

function openByLabelQuery(
  column: string,
  companies: BookCompanies,
  today: string,
  age: OrderAge,
  topN: number,
): Query {
  const lines = bookLines(companies, today, age, [`${labelOrUnassigned(column)} AS label`]);
  const grouped = `
            SELECT label, SUM(${OPEN_AED_VALUE}) AS amount
            FROM (${lines.sql}
            ) book
            GROUP BY label
            HAVING SUM(${OPEN_AED_LINE}) > 0`;
  return foldTopN(grouped, lines.binds, topN);
}

export function openBySalespersonQuery(
  companies: BookCompanies,
  today: string,
  age: OrderAge,
  topN = TOP_SALESPEOPLE,
) {
  return openByLabelQuery("H_SM_NAME", companies, today, age, topN);
}

/**
 * `H_CUST_NAME` is a per-row lookup inside Orion's view: grouping 50K open lines by it took 9-38 s
 * live. So lines are grouped by `H_CUST_CODE` (under 1 s) and the ~2K codes are then named from
 * `MBALI.ZF_CUSTOMER`, the table that lookup reads. Codes sharing a name still add up under it.
 */
export function openByCustomerQuery(
  companies: BookCompanies,
  today: string,
  age: OrderAge,
  topN = TOP_CUSTOMERS,
): Query {
  const lines = bookLines(companies, today, age, ["H_CUST_CODE AS cust_code"]);
  const grouped = `
            SELECT ${labelOrUnassigned("c.CUST_NAME")} AS label, SUM(by_code.amount) AS amount
            FROM (
                SELECT cust_code, SUM(${OPEN_AED_VALUE}) AS amount
                FROM (${lines.sql}
                ) book
                GROUP BY cust_code
                HAVING SUM(${OPEN_AED_LINE}) > 0
            ) by_code
            LEFT JOIN ${CUSTOMER_VIEW} c ON c.CUST_CODE = by_code.cust_code
            GROUP BY ${labelOrUnassigned("c.CUST_NAME")}`;
  return foldTopN(grouped, lines.binds, topN);
}

export function openByCurrencyQuery(
  companies: BookCompanies,
  today: string,
  age: OrderAge,
  scope?: string | BookScope,
): Query {
  const OPEN_OTHER = "pend_qty > 0 AND is_aed = 0";
  const lines = bookLines(
    companies,
    today,
    age,
    [`${labelOrUnassigned("H_CURR_CODE")} AS currency`],
    bookScope(scope),
  );
  return {
    sql: `
SELECT currency, SUM(CASE WHEN ${OPEN_OTHER} THEN 1 ELSE 0 END) AS line_count,
    SUM(CASE WHEN ${OPEN_OTHER} THEN pend_value ELSE 0 END) AS open_value
FROM (${lines.sql}
) book
GROUP BY currency
HAVING SUM(CASE WHEN ${OPEN_OTHER} THEN 1 ELSE 0 END) > 0
ORDER BY line_count DESC, currency`,
    binds: lines.binds,
  };
}

/** The largest open AED lines by pending value, at most `limit`; with `scope`, only those. */
export function openLinesQuery(
  companies: BookCompanies,
  today: string,
  age: OrderAge,
  limit = OPEN_ROW_LIMIT,
  scope?: string | BookScope,
): Query {
  const lines = bookLines(
    companies,
    today,
    age,
    [
      "H_COMP_CODE AS company_code",
      "H_CUST_CODE AS cust_code",
      "H_TXN_CODE AS txn_code",
      "H_TXN_NO AS txn_no",
      "TO_CHAR(H_DT, 'YYYY-MM-DD') AS order_date",
      `${labelOrUnassigned("H_CUST_NAME")} AS customer`,
      `${labelOrUnassigned("H_SM_NAME")} AS salesperson`,
      "D_ITEM_CODE AS item_code",
      "COALESCE(NULLIF(TRIM(D_ITEM_DESC), ''), D_ITEM_CODE) AS item",
      "D_QTY AS ordered_qty",
      "NVL(D_DELIVERED_QTY, 0) AS delivered_qty",
      "NVL(D_INVOICED_QTY, 0) AS invoiced_qty",
      "H_DEL_DT AS del_text",
    ],
    bookScope(scope),
  );
  const columns =
    "company_code, cust_code, txn_code, txn_no, order_date, customer, salesperson, item_code, item, ordered_qty, delivered_qty, invoiced_qty, del_text, pend_value";
  return {
    sql: `
SELECT ${columns}
FROM (
    SELECT ${columns}, ${OPEN_AED_LINE} AS is_open,
        ROW_NUMBER() OVER (
            ORDER BY ${OPEN_AED_LINE} DESC, pend_value DESC, order_date, company_code, txn_code, txn_no, item
        ) AS rn
    FROM (${lines.sql}
    ) book
) ranked
WHERE rn <= :row_limit AND is_open = 1
ORDER BY rn`,
    binds: { ...lines.binds, row_limit: limit },
  };
}

function text(value: unknown): string {
  return value === null || value === undefined ? "" : String(value);
}

/**
 * Headline open-book figures as of `today`, on orders placed since the `age` cut-off; with
 * `customer`, only that customer's orders.
 */
export async function openBookKpis(
  companies: BookCompanies,
  today: string,
  age: OrderAge,
  scope?: string | BookScope,
): Promise<OpenBookKpis> {
  const [row] = await run(openKpiQuery(companies, today, age, scope));
  return {
    openValue: num(row?.open_value),
    openOrders: num(row?.open_orders),
    openLines: num(row?.open_lines),
    openAedLines: num(row?.open_aed_lines),
    uninvoicedValue: num(row?.uninv_value),
    uninvoicedLines: num(row?.uninv_lines),
    overdueValue: num(row?.overdue_value),
    overdueLines: num(row?.overdue_lines),
    hiddenLines: num(row?.hidden_lines),
    hiddenValue: num(row?.hidden_value),
  };
}

/** Open AED value over the aging ladder, in ladder order; empty buckets are zero. */
export async function openByAge(companies: BookCompanies, today: string, age: OrderAge): Promise<number[]> {
  const rows = await run(openByAgeQuery(companies, today, age));
  const byBucket = new Map(rows.map((row) => [num(row.bucket), num(row.amount)]));
  return AGING_BUCKETS.map((_, index) => byBucket.get(index + 1) ?? 0);
}

async function labelValues(query: Query): Promise<LabelValue[]> {
  const rows = await run(query);
  return rows.map((row) => ({ label: String(row.label), value: num(row.amount) }));
}

/** Open AED value of the top salespeople; the last row may be 'All other'. */
export function openBySalesperson(
  companies: BookCompanies,
  today: string,
  age: OrderAge,
  topN = TOP_SALESPEOPLE,
) {
  return labelValues(openBySalespersonQuery(companies, today, age, topN));
}

/** Open AED value of the top customers; the last row may be 'All other'. */
export function openByCustomer(companies: BookCompanies, today: string, age: OrderAge, topN = TOP_CUSTOMERS) {
  return labelValues(openByCustomerQuery(companies, today, age, topN));
}

/** Open lines of non-AED orders per currency, left out of the AED figures. */
export async function openByCurrency(
  companies: BookCompanies,
  today: string,
  age: OrderAge,
  scope?: string | BookScope,
): Promise<CurrencyBook[]> {
  const rows = await run(openByCurrencyQuery(companies, today, age, scope));
  return rows.map((row) => ({
    currency: String(row.currency),
    lines: num(row.line_count),
    openValue: num(row.open_value),
  }));
}

export async function openLines(
  companies: BookCompanies,
  today: string,
  age: OrderAge,
  limit = OPEN_ROW_LIMIT,
  scope?: string | BookScope,
): Promise<OpenLine[]> {
  const rows = await run(openLinesQuery(companies, today, age, limit, scope));
  return rows.map((row) => {
    const expectedDate = parseOrionDate(row.del_text);
    const overdue = expectedDate === null ? null : daysBetween(expectedDate, today);
    return {
      companyCode: String(row.company_code),
      customerCode: text(row.cust_code),
      orderNumber: `${text(row.txn_code)}-${text(row.txn_no)}`,
      orderDate: String(row.order_date),
      customer: String(row.customer),
      salesperson: String(row.salesperson),
      itemCode: text(row.item_code),
      item: text(row.item),
      orderedQty: num(row.ordered_qty),
      deliveredQty: num(row.delivered_qty),
      invoicedQty: num(row.invoiced_qty),
      pendingValue: num(row.pend_value),
      expectedDate,
      daysOverdue: overdue !== null && overdue > 0 ? overdue : null,
    };
  });
}

/** The item page lists at most this many of an item's open lines (the largest quantity first). */
export const ITEM_OPEN_ROW_LIMIT = 200;

export interface ItemOpenLine {
  companyCode: string;
  customerCode: string;
  customer: string;
  orderNumber: string;
  /** YYYY-MM-DD. */
  orderDate: string;
  currency: string;
  orderedQty: number;
  deliveredQty: number;
  /** Still to deliver. */
  pendingQty: number;
  /** In the order's currency. */
  pendingValue: number;
  /** YYYY-MM-DD; `null` if Orion's text date can't be read. */
  expectedDate: string | null;
  daysOverdue: number | null;
}

export interface ItemOpenBook {
  /** Every open line of the item (something left to deliver), in any currency. */
  lines: number;
  pendingQty: number;
  /** The largest by quantity still to deliver, at most {@link ITEM_OPEN_ROW_LIMIT}. */
  rows: ItemOpenLine[];
}

/**
 * One item's open order lines with something left to deliver, in any currency (a quantity adds up
 * whatever the currency), largest quantity first, with the totals of all of them on every row. Same
 * book as the Sales orders page: Closed orders are out, and so are orders older than the `age` cut-off.
 */
export function itemOpenLinesQuery(
  companies: BookCompanies,
  today: string,
  age: OrderAge,
  item: string,
  limit = ITEM_OPEN_ROW_LIMIT,
): Query {
  const lines = bookLines(
    companies,
    today,
    age,
    [
      "H_COMP_CODE AS company_code",
      "H_CUST_CODE AS cust_code",
      `${labelOrUnassigned("H_CUST_NAME")} AS customer`,
      "H_TXN_CODE AS txn_code",
      "H_TXN_NO AS txn_no",
      "TO_CHAR(H_DT, 'YYYY-MM-DD') AS order_date",
      `${labelOrUnassigned("H_CURR_CODE")} AS currency`,
      "D_QTY AS ordered_qty",
      "NVL(D_DELIVERED_QTY, 0) AS delivered_qty",
      "H_DEL_DT AS del_text",
    ],
    { item },
  );
  const columns =
    "company_code, cust_code, customer, txn_code, txn_no, order_date, currency, ordered_qty, delivered_qty, del_text, pend_qty, pend_value";
  return {
    sql: `
SELECT ${columns}, total_lines, total_qty
FROM (
    SELECT ${columns},
        ROW_NUMBER() OVER (ORDER BY pend_qty DESC, order_date, company_code, txn_code, txn_no) AS rn,
        COUNT(*) OVER () AS total_lines,
        SUM(pend_qty) OVER () AS total_qty
    FROM (${lines.sql}
    ) book
    WHERE pend_qty > 0
) ranked
WHERE rn <= :row_limit
ORDER BY rn`,
    binds: { ...lines.binds, row_limit: limit },
  };
}

export async function itemOpenBook(
  companies: BookCompanies,
  today: string,
  age: OrderAge,
  item: string,
  limit = ITEM_OPEN_ROW_LIMIT,
): Promise<ItemOpenBook> {
  const rows = await run(itemOpenLinesQuery(companies, today, age, item, limit));
  return {
    lines: num(rows[0]?.total_lines),
    pendingQty: num(rows[0]?.total_qty),
    rows: rows.map((row) => {
      const expectedDate = parseOrionDate(row.del_text);
      const overdue = expectedDate === null ? null : daysBetween(expectedDate, today);
      return {
        companyCode: String(row.company_code),
        customerCode: text(row.cust_code),
        customer: String(row.customer),
        orderNumber: `${text(row.txn_code)}-${text(row.txn_no)}`,
        orderDate: String(row.order_date),
        currency: String(row.currency),
        orderedQty: num(row.ordered_qty),
        deliveredQty: num(row.delivered_qty),
        pendingQty: num(row.pend_qty),
        pendingValue: num(row.pend_value),
        expectedDate,
        daysOverdue: overdue !== null && overdue > 0 ? overdue : null,
      };
    }),
  };
}

// ---------------------------------------------------------------------------------------------
// Orders booked in the period

export interface BookedKpis {
  orders: number;
  /** AED orders, net of the cancelled part of Closed lines. */
  value: number;
}

export interface BookedMonth extends BookedKpis {
  /** `YYYY-MM`. */
  month: string;
  lastYearOrders: number;
  lastYearValue: number;
}

/** The view with each line's brand as `brand_map.brand_name`, for the brand breakdown only. */
const BOOKED_WITH_BRAND = `${VIEW}
    LEFT JOIN (${BRAND_MAP}) brand_map ON brand_map.item_code = TRIM(D_ITEM_CODE)`;

/**
 * Booked lines with their month, order and AED value, plus `columns`. With `withBrand` each line
 * also has its brand as `brand_map.brand_name`, from the per-item map.
 */
function bookedLines(filters: Filters, columns: string[] = [], withBrand = false): Query {
  const { sql, binds } = filterWhere(filters, "H_DT", "H_COMP_CODE", SALES_COLUMNS);
  const select = [
    "TO_CHAR(H_DT, 'YYYY-MM') AS order_month",
    `${ORDER_KEY} AS order_key`,
    `CASE WHEN H_CURR_CODE = '${AED}' THEN ${BOOKED_VALUE} ELSE 0 END AS aed_value`,
    ...columns,
  ];
  return {
    sql: `
    SELECT ${select.join(",\n        ")}
    FROM ${withBrand ? BOOKED_WITH_BRAND : VIEW}
    WHERE ${BOOKED_LINE} AND ${sql}`,
    binds,
  };
}

export function bookedKpiQuery(filters: Filters): Query {
  const lines = bookedLines(filters);
  return {
    sql: `
SELECT COUNT(DISTINCT order_key) AS order_count, SUM(aed_value) AS booked_value
FROM (${lines.sql}
) booked`,
    binds: lines.binds,
  };
}

export function bookedMonthlyQuery(filters: Filters): Query {
  const lines = bookedLines(filters);
  return {
    sql: `
SELECT order_month, COUNT(DISTINCT order_key) AS order_count, SUM(aed_value) AS booked_value
FROM (${lines.sql}
) booked
GROUP BY order_month
ORDER BY order_month`,
    binds: lines.binds,
  };
}

/** Orders booked in the period and their AED value. */
export async function bookedKpis(filters: Filters): Promise<BookedKpis> {
  const [row] = await run(bookedKpiQuery(filters));
  return { orders: num(row?.order_count), value: num(row?.booked_value) };
}

/** Every month of the period with what was booked, and the same month a year earlier. */
export async function bookedMonthly(filters: Filters): Promise<BookedMonth[]> {
  const [current, previous] = await Promise.all([
    run(bookedMonthlyQuery(filters)),
    run(bookedMonthlyQuery(previousYear(filters))),
  ]);
  const byMonth = new Map(current.map((row) => [String(row.order_month), row]));
  const lastYear = new Map(previous.map((row) => [shiftMonth(String(row.order_month), 1), row]));
  return monthsInRange(filters.start, filters.end).map((month) => ({
    month,
    orders: num(byMonth.get(month)?.order_count),
    value: num(byMonth.get(month)?.booked_value),
    lastYearOrders: num(lastYear.get(month)?.order_count),
    lastYearValue: num(lastYear.get(month)?.booked_value),
  }));
}

// ---------------------------------------------------------------------------------------------
// Hover cards and drill-downs

/** Slices per dimension on the hover card; the rest fold into 'All other'. */
export const HOVER_TOP_N = 5;

export type OrderDimension = "company" | "salesperson" | "brand";

/** What a booked-month card, and an order-age column's card, break their bar down by. */
export const BOOKED_CARD_DIMENSIONS: readonly OrderDimension[] = ["company", "salesperson", "brand"];
export const AGE_CARD_DIMENSIONS: readonly OrderDimension[] = ["company", "salesperson"];

/** Company is by code; the cards name it from the company master. Brand only on booked lines. */
const ORDER_DIMENSION_COLUMNS: Record<OrderDimension, string> = {
  company: "H_COMP_CODE",
  salesperson: "H_SM_NAME",
  brand: "brand_map.brand_name",
};

export interface OrderBreakdown {
  dimension: OrderDimension;
  rows: LabelValue[];
}

/** Company codes in `breakdowns` replaced by their names. */
async function nameCompanies(breakdowns: OrderBreakdown[]): Promise<OrderBreakdown[]> {
  if (!breakdowns.some((breakdown) => breakdown.dimension === "company")) return breakdowns;
  const names = new Map((await loadCompanies()).map((company) => [company.code, company.name]));
  return breakdowns.map((breakdown) =>
    breakdown.dimension !== "company"
      ? breakdown
      : {
          ...breakdown,
          rows: breakdown.rows.map((row) => ({ ...row, label: names.get(row.label) ?? row.label })),
        },
  );
}

/** AED value booked by one dimension: the top `topN` plus 'All other'. */
export function bookedByDimensionQuery(
  filters: Filters,
  dimension: OrderDimension,
  topN = HOVER_TOP_N,
): Query {
  const lines = bookedLines(
    filters,
    [`${labelOrUnassigned(ORDER_DIMENSION_COLUMNS[dimension])} AS label`],
    dimension === "brand",
  );
  const grouped = `
            SELECT label, SUM(aed_value) AS amount
            FROM (${lines.sql}
            ) booked
            GROUP BY label`;
  return foldTopN(grouped, lines.binds, topN);
}

export interface BookedHover {
  value: number;
  /** The same days a year earlier. */
  lastYearValue: number;
  orders: number;
  breakdowns: OrderBreakdown[];
}

/**
 * What makes up one bar of the booked trend: its AED value, last year's, and the top
 * `HOVER_TOP_N` companies, salespeople and brands plus 'All other'. `filters` is already narrowed
 * to the bar's days. Each dimension's rows add up to `value`.
 */
export async function bookedHover(
  filters: Filters,
  dimensions: readonly OrderDimension[] = BOOKED_CARD_DIMENSIONS,
): Promise<BookedHover> {
  const [current, previous, breakdowns] = await Promise.all([
    bookedKpis(filters),
    bookedKpis(previousYear(filters)),
    Promise.all(dimensions.map((dimension) => labelValues(bookedByDimensionQuery(filters, dimension)))),
  ]);
  return {
    value: current.value,
    lastYearValue: previous.value,
    orders: current.orders,
    breakdowns: await nameCompanies(
      dimensions.map((dimension, index) => ({ dimension, rows: breakdowns[index] })),
    ),
  };
}

/** Open AED value in one order-age bucket, per lines' `label`. */
const IN_BUCKET_VALUE = `CASE WHEN bucket = :age_bucket THEN ${OPEN_AED_VALUE} ELSE 0 END`;
const IN_BUCKET_LINE = `CASE WHEN bucket = :age_bucket THEN ${OPEN_AED_LINE} ELSE 0 END`;

/** Open AED value of one order-age column by one dimension: the top `topN` plus 'All other'. */
export function openAgeByDimensionQuery(
  companies: BookCompanies,
  today: string,
  age: OrderAge,
  bucket: number,
  dimension: Exclude<OrderDimension, "brand">,
  topN = HOVER_TOP_N,
): Query {
  const lines = bookLines(companies, today, age, [
    `${labelOrUnassigned(ORDER_DIMENSION_COLUMNS[dimension])} AS label`,
  ]);
  const grouped = `
            SELECT label, SUM(${IN_BUCKET_VALUE}) AS amount
            FROM (${lines.sql}
            ) book
            GROUP BY label
            HAVING SUM(${IN_BUCKET_LINE}) > 0`;
  return foldTopN(grouped, { ...lines.binds, age_bucket: bucket }, topN);
}

export interface AgeHover {
  /** Open AED value in the column, as the chart shows it. */
  value: number;
  breakdowns: OrderBreakdown[];
}

/**
 * What makes up one column of "Open value by order age": its value (the chart's own query) and the
 * top `HOVER_TOP_N` companies and salespeople plus 'All other'. As of today: no last year.
 */
export async function openAgeHover(
  companies: BookCompanies,
  today: string,
  age: OrderAge,
  bucket: number,
): Promise<AgeHover> {
  const [values, breakdowns] = await Promise.all([
    openByAge(companies, today, age),
    Promise.all(
      AGE_CARD_DIMENSIONS.map((dimension) =>
        labelValues(
          openAgeByDimensionQuery(
            companies,
            today,
            age,
            bucket,
            dimension as Exclude<OrderDimension, "brand">,
          ),
        ),
      ),
    ),
  ]);
  return {
    value: values[bucket - 1] ?? 0,
    breakdowns: await nameCompanies(
      AGE_CARD_DIMENSIONS.map((dimension, index) => ({ dimension, rows: breakdowns[index] })),
    ),
  };
}

/** The drill-downs list at most this many orders (the largest first). */
export const ORDER_LIMIT = 300;

export interface OrderSummary extends DocumentKey {
  /** YYYY-MM-DD. */
  date: string;
  customerCode: string;
  customer: string;
  salesperson: string;
  currency: string;
  lineCount: number;
  /** AED: booked value, or open value for the order-age drill; 0 on other currencies. */
  value: number;
}

export interface OrderList {
  orders: OrderSummary[];
  /** Every order in the bar; `orders` stops at `limit`. */
  total: number;
  /** The bar's exact value and order count, whatever the limit. */
  totals: { value: number; orders: number };
  limit: number;
}

export interface OrderLine {
  itemCode: string;
  item: string;
  currency: string;
  orderedQty: number;
  deliveredQty: number;
  invoicedQty: number;
  /** AED: booked value, or open value for the order-age drill; 0 on other currencies. */
  value: number;
}

/**
 * Rank per-order rows (`grouped`: company_code, txn_code, txn_no, order_date, cust_code,
 * salesperson, currency, line_count, amount) by value and keep `limit`, named from the customer
 * master afterwards: `H_CUST_NAME` is a per-row lookup in Orion's view (see `openByCustomerQuery`).
 */
function rankOrders(grouped: string, binds: Binds, limit: number): Query {
  return {
    sql: `
SELECT ranked.*, ${labelOrUnassigned("c.CUST_NAME")} AS customer
FROM (
    SELECT company_code, txn_code, txn_no, order_date, cust_code, salesperson, currency, line_count, amount,
        COUNT(*) OVER () AS total_orders,
        ROW_NUMBER() OVER (ORDER BY ABS(amount) DESC, order_date, company_code, txn_code, txn_no) AS rn
    FROM (${grouped}
    ) grouped
) ranked
LEFT JOIN ${CUSTOMER_VIEW} c ON c.CUST_CODE = ranked.cust_code
WHERE ranked.rn <= :row_limit
ORDER BY ranked.rn`,
    binds: { ...binds, row_limit: limit },
  };
}

const ORDER_COLUMNS = [
  "H_COMP_CODE AS company_code",
  "H_TXN_CODE AS txn_code",
  "H_TXN_NO AS txn_no",
  "TO_CHAR(H_DT, 'YYYY-MM-DD') AS order_date",
  "TRIM(H_CUST_CODE) AS cust_code",
  `${labelOrUnassigned("H_SM_NAME")} AS salesperson`,
  `${labelOrUnassigned("H_CURR_CODE")} AS currency`,
];

/** The orders booked in the period (already narrowed to a bar's days), largest AED value first. */
export function bookedOrdersQuery(filters: Filters, limit = ORDER_LIMIT): Query {
  const lines = bookedLines(filters, ORDER_COLUMNS);
  const grouped = `
        SELECT company_code, txn_code, txn_no, MIN(order_date) AS order_date, MAX(cust_code) AS cust_code,
            MAX(salesperson) AS salesperson, MAX(currency) AS currency, COUNT(*) AS line_count,
            SUM(aed_value) AS amount
        FROM (${lines.sql}
        ) booked
        GROUP BY company_code, txn_code, txn_no`;
  return rankOrders(grouped, lines.binds, limit);
}

/** The orders in one order-age column, largest open AED value first. */
export function openAgeOrdersQuery(
  companies: BookCompanies,
  today: string,
  age: OrderAge,
  bucket: number,
  limit = ORDER_LIMIT,
): Query {
  const lines = bookLines(companies, today, age, ORDER_COLUMNS);
  const grouped = `
        SELECT company_code, txn_code, txn_no, MIN(order_date) AS order_date, MAX(cust_code) AS cust_code,
            MAX(salesperson) AS salesperson, MAX(currency) AS currency, SUM(${IN_BUCKET_LINE}) AS line_count,
            SUM(${IN_BUCKET_VALUE}) AS amount
        FROM (${lines.sql}
        ) book
        GROUP BY company_code, txn_code, txn_no
        HAVING SUM(${IN_BUCKET_LINE}) > 0`;
  return rankOrders(grouped, { ...lines.binds, age_bucket: bucket }, limit);
}

function toOrders(rows: Record<string, unknown>[], totals: OrderList["totals"], limit: number): OrderList {
  return {
    orders: rows.map((row) => ({
      date: text(row.order_date),
      company: text(row.company_code),
      txnCode: text(row.txn_code),
      // TXN_NO is a NUMBER; format it here so no ".0" can creep in.
      no: String(num(row.txn_no)),
      customerCode: text(row.cust_code),
      customer: text(row.customer),
      salesperson: text(row.salesperson),
      currency: text(row.currency),
      lineCount: num(row.line_count),
      value: num(row.amount),
    })),
    total: num(rows[0]?.total_orders),
    totals,
    limit,
  };
}

/** The orders behind a booked bar, at most `limit`, with the bar's exact totals from the KPI query. */
export async function bookedOrders(filters: Filters, limit = ORDER_LIMIT): Promise<OrderList> {
  const [rows, kpis] = await Promise.all([run(bookedOrdersQuery(filters, limit)), bookedKpis(filters)]);
  return toOrders(rows, { value: kpis.value, orders: kpis.orders }, limit);
}

/** The orders in one order-age column, at most `limit`, with the column's value from the chart's query. */
export async function openAgeOrders(
  companies: BookCompanies,
  today: string,
  age: OrderAge,
  bucket: number,
  limit = ORDER_LIMIT,
): Promise<OrderList> {
  const [rows, values] = await Promise.all([
    run(openAgeOrdersQuery(companies, today, age, bucket, limit)),
    openByAge(companies, today, age),
  ]);
  return toOrders(rows, { value: values[bucket - 1] ?? 0, orders: num(rows[0]?.total_orders) }, limit);
}

const LINE_COLUMNS = [
  "D_ITEM_CODE AS item_code",
  "COALESCE(NULLIF(TRIM(D_ITEM_DESC), ''), D_ITEM_CODE) AS item",
  `${labelOrUnassigned("H_CURR_CODE")} AS currency`,
  "D_QTY AS ordered_qty",
  "NVL(D_DELIVERED_QTY, 0) AS delivered_qty",
  "NVL(D_INVOICED_QTY, 0) AS invoiced_qty",
  "H_COMP_CODE AS company_code",
  "H_TXN_CODE AS txn_code",
  "H_TXN_NO AS txn_no",
];

const ORDER_MATCH = "company_code = :doc_company AND txn_code = :doc_txn_code AND txn_no = :doc_no";

function docBinds(doc: DocumentKey): Binds {
  return { doc_company: doc.company, doc_txn_code: doc.txnCode, doc_no: doc.no };
}

/** One booked order's lines within the period, largest first. */
export function bookedOrderLinesQuery(filters: Filters, doc: DocumentKey): Query {
  const lines = bookedLines(filters, LINE_COLUMNS);
  return {
    sql: `
SELECT item_code, item, currency, ordered_qty, delivered_qty, invoiced_qty, aed_value AS amount
FROM (${lines.sql}
) booked
WHERE ${ORDER_MATCH}
ORDER BY ABS(aed_value) DESC, item_code`,
    binds: { ...lines.binds, ...docBinds(doc) },
  };
}

/** One order's open AED lines in an order-age column, largest pending value first. */
export function openOrderLinesQuery(
  companies: BookCompanies,
  today: string,
  age: OrderAge,
  bucket: number,
  doc: DocumentKey,
): Query {
  const lines = bookLines(companies, today, age, LINE_COLUMNS);
  return {
    sql: `
SELECT item_code, item, currency, ordered_qty, delivered_qty, invoiced_qty, pend_value AS amount
FROM (${lines.sql}
) book
WHERE ${ORDER_MATCH} AND ${IN_BUCKET_LINE} = 1
ORDER BY pend_value DESC, item_code`,
    binds: { ...lines.binds, ...docBinds(doc), age_bucket: bucket },
  };
}

function toLines(rows: Record<string, unknown>[]): OrderLine[] {
  return rows.map((row) => ({
    itemCode: text(row.item_code).trim(),
    item: text(row.item),
    currency: text(row.currency),
    orderedQty: num(row.ordered_qty),
    deliveredQty: num(row.delivered_qty),
    invoicedQty: num(row.invoiced_qty),
    value: num(row.amount),
  }));
}

export async function bookedOrderLines(filters: Filters, doc: DocumentKey): Promise<OrderLine[]> {
  return toLines(await run(bookedOrderLinesQuery(filters, doc)));
}

export async function openOrderLines(
  companies: BookCompanies,
  today: string,
  age: OrderAge,
  bucket: number,
  doc: DocumentKey,
): Promise<OrderLine[]> {
  return toLines(await run(openOrderLinesQuery(companies, today, age, bucket, doc)));
}
