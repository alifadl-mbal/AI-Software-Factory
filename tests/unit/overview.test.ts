/**
 * The Overview's company ranking and summary sentence, on the hand-checked fixtures (see
 * finance.test.ts for the Q1 2025 postings of companies 101 and 102).
 */
import path from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { parseFilters, type Filters } from "@/lib/filters";
import { setChartOfAccountsPathForTests } from "@/lib/server/chart-of-accounts";
import { setRunnerForTests } from "@/lib/server/db";
import { article, companyRanking, summarySentence, type SummaryInput } from "@/lib/server/overview";
import { companyAccountQuery, financeKpis, summarise } from "@/lib/server/queries/finance";
import { SampleSource } from "@/lib/server/sample";
import type { Binds } from "@/lib/server/types";

import { FIXTURE_DIR, Q1_2025, useFixtureSource } from "./fixture";

const sum = (values: number[]) => values.reduce((total, value) => total + value, 0);

beforeAll(() => {
  useFixtureSource();
  setChartOfAccountsPathForTests(path.join(FIXTURE_DIR, "coa", "chart-of-accounts.csv"));
});
afterAll(() => {
  setRunnerForTests(undefined);
  setChartOfAccountsPathForTests(undefined);
});

describe("companyRanking", () => {
  it("gives each company the same net profit as Finance with only that company selected", async () => {
    const { rows } = await companyRanking(Q1_2025);
    expect(rows.map((row) => row.code).sort()).toEqual(["101", "102"]);
    for (const row of rows) {
      const finance = await financeKpis({ ...Q1_2025, companies: [row.code] });
      expect(row.current.netProfit).toBeCloseTo(finance.netProfit, 6);
      expect(row.current.revenue).toBeCloseTo(finance.revenue, 6);
      expect(row.current.netMarginPct).toBeCloseTo(finance.netMarginPct!, 6);
      const lastYear = await financeKpis({
        ...Q1_2025,
        start: "2024-01-01",
        end: "2024-03-31",
        companies: [row.code],
      });
      expect(row.previous.netProfit).toBeCloseTo(lastYear.netProfit, 6);
    }
  });

  it("adds up to the group P&L and ranks by net profit", async () => {
    const { rows, leftOut } = await companyRanking(Q1_2025);
    const group = await financeKpis(Q1_2025);
    expect(sum(rows.map((row) => row.current.netProfit))).toBeCloseTo(group.netProfit, 6);
    expect(sum(rows.map((row) => row.current.revenue))).toBeCloseTo(group.revenue, 6);
    const profits = rows.map((row) => row.current.netProfit);
    expect(profits).toEqual([...profits].sort((a, b) => b - a));
    expect(rows[0].name).toBe("Alpha Trading");
    expect(leftOut).toBe(0);
  });

  it("counts selected companies without P&L postings as left out", async () => {
    const { rows, leftOut } = await companyRanking({ ...Q1_2025, companies: ["101", "999"] });
    expect(rows.map((row) => row.code)).toEqual(["101"]);
    expect(leftOut).toBe(1);
  });

  it("is empty for a period with no postings", async () => {
    const { rows } = await companyRanking({ ...Q1_2025, start: "2030-01-01", end: "2030-01-31" });
    expect(rows).toEqual([]);
  });
});

describe("last year is like-for-like at a partial month", () => {
  async function rankingPeriods(filters: Filters): Promise<Binds[]> {
    const seen: Binds[] = [];
    const source = new SampleSource({ fixtureDir: FIXTURE_DIR, rebaseToYear: null });
    setRunnerForTests((sql, binds) => {
      if (sql === companyAccountQuery(filters).sql) seen.push(binds ?? {});
      return source.query(sql, binds);
    });
    await companyRanking(filters);
    setRunnerForTests((sql, binds) => source.query(sql, binds));
    return seen;
  }

  it("compares 1 Jan–21 Oct with 1 Jan–21 Oct last year, year to date on 21 Oct", async () => {
    const filters = parseFilters({}, "2026-10-21");
    const periods = (await rankingPeriods(filters)).map((binds) => [
      binds.start_date,
      binds.end_date_exclusive,
    ]);
    expect(periods).toEqual(
      expect.arrayContaining([
        ["2026-01-01", "2026-10-22"],
        ["2025-01-01", "2025-10-22"],
      ]),
    );
    expect(periods).toHaveLength(2);
  });

  it("compares 1–21 Oct with 1–21 Oct last year, not the whole of last October", async () => {
    const filters = parseFilters({ range: "mtd" }, "2026-10-21");
    const periods = (await rankingPeriods(filters)).map((binds) => [
      binds.start_date,
      binds.end_date_exclusive,
    ]);
    expect(periods).toEqual(
      expect.arrayContaining([
        ["2026-10-01", "2026-10-22"],
        ["2025-10-01", "2025-10-22"],
      ]),
    );
  });
});

describe("summarySentence", () => {
  const YTD = parseFilters({}, "2026-10-21");
  const pnl = (netProfit: number, revenue: number) => ({
    ...summarise([]),
    netProfit,
    revenue,
    netMarginPct: revenue ? netProfit / revenue : null,
  });
  const rows = [
    { code: "107", name: "Company X", current: pnl(3_200_000, 10_000_000), previous: pnl(0, 0) },
    { code: "101", name: "Company Y", current: pnl(-100_000, 2_000_000), previous: pnl(0, 0) },
  ];
  const input = (changes: Partial<SummaryInput> = {}): SummaryInput => ({
    filters: YTD,
    sales: { current: { netRevenue: 12_300_000 }, previous: { netRevenue: 13_570_000 } },
    finance: {
      current: { netProfit: 504_300, netMarginPct: 0.041 },
      previous: { netProfit: 1, netMarginPct: 0 },
    },
    ranking: { rows },
    ...changes,
  });

  it("states revenue, the like-for-like change, the margin and the leader", () => {
    expect(summarySentence(input())).toBe(
      "Year to date, net revenue was AED 12.3M, down 9.4% on the same days last year, at a 4.1% net margin. Company X led with AED 3.2M net profit.",
    );
  });

  it("says an before a margin read with a vowel sound", () => {
    expect(["8.0%", "11.2%", "18.7%", "80.5%", "4.1%", "1.8%", "110.0%", "-8.1%"].map(article)).toEqual([
      "an",
      "an",
      "an",
      "an",
      "a",
      "a",
      "a",
      "an",
    ]);
    const finance = {
      current: { netProfit: 1_870_000, netMarginPct: 0.187 },
      previous: { netProfit: 1, netMarginPct: 0 },
    };
    expect(summarySentence(input({ finance }))).toContain("at an 18.7% net margin.");
  });

  it("drops the comparison without last-year data", () => {
    const text = summarySentence(
      input({ sales: { current: { netRevenue: 12_300_000 }, previous: { netRevenue: 0 } } }),
    );
    expect(text).toBe(
      "Year to date, net revenue was AED 12.3M, at a 4.1% net margin. Company X led with AED 3.2M net profit.",
    );
  });

  it("says net loss for a loss", () => {
    const text = summarySentence(
      input({
        finance: {
          current: { netProfit: -450_000, netMarginPct: -0.0366 },
          previous: { netProfit: 0, netMarginPct: null },
        },
      }),
    );
    expect(text).toContain("with a net loss of AED 450K.");
    expect(text).not.toContain("margin");
  });

  it("leaves out the leader with one company selected", () => {
    const text = summarySentence(
      input({ filters: { ...YTD, companies: ["107"] }, ranking: { rows: [rows[0]] } }),
    );
    expect(text).not.toContain("led");
  });

  it("leaves out the leader when no company made a profit", () => {
    const losses = rows.map((row) => ({ ...row, current: pnl(-5, 10) }));
    expect(summarySentence(input({ ranking: { rows: losses } }))).not.toContain("led");
  });

  it("never prints NaN, Infinity or a 0% for missing data", () => {
    const text = summarySentence({
      filters: { ...YTD, range: "custom", start: "2030-01-01", end: "2030-01-31" },
      sales: { current: { netRevenue: 0 }, previous: { netRevenue: 0 } },
      finance: {
        current: { netProfit: 0, netMarginPct: null },
        previous: { netProfit: 0, netMarginPct: null },
      },
      ranking: { rows: [] },
    });
    expect(text).toBe("From 1 Jan 2030 to 31 Jan 2030, there was no net revenue.");
    expect(text).not.toMatch(/NaN|Infinity|0%|—/);
  });

  it("keeps the ledger's margin and leader apart from revenue filtered by salesperson or brand", () => {
    const text = summarySentence(input({ filters: { ...YTD, salespeople: ["S06"] } }));
    expect(text).toBe(
      "Year to date, net revenue was AED 12.3M, down 9.4% on the same days last year. Across all salespeople and brands, the business made a 4.1% net margin; Company X led with AED 3.2M net profit.",
    );
    const loss = summarySentence(
      input({
        filters: { ...YTD, brands: ["NW"] },
        finance: {
          current: { netProfit: -450_000, netMarginPct: -0.0366 },
          previous: { netProfit: 0, netMarginPct: null },
        },
        ranking: { rows: [rows[0]] },
      }),
    );
    expect(loss).toBe(
      "Year to date, net revenue was AED 12.3M, down 9.4% on the same days last year. Across all salespeople and brands, the business made a net loss of AED 450K.",
    );
  });

  it("names the period for each preset", () => {
    expect(summarySentence(input({ filters: parseFilters({ range: "mtd" }, "2026-10-21") }))).toMatch(
      /^Month to date,/,
    );
    expect(summarySentence(input({ filters: parseFilters({ range: "12m" }, "2026-10-21") }))).toMatch(
      /^Over the last 12 months,/,
    );
  });
});
