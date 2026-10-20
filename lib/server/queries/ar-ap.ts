import "server-only";

import { AGING_BUCKETS, agingCutoffs } from "@/lib/aging";

import { run } from "../db";
import { companyWhere, labelOrUnassigned, num, UNASSIGNED } from "../sql";
import type { Binds, Query } from "../types";

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
 * The customer page narrows AR to one `SDR_SUB_ACNT_CODE`, the code space of `ZF_CUSTOMER.CUST_CODE`.
 * Without a customer the SQL is exactly the dashboard's.
 */

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
  { balanceColumn, pdcColumn, dateColumn, companyColumn, balanceSign, columns }: LineSpec,
  asOf: string,
  companies: readonly string[],
  /** Narrow to one sub-account, bound as `cust_code`. */
  subAccount?: { column: string; code: string },
): { sql: string; binds: Binds } {
  const company = companyWhere(companies, companyColumn);
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
    WHERE ABS(NVL(${balanceColumn}, 0)) >= ${SETTLED_BELOW}${company ? `\n      AND ${company.sql}` : ""}${account}`,
    binds: { ...agingBinds(asOf), ...company?.binds, ...(subAccount && { cust_code: subAccount.code }) },
  };
}

interface LineSpec {
  balanceColumn: string;
  pdcColumn: string;
  dateColumn: string;
  companyColumn: string;
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
export function arBalancesQuery(
  asOf: string,
  companies: readonly string[],
  group: ArGroup,
  customer?: string,
): Query {
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
    companies,
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

export function apBalancesQuery(asOf: string, companies: readonly string[]): Query {
  const lines = openLines(
    AP_VIEW,
    {
      balanceColumn: "SOAP_TOT_BAL",
      pdcColumn: "SOAP_TOT_PDC",
      dateColumn: "SOAP_DOC_DT",
      companyColumn: "SOAP_COMP_CODE",
      balanceSign: -1,
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
  companies: readonly string[],
  group: ArGroup,
  customer?: string,
): Promise<ArBalance[]> {
  const rows = await run(arBalancesQuery(asOf, companies, group, customer));
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
    return { ...toBalance(row, key, label), customers: num(row.customer_count) };
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
export async function arSummary(asOf: string, companies: readonly string[]): Promise<BalanceSummary> {
  return summarize(await arBalances(asOf, companies, "customer"));
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
  companies: readonly string[],
  customer: string,
  limit = DOCUMENT_ROW_LIMIT,
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
    companies,
    { column: AR_CUSTOMER_COLUMN, code: customer },
  );
  const columns = "company_code, txn_code, doc_no, doc_date, currency, amount, balance, pdc, bucket";
  return {
    sql: `
SELECT ${columns}
FROM (
    SELECT ${columns},
        ROW_NUMBER() OVER (ORDER BY balance DESC, doc_date, company_code, txn_code, doc_no) AS rn
    FROM (${lines.sql}
    ) open_lines
) ranked
WHERE rn <= :row_limit
ORDER BY rn`,
    binds: { ...lines.binds, row_limit: limit },
  };
}

/** One customer's open AR documents as of `asOf`, largest balance first. */
export async function arDocuments(
  asOf: string,
  companies: readonly string[],
  customer: string,
  limit = DOCUMENT_ROW_LIMIT,
): Promise<ArDocument[]> {
  const rows = await run(arDocumentsQuery(asOf, companies, customer, limit));
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
export function arProfileQuery(asOf: string, companies: readonly string[], customer: string): Query {
  const lines = openLines(
    AR_VIEW,
    {
      ...AR_LINES,
      columns: ["TRIM(SDR_CUST_SM_NAME) AS salesperson", "SDR_CREDIT_LIMIT AS credit_limit"],
    },
    asOf,
    companies,
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
export async function arProfile(
  asOf: string,
  companies: readonly string[],
  customer: string,
): Promise<ArProfile> {
  const [row] = await run(arProfileQuery(asOf, companies, customer));
  return {
    salesperson: text(row?.salesperson) || null,
    creditLimit: row?.credit_limit === null || row?.credit_limit === undefined ? null : num(row.credit_limit),
  };
}
