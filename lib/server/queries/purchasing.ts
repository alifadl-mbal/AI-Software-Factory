import "server-only";

import { addDays, daysBetween, monthsInRange, previousYear, shiftMonth, type Filters } from "@/lib/filters";
import { orderAgeCutoff, type OrderAge } from "@/lib/order-age";

import { run } from "../db";
import { ALL_OTHER, companyWhere, filterWhere, labelOrUnassigned, num } from "../sql";
import type { Binds, Query } from "../types";

/**
 * Purchasing dashboard queries on two views:
 *
 * Pending POs, `MBALI.ZF_PO_PENDING_BI`, one row per open PO line, **as of today**: the date
 * filter doesn't apply, the company filter does.
 * - A line counts when `PO_CLO_STATUS = 0` (a NUMBER: 0 = Open; comparing it to 'O' raises
 *   ORA-01722) and `PO_PEND_QTY > 0`. The view is pre-filtered to open lines but still holds some
 *   fully received ones (`PO_PEND_QTY = 0`).
 * - The view has no `PO_PEND_LC_VAL` (checked with `--describe` on 2026-10-20, whatever the older
 *   docs say), so the pending AED value is the line's net AED value pro rata to the pending
 *   quantity: `(PO_LC_VAL - PO_LC_DISC) * PO_PEND_QTY / PO_QTY`. `PO_LC_NET_VAL` isn't used: it is
 *   0 on some lines that have a value and no discount.
 * - There is no aging column. Expected date = `PO_DATE + 84` days. A line is 'On Time' while the
 *   expected date is in the future, else overdue by `today - expected date` days, bucketed as
 *   0-90 / 90-180 / 180-365 / 365+ (lower bound inclusive). The bucket edges are computed here as
 *   dates and bound, because date arithmetic isn't portable to sample mode.
 *
 * - Order age (`lib/order-age.ts`): by default only lines with `PO_DATE` in the last 2 years count,
 *   because older open lines are almost all received or cancelled without being closed. Every
 *   pending query goes through `pendingLines`, which applies the cut-off. The KPI query keeps the
 *   older lines and flags them instead (`in_scope`), so one round trip also says what is left out.
 *
 * Receipts, `MBALI.ZF_CPR_BI`, one row per goods-receipt line, dated `CPR_DATE`; follows both
 * filters.
 * - Spend = `SUM(CPR_LANDED_VALUE)` (AED). Returns to supplier (`CPR_SIGN = -1`) are already
 *   negative, so they reduce spend by themselves.
 * - A non-AED line with `CPR_EXGE_RATE = 0` has its AED value silently zeroed: those are reported
 *   as a data-quality warning, with their foreign-currency value.
 */

const PENDING_VIEW = "MBALI.ZF_PO_PENDING_BI";
const RECEIPTS_VIEW = "MBALI.ZF_CPR_BI";

const PENDING_LINE = "PO_CLO_STATUS = 0 AND PO_PEND_QTY > 0";
const PENDING_VALUE = "(NVL(PO_LC_VAL, 0) - NVL(PO_LC_DISC, 0)) * PO_PEND_QTY / NULLIF(PO_QTY, 0)";
const SPEND = "NVL(CPR_LANDED_VALUE, 0)";
const ZERO_RATE = "CPR_CURR_CODE <> 'AED' AND NVL(CPR_EXGE_RATE, 0) = 0";

/** Days from PO date to expected delivery. */
export const PO_LEAD_DAYS = 84;
export const TOP_N = 20;
/** The overdue-lines table shows at most this many lines (the largest by pending value). */
export const OVERDUE_ROW_LIMIT = 1000;

export const ON_TIME = "On Time";
/** Every aging bucket in display order, with the lowest days-overdue it starts at. */
export const AGING_BUCKETS = [
  { label: "0-90 Days Overdue", fromDays: 0 },
  { label: "90-180 Days Overdue", fromDays: 90 },
  { label: "180-365 Days Overdue", fromDays: 180 },
  { label: "365+ Days Overdue", fromDays: 365 },
] as const;
export const BUCKET_ORDER = [ON_TIME, ...AGING_BUCKETS.map((bucket) => bucket.label)] as const;

/** Days a PO with this date is overdue on `today`; negative while it is on time. */
export function daysOverdue(poDate: string, today: string): number {
  return daysBetween(addDays(poDate, PO_LEAD_DAYS), today);
}

/** The bucket a PO with this date is in on `today`. Mirrors the SQL `CASE`. */
export function agingBucket(poDate: string, today: string): string {
  const overdue = daysOverdue(poDate, today);
  if (overdue < 0) return ON_TIME;
  return [...AGING_BUCKETS].reverse().find((bucket) => overdue >= bucket.fromDays)!.label;
}

/**
 * The SQL `CASE` that puts a line in its bucket, and its binds. Overdue by at least N days means
 * `PO_DATE <= today - 84 - N`, i.e. `PO_DATE < today - 84 - N + 1`, which also holds when
 * `PO_DATE` carries a time of day.
 */
function bucketCase(today: string): { sql: string; binds: Binds } {
  const binds: Binds = { on_time_from: addDays(today, -PO_LEAD_DAYS + 1) };
  const branches = [`WHEN PO_DATE >= TO_DATE(:on_time_from, 'YYYY-MM-DD') THEN '${ON_TIME}'`];
  AGING_BUCKETS.forEach((bucket, index) => {
    const next = AGING_BUCKETS[index + 1];
    if (!next) return;
    const name = `overdue_${next.fromDays}_before`;
    binds[name] = addDays(today, -PO_LEAD_DAYS - next.fromDays + 1);
    branches.push(`WHEN PO_DATE >= TO_DATE(:${name}, 'YYYY-MM-DD') THEN '${bucket.label}'`);
  });
  const last = AGING_BUCKETS[AGING_BUCKETS.length - 1].label;
  return { sql: `CASE ${branches.join(" ")} ELSE '${last}' END`, binds };
}

function pendingWhere(companies: readonly string[]): { sql: string; binds: Binds } {
  const company = companyWhere(companies, "PO_COMP_CODE");
  return company
    ? { sql: `${PENDING_LINE} AND ${company.sql}`, binds: company.binds }
    : { sql: PENDING_LINE, binds: {} };
}

/** `PO_DATE` on or after the order-age cut-off, which is worked out in TypeScript and bound. */
const IN_SCOPE = "PO_DATE >= TO_DATE(:since_date, 'YYYY-MM-DD')";

/**
 * Pending lines with their value and bucket, as a subquery to aggregate over. Lines on orders older
 * than the `age` cut-off are left out, or with `flagScope` kept and flagged `in_scope = 0`.
 */
function pendingLines(
  companies: readonly string[],
  today: string,
  age: OrderAge,
  columns: string[] = [],
  { flagScope = false }: { flagScope?: boolean } = {},
): Query {
  const where = pendingWhere(companies);
  const bucket = bucketCase(today);
  const cutoff = orderAgeCutoff(age, today);
  const select = [...columns, `${PENDING_VALUE} AS pend_value`, `${bucket.sql} AS bucket`];
  if (flagScope)
    select.push(cutoff ? `CASE WHEN ${IN_SCOPE} THEN 1 ELSE 0 END AS in_scope` : "1 AS in_scope");
  return {
    sql: `
    SELECT ${select.join(",\n        ")}
    FROM ${PENDING_VIEW}
    WHERE ${where.sql}${cutoff && !flagScope ? ` AND ${IN_SCOPE}` : ""}`,
    binds: { ...where.binds, ...bucket.binds, ...(cutoff ? { since_date: cutoff } : {}) },
  };
}

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
// Pending POs

export interface PendingKpis {
  pendingValue: number;
  openLines: number;
  overdueValue: number;
  overdueLines: number;
  /** Fraction of the pending value that is overdue; `null` with nothing pending. */
  overduePct: number | null;
  /** Pending lines on orders placed before the order-age cut-off: left out of the figures above. */
  hiddenLines: number;
  hiddenValue: number;
}

export interface LabelValue {
  label: string;
  value: number;
}

export interface OverdueLine {
  companyCode: string;
  poNumber: string;
  supplier: string;
  item: string;
  /** YYYY-MM-DD. */
  poDate: string;
  daysOpen: number;
  daysOverdue: number;
  pendingQty: number;
  pendingValue: number;
}

export function pendingKpiQuery(companies: readonly string[], today: string, age: OrderAge): Query {
  const lines = pendingLines(companies, today, age, [], { flagScope: true });
  return {
    sql: `
SELECT SUM(CASE WHEN in_scope = 1 THEN pend_value ELSE 0 END) AS pending_value,
    SUM(in_scope) AS open_lines,
    SUM(CASE WHEN in_scope = 1 AND bucket <> '${ON_TIME}' THEN pend_value ELSE 0 END) AS overdue_value,
    SUM(CASE WHEN in_scope = 1 AND bucket <> '${ON_TIME}' THEN 1 ELSE 0 END) AS overdue_lines,
    SUM(CASE WHEN in_scope = 0 THEN pend_value ELSE 0 END) AS hidden_value,
    SUM(1 - in_scope) AS hidden_lines
FROM (${lines.sql}
) lines`,
    binds: lines.binds,
  };
}

export function pendingByBucketQuery(companies: readonly string[], today: string, age: OrderAge): Query {
  const lines = pendingLines(companies, today, age);
  return {
    sql: `
SELECT bucket AS label, SUM(pend_value) AS amount, COUNT(*) AS line_count
FROM (${lines.sql}
) lines
GROUP BY bucket`,
    binds: lines.binds,
  };
}

export function pendingBySupplierQuery(
  companies: readonly string[],
  today: string,
  age: OrderAge,
  topN = TOP_N,
): Query {
  const lines = pendingLines(companies, today, age, [`${labelOrUnassigned("PO_SUPP_NAME")} AS label`]);
  const grouped = `
            SELECT label, SUM(pend_value) AS amount
            FROM (${lines.sql}
            ) lines
            GROUP BY label`;
  return foldTopN(grouped, lines.binds, topN);
}

export function pendingByCompanyQuery(companies: readonly string[], today: string, age: OrderAge): Query {
  const lines = pendingLines(companies, today, age, ["PO_COMP_CODE AS company_code"]);
  return {
    sql: `
SELECT company_code, SUM(pend_value) AS amount
FROM (${lines.sql}
) lines
GROUP BY company_code
ORDER BY amount DESC, company_code`,
    binds: lines.binds,
  };
}

/** The largest overdue lines by pending value, at most `limit`. */
export function overdueLinesQuery(
  companies: readonly string[],
  today: string,
  age: OrderAge,
  limit = OVERDUE_ROW_LIMIT,
): Query {
  const lines = pendingLines(companies, today, age, [
    "PO_COMP_CODE AS company_code",
    "PO_TXN_CODE AS txn_code",
    "PO_TXN_NO AS txn_no",
    `${labelOrUnassigned("PO_SUPP_NAME")} AS supplier`,
    "COALESCE(NULLIF(TRIM(PO_ITEM_DESC), ''), PO_ITEM_CODE) AS item",
    "TO_CHAR(PO_DATE, 'YYYY-MM-DD') AS po_date",
    "PO_PEND_QTY AS pend_qty",
  ]);
  return {
    sql: `
SELECT company_code, txn_code, txn_no, supplier, item, po_date, pend_qty, pend_value
FROM (
    SELECT company_code, txn_code, txn_no, supplier, item, po_date, pend_qty, pend_value,
        ROW_NUMBER() OVER (ORDER BY pend_value DESC, po_date, company_code, txn_code, txn_no) AS rn
    FROM (${lines.sql}
    ) lines
    WHERE bucket <> '${ON_TIME}'
) ranked
WHERE rn <= :row_limit
ORDER BY rn`,
    binds: { ...lines.binds, row_limit: limit },
  };
}

/** Headline pending-PO figures as of `today`, on orders placed since the `age` cut-off. */
export async function pendingKpis(
  companies: readonly string[],
  today: string,
  age: OrderAge,
): Promise<PendingKpis> {
  const [row] = await run(pendingKpiQuery(companies, today, age));
  const pendingValue = num(row?.pending_value);
  const overdueValue = num(row?.overdue_value);
  return {
    pendingValue,
    openLines: num(row?.open_lines),
    overdueValue,
    overdueLines: num(row?.overdue_lines),
    overduePct: pendingValue ? overdueValue / pendingValue : null,
    hiddenLines: num(row?.hidden_lines),
    hiddenValue: num(row?.hidden_value),
  };
}

/** Pending value in every bucket, in bucket order; empty buckets are zero. */
export async function pendingByBucket(
  companies: readonly string[],
  today: string,
  age: OrderAge,
): Promise<LabelValue[]> {
  const rows = await run(pendingByBucketQuery(companies, today, age));
  const byBucket = new Map(rows.map((row) => [String(row.label), num(row.amount)]));
  return BUCKET_ORDER.map((label) => ({ label, value: byBucket.get(label) ?? 0 }));
}

/** Pending value of the top suppliers; the last row may be 'All other'. */
export async function pendingBySupplier(
  companies: readonly string[],
  today: string,
  age: OrderAge,
  topN = TOP_N,
): Promise<LabelValue[]> {
  const rows = await run(pendingBySupplierQuery(companies, today, age, topN));
  return rows.map((row) => ({ label: String(row.label), value: num(row.amount) }));
}

/** Pending value per company code, largest first. */
export async function pendingByCompany(
  companies: readonly string[],
  today: string,
  age: OrderAge,
): Promise<LabelValue[]> {
  const rows = await run(pendingByCompanyQuery(companies, today, age));
  return rows.map((row) => ({ label: String(row.company_code), value: num(row.amount) }));
}

export async function overdueLines(
  companies: readonly string[],
  today: string,
  age: OrderAge,
  limit = OVERDUE_ROW_LIMIT,
): Promise<OverdueLine[]> {
  const rows = await run(overdueLinesQuery(companies, today, age, limit));
  return rows.map((row) => {
    const poDate = String(row.po_date);
    return {
      companyCode: String(row.company_code),
      // TXN_NO is a NUMBER; format it here so no ".0" can creep in.
      poNumber: `${String(row.txn_code)}-${num(row.txn_no)}`,
      supplier: String(row.supplier),
      item: row.item === null || row.item === undefined ? "" : String(row.item),
      poDate,
      daysOpen: daysBetween(poDate, today),
      daysOverdue: daysOverdue(poDate, today),
      pendingQty: num(row.pend_qty),
      pendingValue: num(row.pend_value),
    };
  });
}

// ---------------------------------------------------------------------------------------------
// Receipts

export interface ReceiptsKpis {
  spend: number;
  /** Returns to supplier: negative, already netted out of spend. */
  returnsValue: number;
  lineCount: number;
}

export interface ReceiptsMonth {
  /** `YYYY-MM`. */
  month: string;
  spend: number;
  lastYearSpend: number;
}

export interface ZeroRateCurrency {
  currency: string;
  lineCount: number;
  /** Foreign-currency value (`CPR_FC_WAC_VALUE`) in `currency`. */
  fcValue: number;
  /** The AED value Orion recorded: usually 0, which is the problem. */
  landedValue: number;
}

function receiptsWhere(filters: Filters): { sql: string; binds: Binds } {
  return filterWhere(filters, "CPR_DATE", "CPR_COMP_CODE");
}

export function receiptsKpiQuery(filters: Filters): Query {
  const { sql, binds } = receiptsWhere(filters);
  return {
    sql: `
SELECT SUM(${SPEND}) AS spend,
    SUM(CASE WHEN CPR_SIGN = -1 THEN ${SPEND} ELSE 0 END) AS returns_value,
    COUNT(*) AS line_count
FROM ${RECEIPTS_VIEW}
WHERE ${sql}`,
    binds,
  };
}

export function receiptsMonthlyQuery(filters: Filters): Query {
  const { sql, binds } = receiptsWhere(filters);
  return {
    sql: `
SELECT TO_CHAR(CPR_DATE, 'YYYY-MM') AS receipt_month, SUM(${SPEND}) AS spend
FROM ${RECEIPTS_VIEW}
WHERE ${sql}
GROUP BY TO_CHAR(CPR_DATE, 'YYYY-MM')
ORDER BY receipt_month`,
    binds,
  };
}

export function receiptsBySupplierQuery(filters: Filters, topN = TOP_N): Query {
  const label = labelOrUnassigned("CPR_SUPP_NAME");
  const { sql, binds } = receiptsWhere(filters);
  const grouped = `
            SELECT ${label} AS label, SUM(${SPEND}) AS amount
            FROM ${RECEIPTS_VIEW}
            WHERE ${sql}
            GROUP BY ${label}`;
  return foldTopN(grouped, binds, topN);
}

export function zeroRateQuery(filters: Filters): Query {
  const { sql, binds } = receiptsWhere(filters);
  return {
    sql: `
SELECT CPR_CURR_CODE AS currency, COUNT(*) AS line_count,
    SUM(NVL(CPR_FC_WAC_VALUE, 0)) AS fc_value, SUM(${SPEND}) AS landed_value
FROM ${RECEIPTS_VIEW}
WHERE ${ZERO_RATE} AND ${sql}
GROUP BY CPR_CURR_CODE
ORDER BY line_count DESC, currency`,
    binds,
  };
}

/** Receipts spend for the period. */
export async function receiptsKpis(filters: Filters): Promise<ReceiptsKpis> {
  const [row] = await run(receiptsKpiQuery(filters));
  return {
    spend: num(row?.spend),
    returnsValue: num(row?.returns_value),
    lineCount: num(row?.line_count),
  };
}

/** Every month of the period with its spend and the same month's spend a year earlier. */
export async function receiptsMonthly(filters: Filters): Promise<ReceiptsMonth[]> {
  const [current, previous] = await Promise.all([
    run(receiptsMonthlyQuery(filters)),
    run(receiptsMonthlyQuery(previousYear(filters))),
  ]);
  const byMonth = new Map(current.map((row) => [String(row.receipt_month), num(row.spend)]));
  const lastYear = new Map(previous.map((row) => [shiftMonth(String(row.receipt_month), 1), num(row.spend)]));
  return monthsInRange(filters.start, filters.end).map((month) => ({
    month,
    spend: byMonth.get(month) ?? 0,
    lastYearSpend: lastYear.get(month) ?? 0,
  }));
}

/** Spend of the top suppliers; the last row may be 'All other'. */
export async function receiptsBySupplier(filters: Filters, topN = TOP_N): Promise<LabelValue[]> {
  const rows = await run(receiptsBySupplierQuery(filters, topN));
  return rows.map((row) => ({ label: String(row.label), value: num(row.amount) }));
}

/** Non-AED receipt lines with a zero exchange rate in the period, per currency. */
export async function zeroRateReceipts(filters: Filters): Promise<ZeroRateCurrency[]> {
  const rows = await run(zeroRateQuery(filters));
  return rows.map((row) => ({
    currency: String(row.currency),
    lineCount: num(row.line_count),
    fcValue: num(row.fc_value),
    landedValue: num(row.landed_value),
  }));
}
