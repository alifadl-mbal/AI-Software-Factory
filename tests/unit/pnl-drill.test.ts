/**
 * The Monthly P&L hover card and drill-down reconcile with the P&L statement and the KPI cards for
 * the same month and company, against the hand-checked fixtures (see finance.test.ts):
 *
 *     Feb 2025 posted: 30611 101 +5000, 30641 101 -500, 40809 102 -1500, 40999 102 -700 (unmapped)
 *     Feb 2024 posted: none on P&L accounts in the fixture's February.
 */
import path from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { GET as breakdownGet } from "@/app/api/finance/pnl-breakdown/route";
import { GET as statementGet } from "@/app/api/finance/statement/route";
import { previousYear, type Filters } from "@/lib/filters";
import { bucketFilters } from "@/lib/periods";
import { parseAccountParam, parseLineParam, pnlDrillFilters, pnlDrillTitle } from "@/lib/pnl-drill";
import { setChartOfAccountsPathForTests } from "@/lib/server/chart-of-accounts";
import { setRunnerForTests } from "@/lib/server/db";
import {
  financeKpis,
  journalLines,
  pnlHover,
  pnlStatement,
  statementRows,
  type PnlHover,
  type StatementRow,
} from "@/lib/server/queries/finance";
import { ALL_OTHER } from "@/lib/server/sql";

import { FIXTURE_DIR, Q1_2025, useFixtureSource } from "./fixture";

beforeAll(() => {
  useFixtureSource();
  setChartOfAccountsPathForTests(path.join(FIXTURE_DIR, "coa", "chart-of-accounts.csv"));
});
afterAll(() => {
  setRunnerForTests(undefined);
  setChartOfAccountsPathForTests(undefined);
});

const FEB: Filters = { ...Q1_2025, start: "2025-02-01", end: "2025-02-28" };

function row(rows: StatementRow[], id: string): StatementRow {
  const found = rows.find((entry) => entry.id === id);
  if (!found) throw new Error(`no statement row ${id}`);
  return found;
}

describe("the hover card of one month", () => {
  it("matches the KPI cards for the same days, this year and last", async () => {
    const [hover, kpis, lastYear] = await Promise.all([
      pnlHover(FEB),
      financeKpis(FEB),
      financeKpis(previousYear(FEB)),
    ]);
    expect(hover.current.revenue).toBeCloseTo(4500);
    expect(hover.current.generalAndAdmin).toBeCloseTo(-1500);
    for (const key of ["revenue", "costOfSales", "generalAndAdmin", "netProfit", "unmapped"] as const) {
      expect(hover.current[key], key).toBeCloseTo(kpis[key]);
      expect(hover.lastYear[key], key).toBeCloseTo(lastYear[key]);
    }
  });

  it("its companies add up to net profit, largest first", async () => {
    const hover = await pnlHover(FEB);
    expect(hover.companies.map((company) => company.code)).toEqual(["101", "102"]);
    const sum = hover.companies.reduce((total, company) => total + company.netProfit, 0);
    expect(sum).toBeCloseTo(hover.current.netProfit);
    expect(hover.companies[0].netProfit).toBeCloseTo(4500);
    expect(hover.companies[1].netProfit).toBeCloseTo(-1500);
  });

  it("folds companies past the top five into All other, keeping the total", async () => {
    const hover = await pnlHover(Q1_2025);
    expect(hover.companies.length).toBeLessThanOrEqual(6);
    expect(hover.companies.filter((company) => company.label === ALL_OTHER).length).toBeLessThanOrEqual(1);
    const sum = hover.companies.reduce((total, company) => total + company.netProfit, 0);
    expect(sum).toBeCloseTo(hover.current.netProfit);
  });

  it("applies the company filter", async () => {
    const filters = { ...FEB, companies: ["102"] };
    const [hover, kpis] = await Promise.all([pnlHover(filters), financeKpis(filters)]);
    expect(hover.current.netProfit).toBeCloseTo(kpis.netProfit);
    expect(hover.current.revenue).toBe(0);
    expect(hover.companies.map((company) => company.code)).toEqual(["102"]);
  });
});

describe("the drill-down of one month", () => {
  it("P&L lines match the statement and the hover card", async () => {
    const [rows, hover] = await Promise.all([pnlStatement(FEB).then(statementRows), pnlHover(FEB)]);
    expect(row(rows, "revenue").current).toBeCloseTo(hover.current.revenue);
    expect(row(rows, "cost-of-sales").current).toBeCloseTo(-hover.current.costOfSales);
    expect(row(rows, "general-and-admin-expenses").current).toBeCloseTo(-hover.current.generalAndAdmin);
    expect(row(rows, "net-profit").current).toBeCloseTo(hover.current.netProfit);
    expect(row(rows, "net-profit").previous).toBeCloseTo(hover.lastYear.netProfit);
  });

  it("each line's accounts add up to the line, and an account's journal lines to the account", async () => {
    const rows = statementRows(await pnlStatement(FEB));
    for (const line of rows.filter((entry) => entry.kind !== "subtotal")) {
      const sum = line.accounts.reduce((total, account) => total + account.current, 0);
      expect(sum, line.id).toBeCloseTo(line.current);
    }
    const salaries = row(rows, "general-and-admin-expenses").accounts.find((a) => a.mainAcnt === "40809")!;
    expect(salaries.current).toBeCloseTo(1500);
    const journal = await journalLines(FEB, "40809");
    // Costs are flipped for display; journal lines keep credit − debit.
    expect(journal.totalCredit - journal.totalDebit).toBeCloseTo(-salaries.current);
    expect(journal.lines.every((line) => line.date.startsWith("2025-02"))).toBe(true);
  });
});

async function get(
  handler: (request: Request) => Promise<Response>,
  route: string,
  params: Record<string, string>,
): Promise<{ status: number; body: { ok: boolean; data: unknown } }> {
  const url = new URL(`http://localhost:3000${route}`);
  for (const [name, value] of Object.entries(params)) url.searchParams.set(name, value);
  const response = await handler(new Request(url));
  return { status: response.status, body: await response.json() };
}

const Q1 = { range: "custom", from: "2025-01-01", to: "2025-03-31" };

describe("GET /api/finance/pnl-breakdown and /api/finance/statement", () => {
  it("answer for a month of the range, with the company filter", async () => {
    const hover = await get(breakdownGet, "/api/finance/pnl-breakdown", { ...Q1, period: "2025-02" });
    expect(hover.status).toBe(200);
    expect((hover.body.data as PnlHover).current.netProfit).toBeCloseTo((await financeKpis(FEB)).netProfit);

    const statement = await get(statementGet, "/api/finance/statement", {
      ...Q1,
      period: "2025-02",
      company: "101",
    });
    expect(statement.status).toBe(200);
    const rows = statement.body.data as StatementRow[];
    expect(row(rows, "net-profit").current).toBeCloseTo(4500);
  });

  it("a month the range cuts covers only the range's days", async () => {
    const { body } = await get(breakdownGet, "/api/finance/pnl-breakdown", {
      range: "custom",
      from: "2025-02-10",
      to: "2025-03-31",
      period: "2025-02",
    });
    const kpis = await financeKpis({ ...Q1_2025, start: "2025-02-10", end: "2025-02-28" });
    expect((body.data as PnlHover).current.netProfit).toBeCloseTo(kpis.netProfit);
  });

  it("refuse a missing, malformed or out-of-range period with 400", async () => {
    for (const params of [
      Q1,
      { ...Q1, period: "2025-13" },
      { ...Q1, period: "2025-02; DROP" },
      { ...Q1, period: "2026-01" },
    ]) {
      for (const [handler, route] of [
        [breakdownGet, "/api/finance/pnl-breakdown"],
        [statementGet, "/api/finance/statement"],
      ] as const) {
        const { status, body } = await get(handler, route, params);
        expect(status, `${route} ${JSON.stringify(params)}`).toBe(400);
        expect(body.ok).toBe(false);
      }
    }
  });
});

describe("lib/pnl-drill", () => {
  it("cuts the bar to the range and titles it", () => {
    const filters = { start: "2026-01-01", end: "2026-10-21" };
    expect(pnlDrillFilters(filters, "2026-10")).toEqual({ start: "2026-10-01", end: "2026-10-21" });
    expect(pnlDrillFilters(filters, "2025-10")).toBeNull();
    expect(pnlDrillFilters(filters, "nonsense")).toBeNull();
    expect(pnlDrillTitle("2026-10", filters)).toBe("Oct 2026 (1–21 Oct)");
    expect(pnlDrillTitle("2026-09", filters)).toBe("Sep 2026");
    expect(bucketFilters(filters, "2026")).toEqual({ start: "2026-01-01", end: "2026-10-21" });
  });

  it("only accepts plain line ids and account codes", () => {
    expect(parseLineParam("cost-of-sales")).toBe("cost-of-sales");
    expect(parseLineParam("x' OR 1=1")).toBeNull();
    expect(parseAccountParam("40809")).toBe("40809");
    expect(parseAccountParam("40809;DROP")).toBeNull();
  });
});
