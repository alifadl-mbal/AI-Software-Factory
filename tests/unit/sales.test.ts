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
 *
 * Salesperson codes: Alice A1, Bob B1, blank = Unassigned. Brands (tests/fixtures/
 * ZF_STK_SO_PO_SL_BI.csv): IX Brand One (B1, on two rows), IY Brand Two (B2), IZ has a blank brand
 * so it is Unassigned. Q1 2025 by brand: B1 1000 + 2000 − 200 = 2800, B2 500, Unassigned 800.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { setRunnerForTests } from "@/lib/server/db";
import {
  averageInvoiceValue,
  breakdownQuery,
  COMPANY_CARD_DIMENSIONS,
  DIMENSIONS,
  extrasQuery,
  HOVER_TOP_N,
  MONTH_CARD_DIMENSIONS,
  salesBreakdown,
  salesExtras,
  salesExtrasMonthly,
  salesHoverBreakdown,
  salesKpis,
  salesMonthly,
  type Dimension,
} from "@/lib/server/queries/sales";
import { companies } from "@/lib/server/queries/common";
import { salesFilterOptions } from "@/lib/server/queries/sales-filters";
import { ALL_OTHER, UNASSIGNED } from "@/lib/server/sql";
import { previousYear } from "@/lib/filters";
import { clipToBucket } from "@/lib/periods";

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

describe("salesperson and brand filters", () => {
  it("by brand, items without a brand are Unassigned", async () => {
    const rows = await salesBreakdown(Q1_2025, "brand");
    expect(rows.map((row) => [row.label, row.netRevenue])).toEqual([
      ["Brand One", 2800],
      [UNASSIGNED, 800],
      ["Brand Two", 500],
    ]);
  });

  it("one salesperson", async () => {
    const alice = { ...Q1_2025, salespeople: ["A1"] };
    expect((await salesKpis(alice)).netRevenue).toBeCloseTo(1300);
    expect((await salesKpis({ ...Q1_2025, salespeople: ["_none"] })).netRevenue).toBeCloseTo(800);
    expect((await salesKpis({ ...Q1_2025, salespeople: ["A1", "_none"] })).netRevenue).toBeCloseTo(2100);
    const months = await salesMonthly(alice);
    expect(months.map((row) => row.netRevenue)).toEqual([1500, -200, 0]);
    // Last year's comparison follows the same salesperson.
    expect(months.map((row) => row.lastYearNetRevenue)).toEqual([0, 600, 0]);
  });

  it("one brand, Unassigned brand, and both filters together", async () => {
    expect((await salesKpis({ ...Q1_2025, brands: ["B1"] })).netRevenue).toBeCloseTo(2800);
    expect((await salesKpis({ ...Q1_2025, brands: ["_none"] })).netRevenue).toBeCloseTo(800);
    const both = await salesKpis({ ...Q1_2025, salespeople: ["A1"], brands: ["B1"] });
    expect(both).toMatchObject({ netRevenue: 800, cost: 480, returnsValue: -200 });
  });

  it.each(Object.keys(DIMENSIONS) as Dimension[])(
    "%s still adds up to the KPIs with a salesperson and brand chosen",
    async (dimension) => {
      const filters = { ...Q1_2025, salespeople: ["A1", "B1"], brands: ["B1", "_none"] };
      const kpis = await salesKpis(filters);
      expect(kpis.netRevenue).toBeCloseTo(2800);
      const rows = await salesBreakdown(filters, dimension, 1);
      expect(rows.reduce((total, row) => total + row.netRevenue, 0)).toBeCloseTo(kpis.netRevenue);
    },
  );

  it("options cascade from the companies and the period", async () => {
    expect(await salesFilterOptions(Q1_2025)).toEqual({
      salespeople: [
        { code: "A1", name: "Alice" },
        { code: "B1", name: "Bob" },
        { code: "_none", name: UNASSIGNED },
      ],
      brands: [
        { code: "B1", name: "Brand One" },
        { code: "B2", name: "Brand Two" },
        { code: "_none", name: UNASSIGNED },
      ],
    });
    expect(await salesFilterOptions({ ...Q1_2025, companies: ["101"] })).toEqual({
      salespeople: [{ code: "A1", name: "Alice" }],
      brands: [
        { code: "B1", name: "Brand One" },
        { code: "B2", name: "Brand Two" },
      ],
    });
    expect(await salesFilterOptions({ ...Q1_2025, start: "2001-01-01", end: "2001-01-31" })).toEqual({
      salespeople: [],
      brands: [],
    });
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

/*
 * Active customers, discount and gross value, Q1 2025 (the rows listed at the top):
 *   CA: net 1000 + 500 − 200 = 1300, discount 100 + 0 − 20 = 80, gross 1100 + 500 − 220 = 1380
 *   CB: net 2000 + 0 = 2000, discount 200, gross 2200
 *   CU: net 800, discount 0, gross 800
 * Three active customers, discount 280 of gross 4380. In March CB has only the zero-value delivery
 * note, so it is not active that month.
 */
describe("customer and discount KPIs", () => {
  it("period totals", async () => {
    const result = await salesExtras(Q1_2025);
    expect(result.activeCustomers).toBe(3);
    expect(result.discount).toBeCloseTo(280);
    expect(result.grossValue).toBeCloseTo(4380);
    expect(result.discountPct).toBeCloseTo(280 / 4380);
  });

  it("gross − net = discount on the fixture, as on live Orion", async () => {
    const [kpis, extras] = await Promise.all([salesKpis(Q1_2025), salesExtras(Q1_2025)]);
    expect(extras.grossValue - kpis.netRevenue).toBeCloseTo(extras.discount);
  });

  it("per month", async () => {
    const months = await salesExtrasMonthly(Q1_2025);
    expect(months.map((month) => [month.month, month.activeCustomers])).toEqual([
      ["2025-01", 1],
      ["2025-02", 2],
      ["2025-03", 1],
    ]);
    expect(months.map((month) => month.discount)).toEqual([100, 180, 0]);
  });

  it("a fully returned customer is not active", async () => {
    // Customer A in February 2024: invoice 700, return −100 → active; one company, last year.
    expect((await salesExtras(previousYear(Q1_2025))).activeCustomers).toBe(1);
    expect((await salesExtras({ ...Q1_2025, start: "2030-01-01", end: "2030-01-31" })).activeCustomers).toBe(
      0,
    );
  });

  it("follows the company filter", async () => {
    const result = await salesExtras({ ...Q1_2025, companies: ["101"] });
    expect(result.activeCustomers).toBe(1);
    expect(result.discount).toBeCloseTo(80);
  });

  it("average invoice value is net revenue per invoice", async () => {
    expect(averageInvoiceValue(await salesKpis(Q1_2025))).toBeCloseTo(4100 / 3);
    expect(averageInvoiceValue({ netRevenue: 0, invoiceCount: 0 })).toBeNull();
  });

  it("the query only reads and binds every filter value", () => {
    const query = extrasQuery({ ...Q1_2025, companies: ["101"] }, true);
    expect(query.sql).toMatch(/^\s*SELECT/);
    expect(query.sql).not.toContain("101");
    expect(query.binds).toMatchObject({ start_date: "2025-01-01", company_0: "101" });
  });
});

describe("hover breakdown", () => {
  const sum = (rows: { netRevenue: number }[]) => rows.reduce((total, row) => total + row.netRevenue, 0);

  it("each month's slices add up to its bar", async () => {
    const months = await salesMonthly(Q1_2025);
    for (const month of months) {
      const clipped = clipToBucket(Q1_2025, month.month)!;
      const card = await salesHoverBreakdown(clipped, MONTH_CARD_DIMENSIONS);
      expect(card.netRevenue, month.month).toBeCloseTo(month.netRevenue);
      expect(card.lastYearNetRevenue, month.month).toBeCloseTo(month.lastYearNetRevenue);
      for (const { dimension, rows } of card.breakdowns) {
        expect(sum(rows), `${month.month} ${dimension}`).toBeCloseTo(month.netRevenue);
      }
    }
  });

  it("February by salesperson and company", async () => {
    const card = await salesHoverBreakdown(clipToBucket(Q1_2025, "2025-02")!, MONTH_CARD_DIMENSIONS);
    expect(card.netRevenue).toBeCloseTo(1800);
    expect(card.lastYearNetRevenue).toBeCloseTo(600);
    const byDimension = Object.fromEntries(card.breakdowns.map((entry) => [entry.dimension, entry.rows]));
    expect(byDimension.company.map((row) => [row.label, row.netRevenue])).toEqual([
      ["Beta Supplies", 2000],
      ["Alpha Trading", -200],
    ]);
    expect(byDimension.salesperson.map((row) => row.label)).toEqual(["Bob", "Alice"]);
  });

  it("a company bar's slices add up to the bar, Unassigned included", async () => {
    const companiesBars = await salesBreakdown(Q1_2025, "company");
    for (const bar of companiesBars) {
      const card = await salesHoverBreakdown(Q1_2025, COMPANY_CARD_DIMENSIONS, {
        dimension: "company",
        label: bar.label,
      });
      expect(card.netRevenue, bar.label).toBeCloseTo(bar.netRevenue);
      expect(card.breakdowns.map((entry) => entry.dimension)).toEqual(["salesperson", "itemGroup"]);
      for (const { rows } of card.breakdowns) expect(sum(rows), bar.label).toBeCloseTo(bar.netRevenue);
    }
    const beta = await salesHoverBreakdown(Q1_2025, COMPANY_CARD_DIMENSIONS, {
      dimension: "company",
      label: "Beta Supplies",
    });
    expect(beta.breakdowns[0].rows.map((row) => [row.label, row.netRevenue])).toEqual([
      ["Bob", 2000],
      [UNASSIGNED, 800],
    ]);
  });

  it("folds beyond the top 5 into All other", async () => {
    expect(HOVER_TOP_N).toBe(5);
    const query = breakdownQuery(Q1_2025, "salesperson", HOVER_TOP_N, {
      slice: { dimension: "company", label: "x' OR '1'='1" },
    });
    expect(query.sql).toContain(":slice_label");
    expect(query.sql).not.toContain("OR '1'='1");
    expect(query.binds).toMatchObject({ slice_label: "x' OR '1'='1", top_n: 5 });
  });
});
