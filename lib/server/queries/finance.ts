import "server-only";

import { monthsInRange, previousYear, shiftMonth, type Filters } from "@/lib/filters";

import {
  chartOfAccounts,
  classify,
  COST_OF_SALES,
  EXPENSE_LEVELS,
  GENERAL_AND_ADMIN,
  PNL_LEVELS,
  PROFIT_AND_LOSS,
  REVENUE,
  UNMAPPED,
  type AccountMapping,
} from "../chart-of-accounts";
import { run } from "../db";
import { companies as companyMaster } from "./common";
import { ALL_OTHER, filterWhere, num } from "../sql";
import type { Query, Row } from "../types";

/**
 * Finance dashboard queries on `MBALI.ZF_F_T_DETAIL_BI`, one row per GL line.
 *
 * Business rules (see the mbal-db skill, `references/business-rules.md`):
 * - Posted lines only: `SUBSTR(TD_STATUS, 3, 1) = 'C'` (`PYC`, `CYC`). `CYU` is unposted. There is
 *   no `'P'` status.
 * - Net amount = `NVL(D_CREDIT_LC, 0) - NVL(D_DEBIT_LC, 0)`, already AED. Each line fills only one
 *   of the two columns, so both sides need the NVL or one-sided accounts sum to NULL.
 * - Sign: revenue sums positive and costs negative, and every figure here keeps that convention
 *   (net profit = revenue + cost of sales + G&A). Only the screen flips costs to positive.
 * - The period filters on `D_DT` (posting date); the company filter on `D_COMP_CODE`.
 * - P&L grouping comes from `data/chart-of-accounts.csv`, attached after aggregation (see
 *   `chart-of-accounts.ts`). Accounts missing from it are 'Unmapped', never dropped, and are kept
 *   out of profit.
 */

const VIEW = "MBALI.ZF_F_T_DETAIL_BI";
const DATE_COLUMN = "D_DT";
const COMPANY_COLUMN = "D_COMP_CODE";
const POSTED = "SUBSTR(TD_STATUS, 3, 1) = 'C'";
const DEBIT = "NVL(D_DEBIT_LC, 0)";
const CREDIT = "NVL(D_CREDIT_LC, 0)";
const NET_AMOUNT = `${CREDIT} - ${DEBIT}`;

/** The drill-down shows at most this many journal lines. */
export const JOURNAL_LINE_LIMIT = 500;

/** One GL main account's posted totals for a period, with its chart-of-accounts levels. */
export interface AccountBalance extends AccountMapping {
  debit: number;
  credit: number;
  /** Credit − debit: positive for revenue, negative for costs. */
  net: number;
}

/** P&L figures in signed terms: revenue positive, costs negative. */
export interface PnlSummary {
  revenue: number;
  costOfSales: number;
  grossProfit: number;
  /** Fraction of revenue; `null` with no revenue. */
  grossMarginPct: number | null;
  generalAndAdmin: number;
  netProfit: number;
  netMarginPct: number | null;
  /** Net amount on accounts missing from the chart of accounts; not part of profit. */
  unmapped: number;
  unmappedAccounts: number;
}

export interface PnlMonth extends PnlSummary {
  /** `YYYY-MM`. */
  month: string;
}

export interface StatementAccount {
  mainAcnt: string;
  name: string;
  /** Signed net amount this period and in the same period last year. */
  current: number;
  previous: number;
}

export interface StatementGroup {
  /** A P&L level_1, or 'Unmapped'. */
  level1: string;
  current: number;
  previous: number;
  accounts: StatementAccount[];
}

export interface JournalLine {
  date: string;
  company: string;
  tranCode: string;
  docNo: string;
  docRef: string;
  detail: string;
  debit: number;
  credit: number;
}

export interface JournalLines {
  lines: JournalLine[];
  /** Every posted line on the account in the period; `lines` stops at the limit. */
  total: number;
  totalDebit: number;
  totalCredit: number;
  limit: number;
}

function where(filters: Pick<Filters, "start" | "end" | "companies">): ReturnType<typeof filterWhere> {
  const fragment = filterWhere(filters, DATE_COLUMN, COMPANY_COLUMN);
  return { sql: `${POSTED} AND ${fragment.sql}`, binds: fragment.binds };
}

function text(value: unknown): string {
  return value === null || value === undefined ? "" : String(value).trim();
}

/** Posted debit, credit and net amount per GL main account. */
export function accountTotalsQuery(filters: Filters): Query {
  const { sql, binds } = where(filters);
  return {
    sql: `
SELECT D_MAIN_ACNT AS main_acnt, MAX(D_MAIN_ACNT_NAME) AS main_acnt_name,
    SUM(${DEBIT}) AS debit, SUM(${CREDIT}) AS credit, SUM(${NET_AMOUNT}) AS net_amount
FROM ${VIEW}
WHERE ${sql}
GROUP BY D_MAIN_ACNT
ORDER BY D_MAIN_ACNT`,
    binds,
  };
}

/** Posted net amount per month and GL main account. */
export function monthlyAccountQuery(filters: Filters): Query {
  const { sql, binds } = where(filters);
  return {
    sql: `
SELECT TO_CHAR(${DATE_COLUMN}, 'YYYY-MM') AS gl_month, D_MAIN_ACNT AS main_acnt,
    SUM(${NET_AMOUNT}) AS net_amount
FROM ${VIEW}
WHERE ${sql}
GROUP BY TO_CHAR(${DATE_COLUMN}, 'YYYY-MM'), D_MAIN_ACNT
ORDER BY gl_month, main_acnt`,
    binds,
  };
}

/** Posted net amount per company and GL main account. */
export function companyAccountQuery(filters: Filters): Query {
  const { sql, binds } = where(filters);
  return {
    sql: `
SELECT ${COMPANY_COLUMN} AS comp_code, D_MAIN_ACNT AS main_acnt, SUM(${NET_AMOUNT}) AS net_amount
FROM ${VIEW}
WHERE ${sql}
GROUP BY ${COMPANY_COLUMN}, D_MAIN_ACNT
ORDER BY comp_code, main_acnt`,
    binds,
  };
}

/** The newest posted lines on one account, at most `limit`, with the count and totals of all. */
export function journalLinesQuery(filters: Filters, mainAcnt: string, limit = JOURNAL_LINE_LIMIT): Query {
  const { sql, binds } = where(filters);
  return {
    sql: `
SELECT line_date, comp_code, tran_code, doc_no, doc_ref, detail, debit, credit,
    total_lines, total_debit, total_credit
FROM (
    SELECT TO_CHAR(${DATE_COLUMN}, 'YYYY-MM-DD') AS line_date, D_COMP_CODE AS comp_code,
        D_TRAN_CODE AS tran_code, D_DOC_NO AS doc_no, D_DOC_REF AS doc_ref, D_DETAIL AS detail,
        ${DEBIT} AS debit, ${CREDIT} AS credit,
        COUNT(*) OVER () AS total_lines,
        SUM(${DEBIT}) OVER () AS total_debit,
        SUM(${CREDIT}) OVER () AS total_credit,
        ROW_NUMBER() OVER (
            ORDER BY ${DATE_COLUMN} DESC, D_COMP_CODE, D_TRAN_CODE, D_DOC_NO, ${DEBIT} DESC, ${CREDIT} DESC
        ) AS rn
    FROM ${VIEW}
    WHERE ${sql} AND D_MAIN_ACNT = :main_acnt
) numbered
WHERE rn <= :line_limit
ORDER BY rn`,
    binds: { ...binds, main_acnt: mainAcnt, line_limit: limit },
  };
}

function toBalance(accounts: Map<string, AccountMapping>, row: Row): AccountBalance {
  return {
    ...classify(accounts, text(row.main_acnt), text(row.main_acnt_name)),
    debit: num(row.debit),
    credit: num(row.credit),
    net: num(row.net_amount),
  };
}

/** Is this an income-statement account (as opposed to balance sheet or unmapped)? */
function isPnl(mapping: Pick<AccountMapping, "level0" | "level1">): boolean {
  return mapping.level0 === PROFIT_AND_LOSS && (PNL_LEVELS as readonly string[]).includes(mapping.level1);
}

/** Roll account balances up into the P&L. Unmapped accounts are counted but kept out of profit. */
export function summarise(balances: Pick<AccountBalance, "level0" | "level1" | "net">[]): PnlSummary {
  const sum = (level: string) =>
    balances
      .filter((balance) => balance.level0 === PROFIT_AND_LOSS && balance.level1 === level)
      .reduce((total, balance) => total + balance.net, 0);
  const unmapped = balances.filter((balance) => balance.level1 === UNMAPPED);
  const revenue = sum(REVENUE);
  const costOfSales = sum(COST_OF_SALES);
  const generalAndAdmin = sum(GENERAL_AND_ADMIN);
  const grossProfit = revenue + costOfSales;
  const netProfit = grossProfit + generalAndAdmin;
  return {
    revenue,
    costOfSales,
    grossProfit,
    grossMarginPct: revenue ? grossProfit / revenue : null,
    generalAndAdmin,
    netProfit,
    netMarginPct: revenue ? netProfit / revenue : null,
    unmapped: unmapped.reduce((total, balance) => total + balance.net, 0),
    unmappedAccounts: unmapped.length,
  };
}

/** Posted totals per GL main account for the period, classified by the chart of accounts. */
export async function accountBalances(filters: Filters): Promise<AccountBalance[]> {
  const rows = await run(accountTotalsQuery(filters));
  const accounts = chartOfAccounts();
  return rows.map((row) => toBalance(accounts, row));
}

/** Headline P&L figures for the period. */
export async function financeKpis(filters: Filters): Promise<PnlSummary> {
  return summarise(await accountBalances(filters));
}

export interface CompanyPnl extends PnlSummary {
  /** `D_COMP_CODE`. */
  company: string;
  /** Has a non-zero posted balance on an income-statement account in the period. */
  hasPnl: boolean;
}

/**
 * The P&L per company for the period, each rolled up exactly as `financeKpis` rolls up the
 * period with only that company selected. Companies without any posted line are not returned.
 */
export async function financeByCompany(filters: Filters): Promise<CompanyPnl[]> {
  const rows = await run(companyAccountQuery(filters));
  const accounts = chartOfAccounts();
  const byCompany = new Map<string, AccountBalance[]>();
  for (const row of rows) {
    const company = text(row.comp_code);
    byCompany.set(company, [...(byCompany.get(company) ?? []), toBalance(accounts, row)]);
  }
  return [...byCompany.entries()].map(([company, balances]) => ({
    company,
    ...summarise(balances),
    hasPnl: balances.some((balance) => isPnl(balance) && !isZero(balance.net)),
  }));
}

/** Every month of the period with its P&L. Months without postings are zeros. */
export async function financeMonthly(filters: Filters): Promise<PnlMonth[]> {
  const rows = await run(monthlyAccountQuery(filters));
  const accounts = chartOfAccounts();
  const byMonth = new Map<string, AccountBalance[]>();
  for (const row of rows) {
    const month = String(row.gl_month);
    byMonth.set(month, [...(byMonth.get(month) ?? []), toBalance(accounts, row)]);
  }
  return monthsInRange(filters.start, filters.end).map((month) => ({
    month,
    ...summarise(byMonth.get(month) ?? []),
  }));
}

export interface PnlMonthVsLastYear extends PnlMonth {
  /** Revenue of the same days a year earlier. */
  lastYearRevenue: number;
}

/** `financeMonthly` with each month's revenue a year earlier, over the same days (`previousYear`). */
export async function financeMonthlyVsLastYear(filters: Filters): Promise<PnlMonthVsLastYear[]> {
  const [current, previous] = await Promise.all([
    financeMonthly(filters),
    financeMonthly(previousYear(filters)),
  ]);
  const lastYear = new Map(previous.map((month) => [shiftMonth(month.month, 1), month.revenue]));
  return current.map((month) => ({ ...month, lastYearRevenue: lastYear.get(month.month) ?? 0 }));
}

/**
 * The P&L statement: one group per level_1 in statement order, each with its main accounts, for
 * this period and the same period last year. An 'Unmapped' group follows when either period has
 * unmapped postings. Accounts are sorted by size this period.
 */
export async function pnlStatement(filters: Filters): Promise<StatementGroup[]> {
  const [current, previous] = await Promise.all([
    accountBalances(filters),
    accountBalances(previousYear(filters)),
  ]);
  const groups = new Map<string, Map<string, StatementAccount>>(
    [...PNL_LEVELS, UNMAPPED].map((level) => [level, new Map()]),
  );
  const add = (balance: AccountBalance, period: "current" | "previous") => {
    if (!isPnl(balance) && balance.level1 !== UNMAPPED) return;
    const group = groups.get(balance.level1)!;
    const account = group.get(balance.mainAcnt) ?? {
      mainAcnt: balance.mainAcnt,
      name: balance.name,
      current: 0,
      previous: 0,
    };
    account[period] += balance.net;
    group.set(balance.mainAcnt, account);
  };
  current.forEach((balance) => add(balance, "current"));
  previous.forEach((balance) => add(balance, "previous"));

  return [...groups.entries()]
    .map(([level1, accounts]) => {
      const list = [...accounts.values()]
        .filter((account) => !isZero(account.current) || !isZero(account.previous))
        .sort((a, b) => Math.abs(b.current) - Math.abs(a.current) || a.mainAcnt.localeCompare(b.mainAcnt));
      return {
        level1,
        current: list.reduce((total, account) => total + account.current, 0),
        previous: list.reduce((total, account) => total + account.previous, 0),
        accounts: list,
      };
    })
    .filter((group) => group.level1 !== UNMAPPED || !isZero(group.current) || !isZero(group.previous));
}

/** Below half a fils: a balance that nets to nothing. */
export function isZero(amount: number): boolean {
  return Math.abs(amount) < 0.005;
}

/** Posted journal lines on one account for the drill-down, newest first, capped at `limit`. */
export async function journalLines(
  filters: Filters,
  mainAcnt: string,
  limit = JOURNAL_LINE_LIMIT,
): Promise<JournalLines> {
  const rows = await run(journalLinesQuery(filters, mainAcnt, limit));
  return {
    lines: rows.map((row) => ({
      date: text(row.line_date),
      company: text(row.comp_code),
      tranCode: text(row.tran_code),
      // NUMBER in Orion, REAL in sample mode: print whole numbers without a decimal point.
      docNo: row.doc_no === null || row.doc_no === undefined ? "" : String(num(row.doc_no)),
      docRef: text(row.doc_ref),
      detail: text(row.detail),
      debit: num(row.debit),
      credit: num(row.credit),
    })),
    total: num(rows[0]?.total_lines),
    totalDebit: num(rows[0]?.total_debit),
    totalCredit: num(rows[0]?.total_credit),
    limit,
  };
}

// ---------------------------------------------------------------------------------------------
// Hover breakdown and drill-down of one P&L bar

/** Companies on the hover card; the rest fold into 'All other'. */
export const PNL_HOVER_TOP_N = 5;

export interface PnlHover {
  current: PnlSummary;
  /** The same days a year earlier. */
  lastYear: PnlSummary;
  /**
   * Net profit per company, largest (profit or loss) first, the rest folded into 'All other'.
   * The rows add up to `current.netProfit`.
   */
  companies: { code: string | null; label: string; netProfit: number }[];
}

/** The group P&L from per-company P&Ls: every figure is a sum, so it matches `financeKpis`. */
function addUp(rows: PnlSummary[]): PnlSummary {
  const sum = (key: "revenue" | "costOfSales" | "generalAndAdmin" | "unmapped" | "unmappedAccounts") =>
    rows.reduce((total, row) => total + row[key], 0);
  const revenue = sum("revenue");
  const grossProfit = revenue + sum("costOfSales");
  const netProfit = grossProfit + sum("generalAndAdmin");
  return {
    revenue,
    costOfSales: sum("costOfSales"),
    grossProfit,
    grossMarginPct: revenue ? grossProfit / revenue : null,
    generalAndAdmin: sum("generalAndAdmin"),
    netProfit,
    netMarginPct: revenue ? netProfit / revenue : null,
    unmapped: sum("unmapped"),
    unmappedAccounts: sum("unmappedAccounts"),
  };
}

/**
 * What makes up one bar of the Monthly P&L: its P&L, the same days last year's, and net profit by
 * company. `filters` is already narrowed to the bar's days. One aggregated query per period (by
 * company and account), through `run` and its cache.
 */
export async function pnlHover(filters: Filters): Promise<PnlHover> {
  const [current, previous, master] = await Promise.all([
    financeByCompany(filters),
    financeByCompany(previousYear(filters)),
    companyMaster(),
  ]);
  const names = new Map(master.map((company) => [company.code, company.name]));
  const ranked = current
    .filter((row) => row.hasPnl)
    .sort(
      (a, b) =>
        Math.abs(b.netProfit) - Math.abs(a.netProfit) ||
        b.netProfit - a.netProfit ||
        a.company.localeCompare(b.company),
    )
    .map((row) => ({
      code: row.company,
      label: names.get(row.company) ?? row.company,
      netProfit: row.netProfit,
    }));
  const rest = ranked.slice(PNL_HOVER_TOP_N);
  const companies =
    rest.length === 0
      ? ranked
      : [
          ...ranked.slice(0, PNL_HOVER_TOP_N),
          { code: null, label: ALL_OTHER, netProfit: rest.reduce((total, row) => total + row.netProfit, 0) },
        ];
  return { current: addUp(current), lastYear: addUp(previous), companies };
}

/** One figure pair, already in display terms (costs positive). */
export interface StatementAmounts {
  current: number;
  previous: number;
  /**
   * The change in signed (credit-positive) terms: above zero is favourable for every line, since
   * more revenue and less cost both raise profit. `null` where good and bad don't apply.
   */
  signedChange: number | null;
}

export interface StatementAccountRow extends StatementAmounts {
  mainAcnt: string;
  name: string;
}

export interface StatementRow extends StatementAmounts {
  id: string;
  label: string;
  /** `group` expands to its accounts; `subtotal` is gross or net profit; `unmapped` is flagged. */
  kind: "group" | "subtotal" | "unmapped";
  accounts: StatementAccountRow[];
  note?: string;
}

/** Statement rows in display terms: costs flipped to positive, profit lines signed. */
export function statementRows(groups: StatementGroup[]): StatementRow[] {
  const find = (level1: string) =>
    groups.find((group) => group.level1 === level1) ?? { level1, current: 0, previous: 0, accounts: [] };
  const groupRow = (group: StatementGroup, label = group.level1): StatementRow => {
    const sign = EXPENSE_LEVELS.includes(group.level1) ? -1 : 1;
    const unmapped = group.level1 === UNMAPPED;
    return {
      id: group.level1.toLowerCase().replace(/[^a-z]+/g, "-"),
      label,
      kind: unmapped ? "unmapped" : "group",
      current: sign * group.current,
      previous: sign * group.previous,
      signedChange: unmapped ? null : group.current - group.previous,
      accounts: group.accounts.map((account) => ({
        mainAcnt: account.mainAcnt,
        name: account.name,
        current: sign * account.current,
        previous: sign * account.previous,
        signedChange: unmapped ? null : account.current - account.previous,
      })),
      note: unmapped
        ? "Accounts missing from the chart of accounts; kept out of profit. Net amount, credit − debit."
        : undefined,
    };
  };
  const subtotal = (id: string, label: string, parts: StatementGroup[]): StatementRow => {
    const current = parts.reduce((total, group) => total + group.current, 0);
    const previous = parts.reduce((total, group) => total + group.previous, 0);
    return { id, label, kind: "subtotal", current, previous, signedChange: current - previous, accounts: [] };
  };

  const revenue = find(REVENUE);
  const costOfSales = find(COST_OF_SALES);
  const generalAndAdmin = find(GENERAL_AND_ADMIN);
  const rows = [
    groupRow(revenue),
    groupRow(costOfSales),
    subtotal("gross-profit", "Gross profit", [revenue, costOfSales]),
    groupRow(generalAndAdmin),
    subtotal("net-profit", "Net profit", [revenue, costOfSales, generalAndAdmin]),
  ];
  const unmapped = groups.find((group) => group.level1 === UNMAPPED);
  if (unmapped) rows.push(groupRow(unmapped));
  return rows;
}
