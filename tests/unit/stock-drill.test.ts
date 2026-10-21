/**
 * The Inventory brand filter, and the month-end hover card and drill-down: every card section and
 * every drill-down adds up to the bar it came from, on the hand-checked fixture (see
 * inventory.test.ts for its rows) and on the full sample data.
 *
 * Brands come from tests/fixtures/ZF_STK_SO_PO_SL_BI.csv: I1 is Brand One (B1), I2 is Brand Two
 * (B2); I3, I4, I5 and I9 have no brand. Item groups come from ZF_ITEM: I1 and I5 are Group 1, I2
 * Group 2 (company 101), I3 Group 2 (company 102), I4 has none and I9 no item row.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { UNASSIGNED_CODE } from "@/lib/filters";
import { parseStockMonth } from "@/lib/inventory-drill";
import { setRunnerForTests } from "@/lib/server/db";
import { SampleSource } from "@/lib/server/sample";
import {
  deadStock,
  inventoryKpis,
  kpiQuery,
  monthEndHover,
  monthEndItems,
  monthEndQuery,
  monthEndTrend,
  reorderAlerts,
  stockBrandOptions,
  stockBreakdown,
} from "@/lib/server/queries/inventory";
import { ALL_OTHER, UNASSIGNED } from "@/lib/server/sql";

import { useFixtureSource } from "./fixture";

const TODAY = "2026-01-20";
const ALL = { companies: [] as string[], brands: [] as string[] };

const sum = (values: number[]) => values.reduce((total, value) => total + value, 0);

describe("on the fixture", () => {
  beforeAll(() => {
    useFixtureSource();
  });
  afterAll(() => setRunnerForTests(undefined));

  describe("brand filter", () => {
    it("leaves the SQL unchanged when no brand is set", () => {
      expect(kpiQuery({ companies: ["101"], brands: [] })).toEqual(kpiQuery(["101"]));
      expect(monthEndQuery(ALL, TODAY)).toEqual(monthEndQuery([], TODAY));
    });

    it("narrows live stock to the brand's items", async () => {
      // I1 is the only Brand One item: 100 + 50 in live stock.
      expect((await inventoryKpis({ companies: [], brands: ["B1"] })).stockValue).toBeCloseTo(150, 6);
      // I2: 100.
      expect((await inventoryKpis({ companies: [], brands: ["B2"] })).stockValue).toBeCloseTo(100, 6);
    });

    it("takes Unassigned as the items without a brand, and the brands add up to everything", async () => {
      const all = (await inventoryKpis([])).stockValue;
      const parts = await Promise.all(
        [["B1"], ["B2"], [UNASSIGNED_CODE]].map(
          async (brands) => (await inventoryKpis({ companies: [], brands })).stockValue,
        ),
      );
      expect(sum(parts)).toBeCloseTo(all, 6);
      expect(parts[2]).toBeCloseTo(60 + 100 + 30 + 100, 6);
    });

    it("applies to every section", async () => {
      const scope = { companies: [], brands: ["B1"] };
      expect(sum((await stockBreakdown(scope, "company")).map((row) => row.value))).toBeCloseTo(150, 6);
      const trend = await monthEndTrend(scope, TODAY, 3);
      // I1's closing quantity is 1, 2, … 13 over the 13 periods.
      expect(trend.map((month) => month.closeQty)).toEqual([11, 12, 13]);
      expect((await deadStock(scope, 3, TODAY)).count).toBe(0);
      expect(await reorderAlerts({ companies: [], brands: ["B2"] })).toEqual([]);
      expect((await reorderAlerts({ companies: [], brands: [UNASSIGNED_CODE] })).length).toBeGreaterThan(0);
    });

    it("offers the brands of items in live stock", async () => {
      const options = await stockBrandOptions([]);
      expect(options.map((option) => option.code).sort()).toEqual(["B1", "B2", UNASSIGNED_CODE].sort());
      expect(options.find((option) => option.code === "B1")?.name).toBe("Brand One");
      expect((await stockBrandOptions(["102"])).map((option) => option.code)).toEqual([UNASSIGNED_CODE]);
    });
  });

  describe("month-end hover", () => {
    it("adds up to the bar in every section, for every month", async () => {
      for (const scope of [ALL, { companies: ["101"], brands: [] }, { companies: [], brands: ["B1"] }]) {
        const trend = await monthEndTrend(scope, TODAY, 13);
        for (const month of trend) {
          const card = await monthEndHover(scope, month.month);
          expect(card.closeValue).toBeCloseTo(month.closeValue, 6);
          expect(card.breakdowns.map((breakdown) => breakdown.dimension)).toEqual([
            "company",
            "brand",
            "itemGroup",
          ]);
          for (const breakdown of card.breakdowns) {
            expect(sum(breakdown.rows.map((row) => row.value))).toBeCloseTo(month.closeValue, 6);
          }
        }
      }
    });

    it("compares with the same month-end a year earlier", async () => {
      const trend = await monthEndTrend([], TODAY, 13);
      const card = await monthEndHover(ALL, "2026-01");
      expect(card.lastYearCloseValue).toBeCloseTo(trend[0].closeValue, 6);
      // No month-end in 2024: nothing to compare with.
      expect((await monthEndHover(ALL, "2025-06")).lastYearCloseValue).toBe(0);
    });

    it("names companies, brands and item groups, and shows blanks as Unassigned", async () => {
      const card = await monthEndHover(ALL, "2026-01");
      const labels = (dimension: string) =>
        card.breakdowns.find((breakdown) => breakdown.dimension === dimension)!.rows.map((row) => row.label);
      expect(labels("company")).toEqual(expect.arrayContaining(["Alpha Trading"]));
      expect(labels("brand")).toEqual(expect.arrayContaining(["Brand One", "Brand Two", UNASSIGNED]));
      expect(labels("itemGroup")).toEqual(expect.arrayContaining(["Group 1", "Group 2"]));
      expect(labels("brand")).not.toContain(ALL_OTHER);
    });
  });

  describe("month-end drill-down", () => {
    it("lists the bar's items, adding up to the bar", async () => {
      for (const month of await monthEndTrend([], TODAY, 13)) {
        const items = await monthEndItems(ALL, month.month);
        expect(items.closeValue).toBeCloseTo(month.closeValue, 6);
        expect(sum(items.rows.map((row) => row.closeValue))).toBeCloseTo(month.closeValue, 6);
        expect(items.count).toBe(items.rows.length);
      }
    });

    it("keeps the total of every item when it lists only the largest", async () => {
      const all = await monthEndItems(ALL, "2026-01");
      const top = await monthEndItems(ALL, "2026-01", 1);
      expect(top.rows).toHaveLength(1);
      expect(top.count).toBe(all.count);
      expect(top.closeValue).toBeCloseTo(all.closeValue, 6);
      expect(top.rows[0]).toEqual(all.rows[0]);
    });

    it("carries the brand and item group of each item", async () => {
      const { rows } = await monthEndItems(ALL, "2026-01");
      expect(rows.find((row) => row.itemCode === "I1")).toMatchObject({
        brand: "Brand One",
        itemGroup: "Group 1",
        company: "Alpha Trading",
      });
      expect(rows.find((row) => row.itemCode === "I3")).toMatchObject({ brand: UNASSIGNED });
    });

    it("validates the month parameter", () => {
      expect(parseStockMonth("2026-09")).toBe("2026-09");
      for (const value of ["2026-13", "2026-9", "202609", "", null, "2026-09' OR 1=1"]) {
        expect(parseStockMonth(value)).toBeNull();
      }
    });
  });
});

describe("on the sample data", () => {
  const today = new Date().toISOString().slice(0, 10);
  beforeAll(() => {
    const source = new SampleSource({
      rebaseToYear: Number(today.slice(0, 4)),
      rebaseToMonth: today.slice(0, 7),
    });
    setRunnerForTests((sql, binds) => source.query(sql, binds));
  });
  afterAll(() => setRunnerForTests(undefined));

  it("every month-end card and drill-down adds up to its bar", async () => {
    const trend = await monthEndTrend([], today);
    expect(trend.length).toBeGreaterThan(3);
    for (const month of trend) {
      const [card, items] = await Promise.all([
        monthEndHover(ALL, month.month),
        monthEndItems(ALL, month.month),
      ]);
      expect(card.closeValue).toBeCloseTo(month.closeValue, 4);
      for (const breakdown of card.breakdowns) {
        expect(sum(breakdown.rows.map((row) => row.value))).toBeCloseTo(month.closeValue, 4);
        expect(breakdown.rows.length).toBeLessThanOrEqual(6);
      }
      expect(items.closeValue).toBeCloseTo(month.closeValue, 4);
    }
  });
});
