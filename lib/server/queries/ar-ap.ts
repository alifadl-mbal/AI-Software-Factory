import "server-only";

import { AGING_BUCKETS, agingCutoffs } from "@/lib/aging";
import { UNASSIGNED_CODE } from "@/lib/filters";

import { run } from "../db";
import {
  companyWhere,
  foldTop,
  labelOrUnassigned,
  num,
  salesWhere,
  UNASSIGNED,
  type LabelledValue,
} from "../sql";
import type { Binds, Query } from "../types";
import type { FilterOption } from "./sales-filters";

/**
 * Receivables and payables queries: open balances as of a date, aged on the document date.
 *
 * Both views hold open *and* settled lines, one row per document line. What was checked on live
 * Orion (2026-10-20) and how each view gives the outstanding balance:
 *
 * AR, `MBALI.ZF_SOA_DETL_CUST_INV_SM_BI`
 * - `SDR_ORG_LC_AMT` is the document's original amount in AED; `SDR_TOT_BAL` is the part of it
 *   still open, also in AED (a USD invoice of 1,405.32 shows ORG_LC 5,171.57 and TOT_BAL 5,171.57).
 *   Summing `SDR_ORG_LC_AMT` would count every settled invoice again, so we aggregate the open
 *   part of the AED amount.
 * - A settled line keeps its row with `SDR_TOT_BAL` at zero, or a few fils of FX rounding
 *   (543 lines under 1 AED, 26 AED between them). A line is **open** when |`SDR_TOT_BAL`| ≥ 1.
 * - Outstanding = `SDR_TOT_BAL − SDR_TOT_PDC` (the view's `SDR_NET_BAL`): post-dated cheques in
 *   hand are not yet cash, but they are no longer something to chase. PDCs are reported on their own.
 * - Customer credits (unapplied receipts, credit notes) are negative open lines and net off.
 *
 * AP, `MBALI.ZF_SOAP_DETL_BI`
 * - `SOAP_TOT_BAL` is the open part of the line, signed debit − credit, and exactly zero once the
 *   line is settled. `SOAP_AMT_CR − SOAP_AMT_DR` is the same figure on untouched lines, but settled
 *   lines still carry stray AMT_CR/AMT_DR (2.95M over all settled lines) and partly paid lines carry
 *   the full amount, so summing it overstates what we owe. We use `−SOAP_TOT_BAL`, i.e. credit −
 *   debit on the open part, positive = we owe. Open = |`SOAP_TOT_BAL`| ≥ 1, as for AR.
 * - PDCs we have issued (`SOAP_TOT_PDC`) are taken off what we owe, mirroring AR.
 * - Prepayments: a vendor whose open lines net below zero has been paid ahead. Vendors are netted
 *   per company and sub-account (payments are often booked in AED against USD invoices, so their
 *   lines only cancel at vendor level). Owed vendors make up AP outstanding and its aging; prepaid
 *   vendors are reported separately and never netted into it.
 * - Amounts are AED, whatever `SOAP_CURR_CODE` says: Orion builds the view from the open-item ledger's
 *   local-currency (`*_LC_*`) columns, as it does the AR view, and the totals tie to the AP control
 *   accounts in the GL (checked live 2026-10-20). About 7% of open lines carry a foreign currency code (USD,
 *   EUR, legacy DEM/ITL and a few odd codes); their amounts are AED too.
 *
 * Aging uses the ladder in `lib/aging.ts` on the document date (`SDR_DOC_DT`, `SOAP_DOC_DT`). The
 * cut-off dates are worked out in TypeScript and bound, so the SQL needs no date arithmetic and runs
 * unchanged on SQLite. The company filter applies; the date filter does not (these are balances).
 *
 * The salesperson filter applies to AR on the customer's own salesperson, `SDR_CUST_SM_CODE` (the
 * code space of `ZF_CSL_BI.CSL_SM_CODE`: the same codes and names on live Orion), through
 * `salesWhere`. AP has no salesperson and ignores it. Without one the SQL is exactly as before.
 *
 * The customer page narrows AR to one `SDR_SUB_ACNT_CODE`, the code space of `ZF_CUSTOMER.CUST_CODE`.
 * Without a customer the SQL is exactly the dashboard's.
 *
 * On live Orion every AR query costs 8-12 s, whatever it groups by (the view rebuilds every balance;
 * see docs/live-check.md), except one narrowed to a customer, which is under 1 s. So the aging hover
 * and the first level of its drill-down read one cached aggregate (`arAgingCube`), started when the
 * page renders, and only a customer's open documents are read on demand.
 */

/**
 * What the AR figures cover: the selected companies, or the companies and the salesperson filter
 * (`SDR_CUST_SM_CODE` codes, `UNASSIGNED_CODE` for none). A plain list is the companies alone, as
 * the Overview, the customer page and AP pass it.
 */
export type ArScope = readonly string[] | { companies: readonly string[]; salespeople?: readonly string[] };

function scopeParts(scope: ArScope): { companies: readonly string[]; salespeople: readonly string[] } {
  return isCompanyList(scope)
    ? { companies: scope, salespeople: [] }
    : { companies: scope.companies, salespeople: scope.salespeople ?? [] };
}

function isCompanyList(scope: ArScope): scope is readonly string[] {
  return Array.isArray(scope);
}

const AR_VIEW = "MBALI.ZF_SOA_DETL_CUST_INV_SM_BI";
const AP_VIEW = "MBALI.ZF_SOAP_DETL_BI";

/** Below this (AED) a line is settled; the rest is FX rounding. */
export const SETTLED_BELOW = 1;

/** Rows in the top customers and top vendors tables. */
export const TOP_N = 20;

/** Open balances of one group (a customer, a salesperson, a vendor). */
export interface Balance {
  key: string;
  label: string;
  /** AR: outstanding net of PDCs. AP: what we owe net of PDCs; negative = prepaid. */
  balance: number;
  /** Part of `balance` on documents more than 90 days old. */
  over90: number;
  /** `balance` split over the aging ladder, in ladder order. */
  buckets: number[];
  /** Ladder index of the oldest document with a positive balance; `null` if none. */
  oldestBucket: number | null;
  /** PDCs held (AR) or issued (AP). */
  pdc: number;
  /** Open document lines. */
  lines: number;
}

export interface ArBalance extends Balance {
  /** Customers with an open line; 1 when grouped by customer. */
  customers: number;
  /** The group's name as Orion has it, without the code; empty if none. */
  name: string;
}

export interface ApBalance extends Balance {
  company: string;
  account: string;
}

/** The binds for the aging cut-offs. */
export function agingBinds(asOf: string): Binds {
  const { under30Days, months, over90Days } = agingCutoffs(asOf);
  return {
    age_30d: under30Days,
    age_2m: months[0],
    age_3m: months[1],
    age_6m: months[2],
    age_12m: months[3],
    age_24m: months[4],
    age_90d: over90Days,
  };
}

/** Ladder index (1-based, as SQL) of a document date. Undated lines fall into the oldest bucket. */
export function bucketCase(dateColumn: string): string {
  return `CASE
            WHEN ${dateColumn} > TO_DATE(:age_30d, 'YYYY-MM-DD') THEN 1
            WHEN ${dateColumn} > TO_DATE(:age_2m, 'YYYY-MM-DD') THEN 2
            WHEN ${dateColumn} > TO_DATE(:age_3m, 'YYYY-MM-DD') THEN 3
            WHEN ${dateColumn} > TO_DATE(:age_6m, 'YYYY-MM-DD') THEN 4
            WHEN ${dateColumn} > TO_DATE(:age_12m, 'YYYY-MM-DD') THEN 5
            WHEN ${dateColumn} > TO_DATE(:age_24m, 'YYYY-MM-DD') THEN 6
            ELSE 7
        END`;
}

/** Sums of the open lines' `balance` per bucket, over 90 days, PDCs and the oldest bucket. */
const AGED_MEASURES = `
    SUM(balance) AS balance,
    SUM(CASE WHEN over_90 = 1 THEN balance ELSE 0 END) AS over_90,
    SUM(pdc) AS pdc,
    COUNT(*) AS line_count,
    MAX(CASE WHEN balance > 0 THEN bucket END) AS oldest_bucket,
${AGING_BUCKETS.map((_, index) => `    SUM(CASE WHEN bucket = ${index + 1} THEN balance ELSE 0 END) AS b${index + 1}`).join(",\n")}`;

/**
 * Open lines of one view, each with its signed balance, PDC, bucket and over-90 flag. Grouping
 * happens outside: Oracle rejects a GROUP BY on an expression with a bind in it (ORA-00979).
 */
function openLines(
  view: string,
  { balanceColumn, pdcColumn, dateColumn, companyColumn, salespersonColumn, balanceSign, columns }: LineSpec,
  asOf: string,
  scope: ArScope,
  /** Narrow to one sub-account, bound as `cust_code`. */
  subAccount?: { column: string; code: string },
): { sql: string; binds: Binds } {
  const { companies, salespeople } = scopeParts(scope);
  const company = companyWhere(companies, companyColumn);
  const salesperson = salespersonColumn
    ? salesWhere({ salespeople: [...salespeople] }, { salesperson: salespersonColumn })
    : undefined;
  const sign = balanceSign === -1 ? "-" : "";
  const account = subAccount ? `\n      AND ${subAccount.column} = :cust_code` : "";
  return {
    sql: `
    SELECT ${columns.join(", ")},
        ${sign}NVL(${balanceColumn}, 0) - NVL(${pdcColumn}, 0) AS balance,
        NVL(${pdcColumn}, 0) AS pdc,
        ${bucketCase(dateColumn)} AS bucket,
        CASE WHEN ${dateColumn} < TO_DATE(:age_90d, 'YYYY-MM-DD') THEN 1 ELSE 0 END AS over_90
    FROM ${view}
    WHERE ABS(NVL(${balanceColumn}, 0)) >= ${SETTLED_BELOW}${company ? `\n      AND ${company.sql}` : ""}${
      salesperson ? `\n      AND ${salesperson.sql}` : ""
    }${account}`,
    binds: {
      ...agingBinds(asOf),
      ...company?.binds,
      ...salesperson?.binds,
      ...(subAccount && { cust_code: subAccount.code }),
    },
  };
}

interface LineSpec {
  balanceColumn: string;
  pdcColumn: string;
  dateColumn: string;
  companyColumn: string;
  /** The salesperson filter's column; without one the filter doesn't apply (AP). */
  salespersonColumn?: string;
  /** -1 flips the stored sign so the figure reads the way the dashboard shows it. */
  balanceSign: 1 | -1;
  /** Extra columns the outer query groups by, as `expression AS alias`. */
  columns: string[];
}

/** The customer on an AR line: the AR sub-account, the same code as `ZF_CUSTOMER.CUST_CODE`. */
const AR_CUSTOMER_COLUMN = "SDR_SUB_ACNT_CODE";

const AR_LINES: Omit<LineSpec, "columns"> = {
  balanceColumn: "SDR_TOT_BAL",
  pdcColumn: "SDR_TOT_PDC",
  dateColumn: "SDR_DOC_DT",
  companyColumn: "SDR_COMP_CODE",
  salespersonColumn: "SDR_CUST_SM_CODE",
  balanceSign: 1,
};

/** AR groupings: the customer, or one of the two salesperson columns. Never `SDR_INV_SM_CODE`. */
export const AR_GROUPS = {
  customer: { code: "SDR_SUB_ACNT_CODE", name: "SDR_CUST_NAME", showCode: false },
  /** The customer's own salesperson (`cust_sm_code`): sales-attributed AR. */
  salesperson: { code: "SDR_CUST_SM_CODE", name: "SDR_CUST_SM_NAME", showCode: true },
  /** The finance-side salesperson (`sm_code`): who chases the collection. */
  collector: { code: "SDR_FIN_SM_CODE", name: "SDR_FIN_SM_NAME", showCode: true },
} as const;

export type ArGroup = keyof typeof AR_GROUPS;

/** With `customer`, only that customer's open lines (`SDR_SUB_ACNT_CODE`). */
export function arBalancesQuery(asOf: string, scope: ArScope, group: ArGroup, customer?: string): Query {
  const { code, name } = AR_GROUPS[group];
  const lines = openLines(
    AR_VIEW,
    {
      ...AR_LINES,
      columns: [
        `${labelOrUnassigned(code)} AS group_key`,
        `TRIM(${name}) AS group_name`,
        `${labelOrUnassigned("SDR_SUB_ACNT_CODE")} AS customer`,
      ],
    },
    asOf,
    scope,
    customer === undefined ? undefined : { column: AR_CUSTOMER_COLUMN, code: customer },
  );
  return {
    sql: `
SELECT group_key, MAX(group_name) AS group_name, COUNT(DISTINCT customer) AS customer_count,${AGED_MEASURES}
FROM (${lines.sql}
) open_lines
GROUP BY group_key
ORDER BY balance DESC, group_key`,
    binds: lines.binds,
  };
}

const AP_LINES: Omit<LineSpec, "columns"> = {
  balanceColumn: "SOAP_TOT_BAL",
  pdcColumn: "SOAP_TOT_PDC",
  dateColumn: "SOAP_DOC_DT",
  companyColumn: "SOAP_COMP_CODE",
  balanceSign: -1,
};

export function apBalancesQuery(asOf: string, companies: readonly string[]): Query {
  const lines = openLines(
    AP_VIEW,
    {
      ...AP_LINES,
      columns: [
        `${labelOrUnassigned("SOAP_COMP_CODE")} AS company_code`,
        `${labelOrUnassigned("SOAP_SUB_ACNT_CODE")} AS vendor_code`,
        "TRIM(SOAP_SUB_ACNT_NAME) AS vendor_name",
        "TRIM(SOAP_COMP_NAME) AS company_name",
        "TRIM(SOAP_MAIN_ACNT_NAME) AS account_name",
      ],
    },
    asOf,
    companies,
  );
  return {
    sql: `
SELECT company_code, vendor_code, MAX(vendor_name) AS vendor_name, MAX(company_name) AS company_name,
    MAX(account_name) AS account_name,${AGED_MEASURES}
FROM (${lines.sql}
) open_lines
GROUP BY company_code, vendor_code
ORDER BY balance DESC, company_code, vendor_code`,
    binds: lines.binds,
  };
}

function text(value: unknown): string {
  return value === null || value === undefined ? "" : String(value);
}

function toBalance(row: Record<string, unknown>, key: string, label: string): Balance {
  return {
    key,
    label,
    balance: num(row.balance),
    over90: num(row.over_90),
    buckets: AGING_BUCKETS.map((_, index) => num(row[`b${index + 1}`])),
    oldestBucket:
      row.oldest_bucket === null || row.oldest_bucket === undefined ? null : num(row.oldest_bucket) - 1,
    pdc: num(row.pdc),
    lines: num(row.line_count),
  };
}

/**
 * Open AR as of `asOf`, one row per customer or salesperson, largest balance first. With
 * `customer`, only that customer's lines: one row when grouped by customer, or none.
 */
export async function arBalances(
  asOf: string,
  scope: ArScope,
  group: ArGroup,
  customer?: string,
): Promise<ArBalance[]> {
  const rows = await run(arBalancesQuery(asOf, scope, group, customer));
  return rows.map((row) => {
    const key = text(row.group_key);
    const name = text(row.group_name);
    const label =
      key === UNASSIGNED
        ? UNASSIGNED
        : AR_GROUPS[group].showCode
          ? name && name !== key
            ? `${name} (${key})`
            : key
          : name || key;
    return { ...toBalance(row, key, label), customers: num(row.customer_count), name };
  });
}

/** Open AP as of `asOf`, one row per vendor (company + sub-account), largest balance first. */
export async function apBalances(asOf: string, companies: readonly string[]): Promise<ApBalance[]> {
  const rows = await run(apBalancesQuery(asOf, companies));
  return rows.map((row) => {
    const company = text(row.company_code);
    const code = text(row.vendor_code);
    return {
      ...toBalance(row, `${company}|${code}`, text(row.vendor_name) || code),
      company: text(row.company_name) || company,
      account: text(row.account_name) || UNASSIGNED,
    };
  });
}

/** Totals across groups: the ladder, over 90 days and PDCs. */
export interface BalanceSummary {
  balance: number;
  over90: number;
  /** `over90 / balance`; `null` with no balance. */
  over90Pct: number | null;
  buckets: number[];
  pdc: number;
}

export function summarize(rows: readonly Balance[]): BalanceSummary {
  const buckets = AGING_BUCKETS.map((_, index) => rows.reduce((sum, row) => sum + row.buckets[index], 0));
  const balance = rows.reduce((sum, row) => sum + row.balance, 0);
  const over90 = rows.reduce((sum, row) => sum + row.over90, 0);
  return {
    balance,
    over90,
    over90Pct: balance ? over90 / balance : null,
    buckets,
    pdc: rows.reduce((sum, row) => sum + row.pdc, 0),
  };
}

/** AR summed over customers. */
export async function arSummary(asOf: string, scope: ArScope): Promise<BalanceSummary> {
  return summarize(await arBalances(asOf, scope, "customer"));
}

export interface ApSplit {
  /** Vendors we owe (net balance above zero): AP outstanding and its aging. */
  owed: ApBalance[];
  /** Vendors paid ahead (net balance below zero), most prepaid first. Balances are negative. */
  prepaid: ApBalance[];
  /** Summary of the owed vendors only. */
  summary: BalanceSummary;
  /** Total prepaid, as a positive amount. */
  prepayments: number;
}

/** AP split into what we owe and what we have prepaid. The two are never netted. */
export async function apSplit(asOf: string, companies: readonly string[]): Promise<ApSplit> {
  const vendors = await apBalances(asOf, companies);
  const owed = vendors.filter((vendor) => vendor.balance > 0);
  const prepaid = vendors.filter((vendor) => vendor.balance < 0).sort((a, b) => a.balance - b.balance);
  return {
    owed,
    prepaid,
    summary: summarize(owed),
    prepayments: prepaid.reduce((sum, vendor) => sum - vendor.balance, 0),
  };
}

// ---------------------------------------------------------------------------------------------
// One customer's open documents, for the customer page

/** The open-documents table shows at most this many (the largest balances). */
export const DOCUMENT_ROW_LIMIT = 200;

export interface ArDocument {
  companyCode: string;
  /** `FIN_TRAN_CODE-DOC_NO`. */
  document: string;
  /** YYYY-MM-DD; `null` if undated. */
  date: string | null;
  currency: string;
  /** The document's original amount in AED. */
  amount: number;
  /** Outstanding net of PDCs, as in `Balance.balance`. */
  balance: number;
  pdc: number;
  /** Ladder index. */
  bucket: number;
}

/** One customer's open AR lines, largest balance first, at most `limit`. */
export function arDocumentsQuery(
  asOf: string,
  scope: ArScope,
  customer: string,
  limit = DOCUMENT_ROW_LIMIT,
  /** Only the documents of this ladder index, for the aging drill-down. */
  bucket?: number,
): Query {
  const lines = openLines(
    AR_VIEW,
    {
      ...AR_LINES,
      columns: [
        "SDR_COMP_CODE AS company_code",
        "SDR_FIN_TRAN_CODE AS txn_code",
        "SDR_DOC_NO AS doc_no",
        "TO_CHAR(SDR_DOC_DT, 'YYYY-MM-DD') AS doc_date",
        `${labelOrUnassigned("SDR_CURR_CODE")} AS currency`,
        "NVL(SDR_ORG_LC_AMT, 0) AS amount",
      ],
    },
    asOf,
    scope,
    { column: AR_CUSTOMER_COLUMN, code: customer },
  );
  return rankedDocuments(lines, limit, bucket);
}

const DOCUMENT_COLUMNS = "company_code, txn_code, doc_no, doc_date, currency, amount, balance, pdc, bucket";

/** Open lines, largest balance first, at most `limit`; with `bucket`, only that ladder index. */
function rankedDocuments(lines: { sql: string; binds: Binds }, limit: number, bucket?: number): Query {
  return {
    sql: `
SELECT ${DOCUMENT_COLUMNS}
FROM (
    SELECT ${DOCUMENT_COLUMNS},
        ROW_NUMBER() OVER (ORDER BY balance DESC, doc_date, company_code, txn_code, doc_no) AS rn
    FROM (${lines.sql}
    ) open_lines${bucket === undefined ? "" : "\n    WHERE bucket = :bucket_no"}
) ranked
WHERE rn <= :row_limit
ORDER BY rn`,
    binds: { ...lines.binds, row_limit: limit, ...(bucket !== undefined && { bucket_no: bucket + 1 }) },
  };
}

/** One customer's open AR documents as of `asOf`, largest balance first. */
export async function arDocuments(
  asOf: string,
  scope: ArScope,
  customer: string,
  limit = DOCUMENT_ROW_LIMIT,
  bucket?: number,
): Promise<ArDocument[]> {
  return toDocuments(await run(arDocumentsQuery(asOf, scope, customer, limit, bucket)));
}

function toDocuments(rows: Record<string, unknown>[]): ArDocument[] {
  return rows.map((row) => ({
    companyCode: text(row.company_code),
    document: `${text(row.txn_code)}-${text(row.doc_no)}`,
    date: row.doc_date ? text(row.doc_date) : null,
    currency: text(row.currency),
    amount: num(row.amount),
    balance: num(row.balance),
    pdc: num(row.pdc),
    bucket: num(row.bucket) - 1,
  }));
}

export interface ArProfile {
  /** The customer's own salesperson on their open lines (`SDR_CUST_SM_NAME`); `null` if none. */
  salesperson: string | null;
  /** `SDR_CREDIT_LIMIT`; `null` when Orion has none. 0 is common and means no limit was set. */
  creditLimit: number | null;
}

/**
 * The salesperson and credit limit Orion keeps on the customer's AR lines (`ZF_CUSTOMER` has
 * neither). On live Orion both are the same on every open line of a customer, bar 5 customers.
 */
export function arProfileQuery(asOf: string, scope: ArScope, customer: string): Query {
  const lines = openLines(
    AR_VIEW,
    {
      ...AR_LINES,
      columns: ["TRIM(SDR_CUST_SM_NAME) AS salesperson", "SDR_CREDIT_LIMIT AS credit_limit"],
    },
    asOf,
    scope,
    { column: AR_CUSTOMER_COLUMN, code: customer },
  );
  return {
    sql: `
SELECT MAX(salesperson) AS salesperson, MAX(credit_limit) AS credit_limit
FROM (${lines.sql}
) open_lines`,
    binds: lines.binds,
  };
}

/** Salesperson and credit limit from the customer's open AR lines; nulls without any. */
export async function arProfile(asOf: string, scope: ArScope, customer: string): Promise<ArProfile> {
  const [row] = await run(arProfileQuery(asOf, scope, customer));
  return {
    salesperson: text(row?.salesperson) || null,
    creditLimit: row?.credit_limit === null || row?.credit_limit === undefined ? null : num(row.credit_limit),
  };
}

// ---------------------------------------------------------------------------------------------
// Aging hover card and drill-down

/** Slices per section on the hover card; the rest fold into 'All other'. */
export const HOVER_TOP_N = 5;

/**
 * Open AR summed per company × customer's salesperson × customer × bucket. It is one AR query like
 * the page's others (8-12 s live), so it is started as the page renders and cached; every bucket's
 * hover and customer list come from it. With `customer`, that customer only (under 1 s live).
 */
export function arAgingCubeQuery(asOf: string, scope: ArScope, customer?: string): Query {
  const lines = openLines(
    AR_VIEW,
    {
      ...AR_LINES,
      columns: [
        `${labelOrUnassigned("SDR_COMP_CODE")} AS company_code`,
        "TRIM(SDR_COMP_NAME) AS company_name",
        `${labelOrUnassigned(AR_GROUPS.salesperson.code)} AS salesperson_code`,
        `TRIM(${AR_GROUPS.salesperson.name}) AS salesperson_name`,
        `${labelOrUnassigned(AR_CUSTOMER_COLUMN)} AS customer`,
        "TRIM(SDR_CUST_NAME) AS customer_name",
      ],
    },
    asOf,
    scope,
    customer === undefined ? undefined : { column: AR_CUSTOMER_COLUMN, code: customer },
  );
  return {
    sql: `
SELECT company_code, MAX(company_name) AS company_name, salesperson_code,
    MAX(salesperson_name) AS salesperson_name, customer, MAX(customer_name) AS customer_name, bucket,
    SUM(balance) AS balance, SUM(pdc) AS pdc, COUNT(*) AS line_count
FROM (${lines.sql}
) open_lines
GROUP BY company_code, salesperson_code, customer, bucket`,
    binds: lines.binds,
  };
}

export interface ArCubeCell {
  companyCode: string;
  company: string;
  salespersonCode: string;
  /** As `arBalances` labels a salesperson: "Name (code)", or Unassigned. */
  salesperson: string;
  customerCode: string;
  customer: string;
  /** Ladder index. */
  bucket: number;
  balance: number;
  pdc: number;
  lines: number;
}

/** The cached aggregate behind the aging hover and drill-down (see `arAgingCubeQuery`). */
export async function arAgingCube(asOf: string, scope: ArScope, customer?: string): Promise<ArCubeCell[]> {
  const rows = await run(arAgingCubeQuery(asOf, scope, customer));
  return rows.map((row) => {
    const salespersonCode = text(row.salesperson_code);
    const salespersonName = text(row.salesperson_name);
    const customerCode = text(row.customer);
    return {
      companyCode: text(row.company_code),
      company: text(row.company_name) || text(row.company_code),
      salespersonCode,
      salesperson:
        salespersonCode === UNASSIGNED
          ? UNASSIGNED
          : salespersonName && salespersonName !== salespersonCode
            ? `${salespersonName} (${salespersonCode})`
            : salespersonCode,
      customerCode,
      customer: text(row.customer_name) || customerCode,
      bucket: num(row.bucket) - 1,
      balance: num(row.balance),
      pdc: num(row.pdc),
      lines: num(row.line_count),
    };
  });
}

/** One aging column's hover card: its total and what it is made of. */
export interface AgingHover {
  side: "ar" | "ap";
  bucket: number;
  total: number;
  sections: { id: string; title: string; rows: LabelledValue[] }[];
}

/** AR in one bucket by company and by the customer's salesperson, from the cached aggregate. */
export async function arAgingHover(
  asOf: string,
  scope: ArScope,
  bucket: number,
  customer?: string,
): Promise<AgingHover> {
  const cells = (await arAgingCube(asOf, scope, customer)).filter((cell) => cell.bucket === bucket);
  return {
    side: "ar",
    bucket,
    total: cells.reduce((sum, cell) => sum + cell.balance, 0),
    sections: [
      {
        id: "company",
        title: "By company",
        rows: foldTop(
          cells.map((cell) => ({ label: cell.company, value: cell.balance })),
          HOVER_TOP_N,
        ),
      },
      {
        id: "salesperson",
        title: "By salesperson",
        rows: foldTop(
          cells.map((cell) => ({ label: cell.salesperson, value: cell.balance })),
          HOVER_TOP_N,
        ),
      },
    ],
  };
}

/** One row of a bucket's drill-down: a customer (AR) or a vendor (AP) and its balance there. */
export interface BucketAccount {
  /** The customer code (AR), or `company|sub-account` (AP), as the next level takes it. */
  key: string;
  label: string;
  /** AR: the customer's salesperson (the largest share if several). AP: the company. */
  detail: string;
  balance: number;
  pdc: number;
  lines: number;
}

export interface BucketAccounts {
  side: "ar" | "ap";
  bucket: number;
  /** The column: every account's balance in the bucket. */
  total: number;
  rows: BucketAccount[];
}

/** The customers with open AR in one bucket, largest first, from the cached aggregate. */
export async function arBucketCustomers(
  asOf: string,
  scope: ArScope,
  bucket: number,
): Promise<BucketAccounts> {
  const cells = (await arAgingCube(asOf, scope)).filter((cell) => cell.bucket === bucket);
  const byCustomer = new Map<string, BucketAccount & { salespeople: Map<string, number> }>();
  for (const cell of cells) {
    const row = byCustomer.get(cell.customerCode) ?? {
      key: cell.customerCode,
      label: cell.customer,
      detail: "",
      balance: 0,
      pdc: 0,
      lines: 0,
      salespeople: new Map<string, number>(),
    };
    row.balance += cell.balance;
    row.pdc += cell.pdc;
    row.lines += cell.lines;
    row.salespeople.set(cell.salesperson, (row.salespeople.get(cell.salesperson) ?? 0) + cell.balance);
    byCustomer.set(cell.customerCode, row);
  }
  const rows = [...byCustomer.values()].map(({ salespeople, ...row }) => ({
    ...row,
    detail: [...salespeople.entries()].sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]))[0]?.[0] ?? UNASSIGNED,
  }));
  rows.sort((a, b) => b.balance - a.balance || a.label.localeCompare(b.label));
  return { side: "ar", bucket, total: rows.reduce((sum, row) => sum + row.balance, 0), rows };
}

/** AP in one bucket by company and by the top vendors, from `apSplit` (owed vendors only). */
export async function apAgingHover(
  asOf: string,
  companies: readonly string[],
  bucket: number,
): Promise<AgingHover> {
  const { owed, summary } = await apSplit(asOf, companies);
  return {
    side: "ap",
    bucket,
    total: summary.buckets[bucket],
    sections: [
      {
        id: "company",
        title: "By company",
        rows: foldTop(
          owed.map((vendor) => ({ label: vendor.company, value: vendor.buckets[bucket] })),
          HOVER_TOP_N,
        ),
      },
      {
        id: "supplier",
        title: "Top suppliers",
        rows: foldTop(
          owed.map((vendor) => ({ label: vendor.label, value: vendor.buckets[bucket] })),
          HOVER_TOP_N,
        ),
      },
    ],
  };
}

/** The vendors we owe with a balance in one bucket, largest first (prepaid vendors are left out, as in AP). */
export async function apBucketVendors(
  asOf: string,
  companies: readonly string[],
  bucket: number,
): Promise<BucketAccounts> {
  const { owed, summary } = await apSplit(asOf, companies);
  const rows = owed
    .filter((vendor) => vendor.buckets[bucket] !== 0)
    .map((vendor) => ({
      key: vendor.key,
      label: vendor.label,
      detail: vendor.company,
      balance: vendor.buckets[bucket],
      pdc: 0,
      lines: 0,
    }))
    .sort((a, b) => b.balance - a.balance || a.label.localeCompare(b.label));
  return { side: "ap", bucket, total: summary.buckets[bucket], rows };
}

/** One vendor's open AP lines (company + sub-account), largest owed first; with `bucket`, that index only. */
export function apDocumentsQuery(
  asOf: string,
  company: string,
  vendor: string,
  bucket?: number,
  limit = DOCUMENT_ROW_LIMIT,
): Query {
  const lines = openLines(
    AP_VIEW,
    {
      ...AP_LINES,
      columns: [
        "SOAP_COMP_CODE AS company_code",
        "SOAP_TRAN_CODE AS txn_code",
        "SOAP_DOC_NO AS doc_no",
        "TO_CHAR(SOAP_DOC_DT, 'YYYY-MM-DD') AS doc_date",
        `${labelOrUnassigned("SOAP_CURR_CODE")} AS currency`,
        "NVL(SOAP_AMT, 0) AS amount",
      ],
    },
    asOf,
    [company],
    { column: "SOAP_SUB_ACNT_CODE", code: vendor },
  );
  return rankedDocuments(lines, limit, bucket);
}

/** One vendor's open AP documents as of `asOf`; `key` is `company|sub-account`, as in `ApBalance`. */
export async function apDocuments(asOf: string, key: string, bucket?: number): Promise<ArDocument[]> {
  const [company, vendor] = key.split("|");
  return toDocuments(await run(apDocumentsQuery(asOf, company, vendor ?? "", bucket)));
}

// ---------------------------------------------------------------------------------------------
// Salesperson filter choices

/**
 * The salesperson filter's choices on the Receivables & payables page: the customers' own
 * salespeople with open AR in the selected companies, unsorted. It is the page's own "AR by
 * salesperson" query (the salesperson filter left out), so it is cached with the page.
 */
export async function arSalespersonOptions(
  asOf: string,
  companies: readonly string[],
): Promise<FilterOption[]> {
  const rows = await arBalances(asOf, companies, "salesperson");
  return rows.map((row) =>
    row.key === UNASSIGNED
      ? { code: UNASSIGNED_CODE, name: UNASSIGNED }
      : { code: row.key, name: row.name || row.key },
  );
}
