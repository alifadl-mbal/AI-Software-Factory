/**
 * Inventory numbers against values worked out by hand from the fixtures in tests/fixtures/.
 *
 * ZF_CURR_STK_BI (live stock; value = CS_VAL, available value = (qty − reserved) × WAC):
 *
 *     101 L1 Main Store    I1  grade 'A'      qty 10 resv 2  wac 10  value 100  available 80
 *     101 L1 Main Store    I1  grade 'A   '   qty  5         wac 10  value  50  available 50  (padded)
 *     101 L2 Second Store  I2  grade 'B'      qty  4         wac 25  value 100                (frozen, level 10)
 *     101 L1 Main Store    I9  grade 'A'      qty  3 resv 1  wac 20  value  60  available 40  (no item row)
 *     102 L3 Beta Store    I3  grade 'B'      qty  2         wac 50  value 100                (active, level 5)
 *     102 L3 Beta Store    I4  grade 'A'      qty  0                 value   0                (blank group)
 *     101 L1 Main Store    I5  grade 'A'      qty  6         wac  5  value  30                (active, level 6)
 *     101 L2 Second Store  I5  grade 'A'      qty 20         wac  5  value 100
 *
 * ZF_STK_MTH_SUMM_BI, 13 periods 202501..202601 (closing qty):
 *
 *     101 L1 I1  1, 2, … 13: moves every month
 *     101 L2 I2  4 throughout (value 100): still for 12 months
 *     102 L3 I3  5 until 202506, then 2 (value 100): still for 6 months, not 12
 *     101 L1 I5  8 until 202509, then 6 (value 30): still for 3 months, not 6
 *     101 L1 I9  0 throughout: nothing on hand, never dead
 *     102 L3 I4  7 from 202511 only: too new for even the 3-month check
 */
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { setRunnerForTests } from "@/lib/server/db";
import { SampleSource } from "@/lib/server/sample";
import {
  breakdownQuery,
  deadStock,
  deadStockQuery,
  fromPeriod,
  inventoryKpis,
  monthEndQuery,
  monthEndTrend,
  parseDeadStockMonths,
  periodToMonth,
  reorderAlerts,
  stockBreakdown,
  type InventoryDimension,
} from "@/lib/server/queries/inventory";
import { ALL_OTHER, UNASSIGNED } from "@/lib/server/sql";

import { FIXTURE_DIR, useFixtureSource } from "./fixture";

/** A day in the fixture's newest period, 202601. */
const TODAY = "2026-01-20";

beforeAll(() => {
  useFixtureSource();
});
afterAll(() => setRunnerForTests(undefined));

describe("inventory KPIs", () => {
  it("all companies", async () => {
    const kpis = await inventoryKpis([]);
    expect(kpis.stockValue).toBeCloseTo(540);
    expect(kpis.availableValue).toBeCloseTo(500);
    expect(kpis.reservedValue).toBeCloseTo(40);
    // 101-I1, 101-I2, 101-I9, 101-I5, 102-I3. 102-I4 has nothing on hand.
    expect(kpis.stockedItems).toBe(5);
    expect(kpis.frozenValue).toBeCloseTo(100);
  });

  it("still counts the stock row with no item master match", async () => {
    const kpis = await inventoryKpis([]);
    expect(kpis.unmatchedValue).toBeCloseTo(60);
    // An INNER JOIN would drop I9: 480 and 4 items.
    expect(kpis.stockValue).toBeCloseTo(540);
    expect(kpis.stockedItems).toBe(5);
  });

  it("one company", async () => {
    const kpis = await inventoryKpis(["101"]);
    expect(kpis.stockValue).toBeCloseTo(440);
    expect(kpis.availableValue).toBeCloseTo(400);
    expect(kpis.stockedItems).toBe(4);
    expect((await inventoryKpis(["102"])).stockValue).toBeCloseTo(100);
  });

  it("an unknown company gives zeros", async () => {
    const kpis = await inventoryKpis(["999"]);
    expect(kpis.stockValue).toBe(0);
    expect(kpis.stockedItems).toBe(0);
  });
});

describe("stock value breakdowns", () => {
  it("trims the space-padded grade", async () => {
    expect(breakdownQuery([], "grade").sql).toContain("TRIM(s.CS_GRADE)");
    const grades = await stockBreakdown([], "grade");
    // 'A' and 'A   ' are one grade: 100 + 50 + 60 + 0 + 30 + 100.
    expect(grades.map((row) => [row.label, row.value])).toEqual([
      ["A", 340],
      ["B", 200],
    ]);
  });

  it("by company, shown by name", async () => {
    const rows = await stockBreakdown([], "company");
    expect(rows.map((row) => [row.label, row.value])).toEqual([
      ["Alpha Trading", 440],
      ["Beta Supplies", 100],
    ]);
  });

  it("by location", async () => {
    const rows = await stockBreakdown([], "location");
    expect(rows.map((row) => [row.label, row.value])).toEqual([
      ["Main Store", 240],
      ["Second Store", 200],
      ["Beta Store", 100],
    ]);
  });

  it("by item group keeps blanks as Unassigned, including the unmatched item", async () => {
    const rows = await stockBreakdown([], "itemGroup");
    expect(rows.map((row) => [row.label, row.value])).toEqual([
      ["Group 1", 340],
      ["Group 2", 200],
      [UNASSIGNED, 0],
    ]);
  });

  it.each(["company", "location", "itemGroup", "grade"] as InventoryDimension[])(
    "%s adds up to the stock value, with and without top N",
    async (dimension) => {
      for (const rows of [await stockBreakdown([], dimension), await stockBreakdown([], dimension, 1)]) {
        expect(rows.reduce((total, row) => total + row.value, 0)).toBeCloseTo(540);
      }
    },
  );

  it("top N folds the rest into All other", async () => {
    const rows = await stockBreakdown([], "location", 1);
    expect(rows.map((row) => [row.label, row.value])).toEqual([
      ["Main Store", 240],
      [ALL_OTHER, 300],
    ]);
  });
});

describe("month-end trend", () => {
  it("returns the newest periods oldest first, as YYYY-MM", async () => {
    const months = await monthEndTrend([], TODAY, 3);
    expect(months.map(({ month, closeValue }) => ({ month, closeValue }))).toEqual([
      { month: "2025-11", closeValue: 410 },
      { month: "2025-12", closeValue: 420 },
      { month: "2026-01", closeValue: 430 },
    ]);
  });

  it("asks for 24 periods by default and gets every one the fixture has", async () => {
    const months = await monthEndTrend([], TODAY);
    expect(months).toHaveLength(13);
    expect(months[0]).toEqual({ month: "2025-01", closeValue: 400, negativeValue: 0, negativeLines: 0 });
  });

  it("applies the company filter", async () => {
    const [latest] = (await monthEndTrend(["101"], TODAY, 1)).slice(-1);
    // I1 13 × 10 + I2 100 + I5 30 + I9 0.
    expect(latest).toEqual({ month: "2026-01", closeValue: 260, negativeValue: 0, negativeLines: 0 });
  });

  // Live Orion: ranking every distinct period of the 8M-row view took 3.4 s; the trend needs 2 years.
  it("reads only the months it needs, from a bound worked out from today", () => {
    expect(fromPeriod("2026-10-20", 24)).toBe("202408");
    expect(fromPeriod("2026-01-20", 3)).toBe("202508");
    const { sql, binds } = monthEndQuery([], "2026-10-20");
    expect(binds).toEqual({ from_period: "202408", period_count: 24 });
    expect(sql).toContain("WHERE ZSL_PERIOD >= :from_period");
    expect(sql).toContain("WHERE z.ZSL_PERIOD >= :from_period AND p.rn <= :period_count");
  });

  it("still finds the newest periods when the newest month-end run is late", async () => {
    // The fixture ends at 202601; three months on it is still the newest period.
    const months = await monthEndTrend([], "2026-04-05", 2);
    expect(months.map((month) => month.month)).toEqual(["2025-12", "2026-01"]);
  });

  // Live Orion: the closing view had 392 lines below zero at the last close, worth a negative 3.6M
  // inside the month-end value. They now come back separately so the page can say so.
  it("reports lines with a negative closing quantity, which stay in the closing value", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "mbal-negative-stock-"));
    writeFileSync(
      path.join(dir, "ZF_STK_MTH_SUMM_BI.csv"),
      [
        "ZSL_PERIOD,ZSL_COMP_CODE,ZSL_LOCN_CODE,ZSL_ITEM_CODE,ZSL_CLOSE_QTY,ZSL_CLOSE_VAL",
        "202601,101,L1,I1,10,100",
        "202601,101,L1,I2,-3,-30",
        "202601,101,L2,I3,-1,-5",
        "202601,101,L2,I4,0,-2",
      ].join("\n"),
    );
    const source = new SampleSource({ fixtureDir: dir, rebaseToYear: null });
    setRunnerForTests((sql, binds) => source.query(sql, binds));
    try {
      expect(await monthEndTrend([], TODAY, 1)).toEqual([
        // A zero quantity with a leftover value is not negative stock.
        { month: "2026-01", closeValue: 63, negativeValue: -35, negativeLines: 2 },
      ]);
    } finally {
      useFixtureSource();
    }
  });
});

describe("dead stock", () => {
  it("3 months: no movement over the newest 4 periods", async () => {
    const result = await deadStock([], 3, TODAY);
    expect(result.rows.map((row) => row.itemCode)).toEqual(["I2", "I3", "I5"]);
    expect(result.count).toBe(3);
    expect(result.value).toBeCloseTo(230);
    expect(result.asOfMonth).toBe("2026-01");
  });

  it("6 months: the item still since July 2025 is dead, the one still since October isn't", async () => {
    const result = await deadStock([], 6, TODAY);
    expect(
      result.rows.map((row) => [row.itemCode, row.company, row.location, row.closeQty, row.closeValue]),
    ).toEqual([
      ["I2", "Alpha Trading", "Second Store", 4, 100],
      ["I3", "Beta Supplies", "Beta Store", 2, 100],
    ]);
    expect(result.count).toBe(2);
    expect(result.value).toBeCloseTo(200);
  });

  it("12 months: only the item that never moved", async () => {
    const result = await deadStock([], 12, TODAY);
    expect(result.rows.map((row) => row.itemCode)).toEqual(["I2"]);
    expect(result.value).toBeCloseTo(100);
  });

  it("never lists stock that moves, is empty, or is too new to judge", async () => {
    for (const months of [3, 6, 12] as const) {
      const codes = (await deadStock([], months, TODAY)).rows.map((row) => row.itemCode);
      expect(codes).not.toContain("I1");
      expect(codes).not.toContain("I9");
      expect(codes).not.toContain("I4");
    }
  });

  it("totals cover every dead item even when the list is cut short", async () => {
    const result = await deadStock([], 3, TODAY, 1);
    expect(result.rows).toHaveLength(1);
    expect(result.count).toBe(3);
    expect(result.value).toBeCloseTo(230);
  });

  it("applies the company filter", async () => {
    const result = await deadStock(["102"], 6, TODAY);
    expect(result.rows.map((row) => row.itemCode)).toEqual(["I3"]);
    expect(result.value).toBeCloseTo(100);
  });

  it("checks months + 1 periods, bound as variables", () => {
    expect(deadStockQuery(["101"], 6, TODAY).binds).toEqual({
      company_0: "101",
      from_period: "202504",
      period_count: 7,
      top_n: 100,
    });
  });

  it("no closing data gives an empty result", async () => {
    const result = await deadStock(["999"], 6, TODAY);
    expect(result).toEqual({ months: 6, asOfMonth: null, count: 0, value: 0, rows: [] });
  });
});

describe("reorder alerts", () => {
  it("lists active items at or below their reorder level, per location", async () => {
    const alerts = await reorderAlerts([]);
    expect(alerts).toEqual([
      {
        companyCode: "102",
        company: "Beta Supplies",
        locationCode: "L3",
        location: "Beta Store",
        itemCode: "I3",
        item: "Item Three",
        available: 2,
        reorderLevel: 5,
        reorderQty: 20,
      },
      {
        companyCode: "101",
        company: "Alpha Trading",
        locationCode: "L1",
        location: "Main Store",
        itemCode: "I5",
        item: "Item Five",
        available: 6,
        reorderLevel: 6,
        reorderQty: 12,
      },
    ]);
  });

  it("the frozen item below its reorder level does not alert", async () => {
    const codes = (await reorderAlerts([])).map((alert) => alert.itemCode);
    // I2: 4 on hand against a level of 10, but frozen.
    expect(codes).not.toContain("I2");
  });

  it("items with no reorder level, or no item row, never alert", async () => {
    const codes = (await reorderAlerts([])).map((alert) => alert.itemCode);
    expect(codes).not.toContain("I4");
    expect(codes).not.toContain("I9");
  });

  it("applies the company filter", async () => {
    expect((await reorderAlerts(["101"])).map((alert) => alert.itemCode)).toEqual(["I5"]);
  });
});

describe("helpers", () => {
  it("periodToMonth handles numbers and CHAR periods", () => {
    expect(periodToMonth(202604)).toBe("2026-04");
    expect(periodToMonth("202604")).toBe("2026-04");
  });

  it("parseDeadStockMonths falls back to 6", () => {
    expect(parseDeadStockMonths("3")).toBe(3);
    expect(parseDeadStockMonths(["12"])).toBe(12);
    expect(parseDeadStockMonths("7")).toBe(6);
    expect(parseDeadStockMonths(undefined)).toBe(6);
  });
});

describe("sample mode periods", () => {
  it("rebases YYYYMM periods so the newest is the given month, across a year end", async () => {
    const source = new SampleSource({ fixtureDir: FIXTURE_DIR, rebaseToMonth: "2026-10" });
    const rows = await source.query(
      "SELECT MIN(ZSL_PERIOD) AS first_period, MAX(ZSL_PERIOD) AS last_period FROM MBALI.ZF_STK_MTH_SUMM_BI",
    );
    // 202501..202601 is 13 periods; shifted by 9 months they end on 202610.
    expect(rows[0]).toEqual({ first_period: 202510, last_period: 202610 });
  });
});
