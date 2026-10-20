/**
 * Finance numbers against values worked out by hand from tests/fixtures/ZF_F_T_DETAIL_BI.csv and
 * the test chart of accounts in tests/fixtures/coa/chart-of-accounts.csv.
 *
 * Q1 2025 posted (CYC) lines on P&L accounts, net = credit − debit:
 *
 *     30611 Gross Sales   101 Jan +10000, 101 Feb +5000, 102 Mar +8000          Revenue
 *     30641 Discounts     101 Feb   -500 (debit-only)                            Revenue
 *     40711 Cost of Sales 101 Jan  -6000, 102 Mar -4800                          Cost of sales
 *     40809 Salaries      101 Jan  -2000, 102 Feb -1500, 101 Mar +300 (credit)   G&A
 *     40814 Rents         101 Mar  -1200 (blank department)                      G&A
 *     40999 New GL acct   102 Feb   -700 (not in the chart of accounts)          Unmapped
 *
 * Left out: the CYU lines (101 Mar +99999 sales, 102 Mar -55555 salaries), the April sale, and
 * the 2024 lines (last year: sales +7000, cost -4000, salaries -1000).
 */
import path from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { previousYear } from "@/lib/filters";
import {
  chartOfAccounts,
  parseChartOfAccounts,
  PNL_LEVELS,
  setChartOfAccountsPathForTests,
  UNMAPPED,
} from "@/lib/server/chart-of-accounts";
import { setRunnerForTests } from "@/lib/server/db";
import {
  accountBalances,
  accountTotalsQuery,
  expenseBreakdown,
  financeKpis,
  financeMonthly,
  journalLines,
  journalLinesQuery,
  pnlStatement,
} from "@/lib/server/queries/finance";
import { ALL_OTHER, UNASSIGNED } from "@/lib/server/sql";

import { FIXTURE_DIR, Q1_2025, useFixtureSource } from "./fixture";

beforeAll(() => {
  useFixtureSource();
  setChartOfAccountsPathForTests(path.join(FIXTURE_DIR, "coa", "chart-of-accounts.csv"));
});
afterAll(() => {
  setRunnerForTests(undefined);
  setChartOfAccountsPathForTests(undefined);
});

describe("posted lines and balances", () => {
  it("filters on the third character of TD_STATUS, never on a 'P' status", () => {
    const { sql } = accountTotalsQuery(Q1_2025);
    expect(sql).toContain("SUBSTR(TD_STATUS, 3, 1) = 'C'");
    expect(sql).not.toMatch(/TD_STATUS\s*=\s*'P'/);
  });

  it("excludes unposted CYU lines", async () => {
    const kpis = await financeKpis(Q1_2025);
    // With the CYU sale revenue would be 122499; with the CYU payroll G&A would be -59955.
    expect(kpis.revenue).toBeCloseTo(22500);
    expect(kpis.generalAndAdmin).toBeCloseTo(-4400);
    const lines = await journalLines(Q1_2025, "40809");
    expect(lines.lines.map((line) => line.detail)).not.toContain("Unposted payroll");
  });

  it("NVL gives balances for debit-only, credit-only and mixed accounts", async () => {
    const balances = Object.fromEntries((await accountBalances(Q1_2025)).map((row) => [row.mainAcnt, row]));
    // Credit-only: Gross Sales.
    expect(balances["30611"]).toMatchObject({ debit: 0, credit: 23000, net: 23000 });
    // Debit-only: Discounts and Cost of Sales.
    expect(balances["30641"]).toMatchObject({ debit: 500, credit: 0, net: -500 });
    expect(balances["40711"]).toMatchObject({ debit: 10800, credit: 0, net: -10800 });
    // Both sides on different lines: Salaries, and the receivable.
    expect(balances["40809"]).toMatchObject({ debit: 3500, credit: 300, net: -3200 });
    expect(balances["10251"]).toMatchObject({ debit: 23000, credit: 500, net: -22500 });
  });

  it("the posted ledger balances: debits equal credits", async () => {
    const balances = await accountBalances(Q1_2025);
    const debit = balances.reduce((total, row) => total + row.debit, 0);
    const credit = balances.reduce((total, row) => total + row.credit, 0);
    expect(debit).toBeCloseTo(credit);
    expect(balances.reduce((total, row) => total + row.net, 0)).toBeCloseTo(0);
  });
});

describe("finance KPIs", () => {
  it("all companies, in signed terms", async () => {
    const kpis = await financeKpis(Q1_2025);
    expect(kpis.revenue).toBeCloseTo(22500);
    expect(kpis.costOfSales).toBeCloseTo(-10800);
    expect(kpis.grossProfit).toBeCloseTo(11700);
    expect(kpis.grossMarginPct).toBeCloseTo(11700 / 22500);
    expect(kpis.generalAndAdmin).toBeCloseTo(-4400);
    expect(kpis.netProfit).toBeCloseTo(7300);
    expect(kpis.netMarginPct).toBeCloseTo(7300 / 22500);
  });

  it("net profit = revenue + cost of sales + G&A", async () => {
    for (const filters of [Q1_2025, previousYear(Q1_2025), { ...Q1_2025, companies: ["102"] }]) {
      const kpis = await financeKpis(filters);
      expect(kpis.netProfit).toBeCloseTo(kpis.revenue + kpis.costOfSales + kpis.generalAndAdmin);
      expect(kpis.grossProfit).toBeCloseTo(kpis.revenue + kpis.costOfSales);
    }
  });

  it("keeps the unmapped account out of profit and reports it", async () => {
    const kpis = await financeKpis(Q1_2025);
    expect(kpis.unmapped).toBeCloseTo(-700);
    expect(kpis.unmappedAccounts).toBe(1);
  });

  it("one company", async () => {
    const kpis = await financeKpis({ ...Q1_2025, companies: ["101"] });
    expect(kpis.revenue).toBeCloseTo(14500);
    expect(kpis.costOfSales).toBeCloseTo(-6000);
    expect(kpis.generalAndAdmin).toBeCloseTo(-2900);
    expect(kpis.netProfit).toBeCloseTo(5600);
    expect(kpis.unmapped).toBe(0);
    expect(kpis.unmappedAccounts).toBe(0);
  });

  it("previous year", async () => {
    const kpis = await financeKpis(previousYear(Q1_2025));
    expect(kpis.revenue).toBeCloseTo(7000);
    expect(kpis.costOfSales).toBeCloseTo(-4000);
    expect(kpis.generalAndAdmin).toBeCloseTo(-1000);
    expect(kpis.netProfit).toBeCloseTo(2000);
  });

  it("an empty selection gives zeros", async () => {
    const kpis = await financeKpis({ ...Q1_2025, start: "2030-01-01", end: "2030-01-31" });
    expect(kpis.revenue).toBe(0);
    expect(kpis.netProfit).toBe(0);
    expect(kpis.grossMarginPct).toBeNull();
    expect(kpis.netMarginPct).toBeNull();
  });
});

describe("monthly P&L", () => {
  it("every month, adding up to the period", async () => {
    const months = await financeMonthly(Q1_2025);
    expect(months.map((month) => month.month)).toEqual(["2025-01", "2025-02", "2025-03"]);
    expect(months.map((month) => month.revenue)).toEqual([10000, 4500, 8000]);
    expect(months.map((month) => month.grossProfit)).toEqual([4000, 4500, 3200]);
    expect(months.map((month) => month.netProfit)).toEqual([2000, 3000, 2300]);
    expect(months.map((month) => month.unmapped)).toEqual([0, -700, 0]);
    const kpis = await financeKpis(Q1_2025);
    expect(months.reduce((total, month) => total + month.netProfit, 0)).toBeCloseTo(kpis.netProfit);
  });
});

describe("P&L statement", () => {
  it("groups accounts by level_1, this period vs last year, unmapped last", async () => {
    const groups = await pnlStatement(Q1_2025);
    expect(groups.map((group) => [group.level1, group.current, group.previous])).toEqual([
      ["Revenue", 22500, 7000],
      ["Cost of sales", -10800, -4000],
      ["General and admin expenses", -4400, -1000],
      [UNMAPPED, -700, 0],
    ]);
    expect(groups[0].accounts).toEqual([
      { mainAcnt: "30611", name: "Gross Sales", current: 23000, previous: 7000 },
      { mainAcnt: "30641", name: "Discounts", current: -500, previous: 0 },
    ]);
    expect(groups[3].accounts).toEqual([
      { mainAcnt: "40999", name: "New GL account", current: -700, previous: 0 },
    ]);
  });

  it("leaves balance-sheet accounts out", async () => {
    const accounts = (await pnlStatement(Q1_2025)).flatMap((group) => group.accounts);
    expect(accounts.map((account) => account.mainAcnt)).not.toContain("10251");
    expect(accounts.map((account) => account.mainAcnt)).not.toContain("12291");
  });

  it("shows no Unmapped group when nothing is unmapped", async () => {
    const groups = await pnlStatement({ ...Q1_2025, companies: ["101"] });
    expect(groups.map((group) => group.level1)).toEqual([...PNL_LEVELS]);
  });
});

describe("expense breakdown", () => {
  const byLabel = (rows: { label: string; net: number }[]) =>
    Object.fromEntries(rows.map((row) => [row.label, row.net]));

  it("by account, costs only, signed", async () => {
    expect(byLabel(await expenseBreakdown(Q1_2025, "account"))).toEqual({
      "40711 · Cost of Sales": -10800,
      "40809 · Salaries & Staff Benefits": -3200,
      "40814 · Rents & Rates": -1200,
    });
  });

  it("by division and department, blanks as Unassigned", async () => {
    expect(byLabel(await expenseBreakdown(Q1_2025, "division"))).toEqual({
      [UNASSIGNED]: -10800,
      Trading: -2900,
      Retail: -1500,
    });
    expect(byLabel(await expenseBreakdown(Q1_2025, "department"))).toEqual({
      [UNASSIGNED]: -12000,
      Sales: -1700,
      Finance: -1500,
    });
  });

  it.each(["account", "division", "department"] as const)(
    "%s adds up to cost of sales + G&A",
    async (dimension) => {
      const kpis = await financeKpis(Q1_2025);
      for (const rows of [
        await expenseBreakdown(Q1_2025, dimension),
        await expenseBreakdown(Q1_2025, dimension, 1),
      ]) {
        expect(rows.reduce((total, row) => total + row.net, 0)).toBeCloseTo(
          kpis.costOfSales + kpis.generalAndAdmin,
        );
      }
    },
  );

  it("top N folds the rest into All other", async () => {
    const rows = await expenseBreakdown(Q1_2025, "account", 1);
    expect(rows).toEqual([
      { label: "40711 · Cost of Sales", net: -10800 },
      { label: ALL_OTHER, net: -4400 },
    ]);
  });
});

describe("journal lines drill-down", () => {
  it("posted lines on one account, newest first, with debit and credit", async () => {
    const result = await journalLines(Q1_2025, "40809");
    expect(result.lines.map((line) => [line.date, line.docRef, line.debit, line.credit])).toEqual([
      ["2025-03-15", "REF-10", 0, 300],
      ["2025-02-28", "PAY-8", 1500, 0],
      ["2025-01-31", "PAY-7", 2000, 0],
    ]);
    expect(result.lines[0]).toMatchObject({
      company: "101",
      tranCode: "PV",
      docNo: "10",
      detail: "Payroll refund",
    });
    expect(result).toMatchObject({ total: 3, totalDebit: 3500, totalCredit: 300 });
  });

  it("stops at the limit but still counts every line", async () => {
    const result = await journalLines(Q1_2025, "40809", 2);
    expect(result.lines).toHaveLength(2);
    expect(result.total).toBe(3);
    expect(result.limit).toBe(2);
  });

  it("binds the account and the limit", () => {
    const { sql, binds } = journalLinesQuery(Q1_2025, "40809");
    expect(sql).toContain("D_MAIN_ACNT = :main_acnt");
    expect(binds).toMatchObject({ main_acnt: "40809", line_limit: 500 });
  });

  it("an unknown account has no lines", async () => {
    expect(await journalLines(Q1_2025, "99999")).toMatchObject({ lines: [], total: 0 });
  });
});

describe("chart of accounts", () => {
  it("an account missing from the file is Unmapped at every level", async () => {
    const unmapped = (await accountBalances(Q1_2025)).find((row) => row.mainAcnt === "40999");
    expect(unmapped).toMatchObject({
      name: "New GL account",
      level0: UNMAPPED,
      level1: UNMAPPED,
      level2: UNMAPPED,
      net: -700,
    });
  });

  it("rejects a file without the expected columns", () => {
    expect(() => parseChartOfAccounts("account,name\n1,x\n")).toThrow(/main_acnt/);
  });

  it("the shipped data/chart-of-accounts.csv is well formed", () => {
    setChartOfAccountsPathForTests(undefined);
    try {
      const accounts = [...chartOfAccounts().values()];
      expect(accounts.length).toBeGreaterThan(100);
      const pnl = accounts.filter((account) => account.level0 === "Profit and loss");
      expect(new Set(pnl.map((account) => account.level1))).toEqual(new Set(PNL_LEVELS));
      expect(accounts.every((account) => /^[\w.-]+$/.test(account.mainAcnt) && account.name)).toBe(true);
    } finally {
      setChartOfAccountsPathForTests(path.join(FIXTURE_DIR, "coa", "chart-of-accounts.csv"));
    }
  });
});
