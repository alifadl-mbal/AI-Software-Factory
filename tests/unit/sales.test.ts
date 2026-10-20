/**
 * Sales numbers against values worked out by hand from tests/fixtures/ZF_CSL_BI.csv.
 *
 * Q1 2025 rows that count (types INV and SARTN, 2025-01-01..2025-03-31):
 *
 *     101 IU5 1001  net 1000  cost 600   Customer A / Alice / Group 1
 *     101 IU5 1001  net  500  cost 300   Customer A / Alice / Group 1
 *     102 IN5 2001  net 2000  cost 1500  Customer B / Bob   / Group 2
 *     101 SRU 3001  net -200  cost -120  Customer A / Alice / Group 1   (return)
 *     102 DNP 4001  net    0  cost 400   Customer B / Bob   / Group 2   (delivery note)
 *     102 INP 4002  net  800  cost 0     blank customer / salesperson / group
 *
 * Left out: the XFR row (wrong type), the April invoice, and the 2024 rows (last year: 700 − 100).
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { setRunnerForTests } from "@/lib/server/db";
import {
  DIMENSIONS,
  salesBreakdown,
  salesKpis,
  salesMonthly,
  type Dimension,
} from "@/lib/server/queries/sales";
import { companies } from "@/lib/server/queries/common";
import { ALL_OTHER, UNASSIGNED } from "@/lib/server/sql";
import { previousYear } from "@/lib/filters";

import { Q1_2025, useFixtureSource } from "./fixture";

beforeAll(() => {
  useFixtureSource();
});
afterAll(() => setRunnerForTests(undefined));

describe("sales KPIs", () => {
  it("all companies", async () => {
    const result = await salesKpis(Q1_2025);
    expect(result.netRevenue).toBeCloseTo(4100);
    expect(result.cost).toBeCloseTo(2680);
    expect(result.grossMargin).toBeCloseTo(1420);
    expect(result.marginPct).toBeCloseTo(1420 / 4100);
    expect(result.returnsValue).toBeCloseTo(-200);
    // 101-IU5-1001, 102-IN5-2001, 102-INP-4002. The zero-value delivery note is not an invoice.
    expect(result.invoiceCount).toBe(3);
  });

  it("one company", async () => {
    const result = await salesKpis({ ...Q1_2025, companies: ["101"] });
    expect(result.netRevenue).toBeCloseTo(1300);
    expect(result.grossMargin).toBeCloseTo(1300 - 780);
    expect(result.returnsValue).toBeCloseTo(-200);
    expect(result.invoiceCount).toBe(1);
  });

  it("previous year", async () => {
    const result = await salesKpis(previousYear(Q1_2025));
    expect(result.netRevenue).toBeCloseTo(600);
    expect(result.grossMargin).toBeCloseTo(600 - 340);
    expect(result.returnsValue).toBeCloseTo(-100);
    expect(result.invoiceCount).toBe(1);
  });

  it("the end date is inclusive", async () => {
    const result = await salesKpis({ ...Q1_2025, start: "2025-04-01", end: "2025-04-02" });
    expect(result.netRevenue).toBeCloseTo(300);
  });

  it("an empty selection gives zeros", async () => {
    const result = await salesKpis({ ...Q1_2025, start: "2030-01-01", end: "2030-01-31" });
    expect(result.netRevenue).toBe(0);
    expect(result.marginPct).toBeNull();
    expect(result.invoiceCount).toBe(0);
  });

  it("never counts gross sales value as revenue", async () => {
    // Gross (pre-discount) sum of the same rows would be 4380.
    expect((await salesKpis(Q1_2025)).netRevenue).not.toBeCloseTo(4380);
  });
});

describe("sales breakdowns", () => {
  it("keeps blanks as Unassigned", async () => {
    const customers = await salesBreakdown(Q1_2025, "customer");
    expect(Object.fromEntries(customers.map((row) => [row.label, row.netRevenue]))).toEqual({
      "Customer B": 2000,
      "Customer A": 1300,
      [UNASSIGNED]: 800,
    });
    const salespeople = await salesBreakdown(Q1_2025, "salesperson");
    expect(Object.fromEntries(salespeople.map((row) => [row.label, row.netRevenue]))).toEqual({
      Bob: 2000,
      Alice: 1300,
      [UNASSIGNED]: 800,
    });
  });

  it.each(Object.keys(DIMENSIONS) as Dimension[])("%s adds up to the KPI totals", async (dimension) => {
    const kpis = await salesKpis(Q1_2025);
    const sum = (rows: { netRevenue: number; grossMargin: number }[]) => ({
      revenue: rows.reduce((total, row) => total + row.netRevenue, 0),
      margin: rows.reduce((total, row) => total + row.grossMargin, 0),
    });
    for (const rows of [
      await salesBreakdown(Q1_2025, dimension),
      await salesBreakdown(Q1_2025, dimension, 1),
    ]) {
      expect(sum(rows).revenue).toBeCloseTo(kpis.netRevenue);
      expect(sum(rows).margin).toBeCloseTo(kpis.grossMargin);
    }
  });

  it("top N folds the rest into All other", async () => {
    const rows = await salesBreakdown(Q1_2025, "customer", 1);
    expect(rows.map((row) => row.label)).toEqual(["Customer B", ALL_OTHER]);
    expect(rows.map((row) => row.netRevenue)).toEqual([2000, 2100]);
  });

  it("company breakdown", async () => {
    const rows = await salesBreakdown(Q1_2025, "company");
    expect(rows.map((row) => [row.label, row.netRevenue])).toEqual([
      ["Beta Supplies", 2800],
      ["Alpha Trading", 1300],
    ]);
  });
});

describe("monthly trend", () => {
  it("this year vs last year, months without sales are zero", async () => {
    const months = await salesMonthly(Q1_2025);
    expect(months.map((row) => row.month)).toEqual(["2025-01", "2025-02", "2025-03"]);
    expect(months.map((row) => row.netRevenue)).toEqual([1500, 1800, 800]);
    expect(months.map((row) => row.lastYearNetRevenue)).toEqual([0, 600, 0]);
    expect(months.map((row) => row.returnsValue)).toEqual([0, -200, 0]);
    const total = months.reduce((sum, row) => sum + row.netRevenue, 0);
    expect(total).toBeCloseTo((await salesKpis(Q1_2025)).netRevenue);
  });
});

describe("companies", () => {
  it("lists every company code with its name", async () => {
    expect(await companies()).toEqual([
      { code: "101", name: "Alpha Trading" },
      { code: "102", name: "Beta Supplies" },
    ]);
  });
});
