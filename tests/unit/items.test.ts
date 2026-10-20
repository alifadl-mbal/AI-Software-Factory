/**
 * The item page's queries against values worked out by hand from the fixtures. Each figure is also
 * checked against the dashboard row it must equal.
 *
 * tests/fixtures/ZF_ITEM.csv: I1 has a row in 101 (no planning, active) and 102 (min 1, max 20,
 * reorder at 4, qty 8, 30 days, frozen); IX and IX2 share the name "Item X"; "A/B #1&2" has URL and
 * LIKE special characters.
 *
 * I1 under one code: stock in 101 / Main Store 10 + 5 units (2 reserved) at 10 = 150; one sale of
 * 12 units on 2024-11-15; pending PO LPO-5001 (10 units, AED 1,000, dated 2025-04-08); open orders
 * SO5-1001 (10 to deliver) and SO5-1005 (3 to deliver); SO5-1002 is delivered (none pending).
 *
 * IX sales, Q1 2025: CA 10 units 1000 (cost 600), CB 20 units 2000 (cost 1500), CA return −2 units
 * −200 (cost −120): 28 units, revenue 2800, margin 820. Q1 2024: 7 − 1 = 6 units, revenue 600.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { previousYear } from "@/lib/filters";
import { averageMonthlyQty, itemHref, isItemPath, monthsOfCover } from "@/lib/items";
import { setRunnerForTests } from "@/lib/server/db";
import {
  inventoryKpis,
  monthEndTrend,
  reorderAlerts,
  reorderAlertsQuery,
  stockByLocation,
} from "@/lib/server/queries/inventory";
import {
  isItemCode,
  item,
  itemCodesByName,
  itemCodesByNameQuery,
  itemByRouteParam,
  itemCover,
  itemSearchQuery,
  planningDiffers,
  searchItems,
} from "@/lib/server/queries/items";
import { itemPending, itemPendingQuery, pendingKpis } from "@/lib/server/queries/purchasing";
import { itemOpenBook, openBookKpis } from "@/lib/server/queries/sales-orders";
import { kpiQuery, salesBreakdown, salesKpis, salesMonthly } from "@/lib/server/queries/sales";
import { ALL_OTHER, UNASSIGNED } from "@/lib/server/sql";

import { Q1_2025, useFixtureSource } from "./fixture";

const TODAY = "2025-06-30";
const ALL: string[] = [];

beforeAll(() => {
  useFixtureSource();
});
afterAll(() => setRunnerForTests(undefined));

describe("months of cover", () => {
  it("is available stock over the average monthly quantity", () => {
    expect(averageMonthlyQty(24)).toBe(2);
    expect(monthsOfCover(13, 1)).toBe(13);
    expect(monthsOfCover(5, 2)).toBe(2.5);
  });

  it("is 'no recent sales' (null) without sales, and never negative", () => {
    expect(monthsOfCover(5, 0)).toBeNull();
    expect(monthsOfCover(0, 0)).toBeNull();
    // Returns outweighing sales leave no rate to divide by either.
    expect(monthsOfCover(5, -1)).toBeNull();
    expect(monthsOfCover(-3, 2)).toBe(0);
    expect(monthsOfCover(0, 2)).toBe(0);
  });

  it("of a hand-checked item: 13 available ÷ (12 sold in 12 months ÷ 12) = 13 months", async () => {
    expect(await itemCover(ALL, TODAY, "I1")).toEqual({
      available: 13,
      soldLast12Months: 12,
      averageMonthly: 1,
      months: 13,
    });
  });

  it("of items with no recent sales, or no stock", async () => {
    // I1's only sale is older than 12 months on 2026-01-01.
    expect((await itemCover(ALL, "2026-01-01", "I1")).months).toBeNull();
    // Company 102 holds no I1 and sold none.
    expect(await itemCover(["102"], TODAY, "I1")).toEqual({
      available: 0,
      soldLast12Months: 0,
      averageMonthly: 0,
      months: null,
    });
    // IX sold 28 + 3 units in the year to today but has no stock: no cover at all.
    const ix = await itemCover(ALL, TODAY, "IX");
    expect(ix.soldLast12Months).toBe(31);
    expect(ix.averageMonthly).toBeCloseTo(31 / 12);
    expect(ix.months).toBe(0);
  });
});

describe("item master", () => {
  it("reads every company's row, with its planning fields and flags", async () => {
    const one = await item("I1");
    expect(one).toEqual({
      code: "I1",
      name: "Item One",
      group: "Group 1",
      companies: [
        {
          companyCode: "101",
          frozen: false,
          stockItem: true,
          minStock: 0,
          maxStock: 0,
          reorderLevel: 0,
          reorderQty: 0,
          leadTimeDays: 0,
        },
        {
          companyCode: "102",
          frozen: true,
          stockItem: true,
          minStock: 1,
          maxStock: 20,
          reorderLevel: 4,
          reorderQty: 8,
          leadTimeDays: 30,
        },
      ],
    });
    expect(planningDiffers(one!.companies)).toBe(true);
    expect(planningDiffers(one!.companies.slice(0, 1))).toBe(false);
    expect((await item("I4"))!.companies[0]).toMatchObject({ leadTimeDays: null });
    expect((await item("I4"))!.group).toBeNull();
  });

  it("reads the route segment whether Next.js decoded it or not", async () => {
    expect((await itemByRouteParam("A/B #1&2"))?.code).toBe("A/B #1&2");
    expect((await itemByRouteParam("A%2FB%20%231%262"))?.code).toBe("A/B #1&2");
    expect(await itemByRouteParam("NOPE%2F1")).toBeNull();
    expect(await itemByRouteParam("%E0%A4%A")).toBeNull();
  });

  it("finds codes with URL and LIKE characters, and nothing for unknown or malformed codes", async () => {
    expect((await item("A/B #1&2"))?.name).toBe("Bolt 100% steel_x");
    expect(await item("NOPE")).toBeNull();
    expect(await item("i1")).toBeNull();
    for (const code of ["", "   ", "X".repeat(21), "a\u0000b"]) {
      expect(isItemCode(code), JSON.stringify(code)).toBe(false);
      expect(await item(code)).toBeNull();
    }
    // Orion has codes with a leading space.
    expect(isItemCode(" 122AIM-0376")).toBe(true);
  });

  it("links keep the filters and encode the code", () => {
    expect(itemHref("A/B #1&2", "?range=12m")).toBe("/items/A%2FB%20%231%262?range=12m");
    expect(itemHref("I1", { range: "ytd", start: "2025-01-01", end: "2025-06-30", companies: ["101"] })).toBe(
      "/items/I1?company=101",
    );
    expect(isItemPath("/items/I1")).toBe(true);
    expect(isItemPath("/inventory")).toBe(false);
  });
});

describe("search", () => {
  it("finds items by part of the description, case-insensitive, one result per code", async () => {
    expect(await searchItems("item x")).toEqual([
      { kind: "item", code: "IX", name: "Item X", detail: "Group 1" },
      { kind: "item", code: "IX2", name: "Item X", detail: "Group 2" },
    ]);
    // I1 has two master rows but is one result.
    expect((await searchItems("item one")).map((result) => result.code)).toEqual(["I1"]);
  });

  it("puts the exact code first, then code and description prefixes", async () => {
    expect((await searchItems("i1"))[0].code).toBe("I1");
    expect((await searchItems("ix")).map((result) => result.code)).toEqual(["IX", "IX2"]);
  });

  it("takes LIKE wildcards literally and binds everything", async () => {
    expect((await searchItems("100%")).map((result) => result.code)).toEqual(["A/B #1&2"]);
    expect((await searchItems("_x")).map((result) => result.code)).toEqual(["A/B #1&2"]);
    for (const text of ["' OR '1'='1", "x'); DROP TABLE t --"]) {
      const { sql } = itemSearchQuery(text);
      expect(sql).not.toContain(text);
      expect(await searchItems(text)).toEqual([]);
    }
    expect(itemSearchQuery("abc").binds.row_limit).toBe(20);
  });
});

describe("codes for the item names on the dashboards", () => {
  it("links a name only when one code carries it, however many companies list it", async () => {
    const codes = await itemCodesByName(["Item X", "Item One", "Item Y", "Nobody", ALL_OTHER, UNASSIGNED]);
    expect(Object.fromEntries(codes)).toEqual({ "Item One": "I1", "Item Y": "IY" });
    expect(itemCodesByNameQuery(["Item Y"]).binds).toEqual({ name_0: "Item Y" });
    expect(await itemCodesByName([])).toEqual(new Map());
  });
});

describe("sales of one item", () => {
  const scope = { item: "IX" };

  it("KPIs equal the item's row in Sales top items", async () => {
    const kpis = await salesKpis(Q1_2025, scope);
    const row = (await salesBreakdown(Q1_2025, "item")).find((entry) => entry.label === "Item X");
    expect(kpis.quantity).toBe(28);
    expect(kpis.netRevenue).toBeCloseTo(2800);
    expect(kpis.grossMargin).toBeCloseTo(820);
    expect(kpis.netRevenue).toBeCloseTo(row!.netRevenue);
    expect(kpis.grossMargin).toBeCloseTo(row!.grossMargin);
    expect(kpis.quantity).toBe(row!.quantity);
    const lastYear = await salesKpis(previousYear(Q1_2025), scope);
    expect(lastYear.quantity).toBe(6);
    expect(lastYear.netRevenue).toBeCloseTo(600);
    expect((await salesKpis(Q1_2025, { item: "NOPE" })).quantity).toBe(0);
  });

  it("the monthly trend and top customers add up to the KPIs", async () => {
    const months = await salesMonthly(Q1_2025, scope);
    expect(months.map((month) => month.quantity)).toEqual([10, 18, 0]);
    expect(months.map((month) => month.lastYearQuantity)).toEqual([0, 6, 0]);
    expect(months.map((month) => month.netRevenue)).toEqual([1000, 1800, 0]);
    const customers = await salesBreakdown(Q1_2025, "customer", 15, scope);
    expect(customers.map((row) => [row.label, row.quantity, row.netRevenue])).toEqual([
      ["Customer B", 20, 2000],
      ["Customer A", 8, 800],
    ]);
    const folded = await salesBreakdown(Q1_2025, "customer", 1, scope);
    expect(folded.map((row) => [row.label, row.quantity])).toEqual([
      ["Customer B", 20],
      [ALL_OTHER, 8],
    ]);
  });

  it("binds the code, and narrows by customer and item together", async () => {
    const { sql, binds } = kpiQuery(Q1_2025, { item: "IX'--" });
    expect(sql).toContain("CSL_ITEM_CODE = :item_code");
    expect(sql).not.toContain("IX'--");
    expect(binds.item_code).toBe("IX'--");
    expect(kpiQuery(Q1_2025).sql).not.toContain("item_code");
    expect((await salesKpis(Q1_2025, { customer: "CA", item: "IX" })).quantity).toBe(8);
  });
});

describe("stock of one item", () => {
  it("per company and location, with on hand = available + reserved", async () => {
    expect(await stockByLocation(ALL, "I1")).toEqual([
      {
        companyCode: "101",
        company: "Alpha Trading",
        locationCode: "L1",
        location: "Main Store",
        qty: 15,
        availableQty: 13,
        reservedQty: 2,
        value: 150,
        availableValue: 130,
        reservedValue: 20,
      },
    ]);
    expect(await stockByLocation(["102"], "I1")).toEqual([]);
  });

  it("every item's stock adds up to the Inventory KPIs: each is its share", async () => {
    const codes = ["I1", "I2", "I3", "I4", "I5", "I9"];
    const rows = (await Promise.all(codes.map((code) => stockByLocation(ALL, code)))).flat();
    const kpis = await inventoryKpis(ALL);
    expect(rows.reduce((sum, row) => sum + row.value, 0)).toBeCloseTo(kpis.stockValue);
    expect(rows.reduce((sum, row) => sum + row.availableValue, 0)).toBeCloseTo(kpis.availableValue);
  });

  it("month-end history of the item", async () => {
    const months = await monthEndTrend(ALL, "2026-01-20", 24, "I1");
    expect(months.at(-1)).toMatchObject({ month: "2026-01", closeQty: 13, closeValue: 130 });
    // Every period of the dashboard's trend, narrowed to the item.
    const all = await monthEndTrend(ALL, "2026-01-20");
    expect(months.map((month) => month.month)).toEqual(all.map((month) => month.month));
  });

  it("reorder alerts by the same rule as Inventory's", async () => {
    const mine = await reorderAlerts(ALL, "I5");
    expect(mine.map((alert) => [alert.location, alert.available, alert.reorderLevel])).toEqual([
      ["Main Store", 6, 6],
    ]);
    expect(mine).toEqual((await reorderAlerts(ALL)).filter((alert) => alert.itemCode === "I5"));
    expect(await reorderAlerts(ALL, "I1")).toEqual([]);
    expect(reorderAlertsQuery(ALL, "I5").binds).toEqual({ item_code: "I5" });
  });
});

describe("POs and open orders of one item", () => {
  it("pending PO lines with the expected date (PO date + 84), adding up to the KPI", async () => {
    const pending = await itemPending(ALL, TODAY, "I1");
    expect(pending).toEqual({
      lines: 1,
      pendingQty: 10,
      pendingValue: 1000,
      rows: [
        {
          companyCode: "101",
          poNumber: "LPO-5001",
          supplier: "Supplier One",
          poDate: "2025-04-08",
          expectedDate: "2025-07-01",
          daysOverdue: null,
          pendingQty: 10,
          pendingValue: 1000,
        },
      ],
    });
    // LPO-5002 (I2) is due today: overdue by 0 days.
    expect((await itemPending(ALL, TODAY, "I2")).rows[0]).toMatchObject({ daysOverdue: 0, pendingQty: 5 });
    expect(itemPendingQuery(ALL, TODAY, "I1").binds).toMatchObject({ item_code: "I1", row_limit: 200 });
  });

  it("each item's pending value is its share of the Purchasing KPI", async () => {
    const codes = ["I1", "I2", "I3", "I4", "I5", "I6", "I7", "I8"];
    const values = await Promise.all(codes.map((code) => itemPending(ALL, TODAY, code)));
    const kpis = await pendingKpis(ALL, TODAY);
    expect(values.reduce((sum, entry) => sum + entry.pendingValue, 0)).toBeCloseTo(kpis.pendingValue);
  });

  it("open order lines still to deliver, largest first, without Closed orders", async () => {
    const book = await itemOpenBook(ALL, TODAY, "I1");
    expect(book.lines).toBe(2);
    expect(book.pendingQty).toBe(13);
    expect(
      book.rows.map((line) => [line.orderNumber, line.customerCode, line.pendingQty, line.expectedDate]),
    ).toEqual([
      ["SO5-1001", "CA", 10, "2025-07-25"],
      ["SO5-1005", "SC0003", 3, "2025-07-10"],
    ]);
    // I6 is only on a Closed order; I5's order is in USD and still counts by quantity.
    expect((await itemOpenBook(ALL, TODAY, "I6")).lines).toBe(0);
    expect(await itemOpenBook(ALL, TODAY, "I5")).toMatchObject({ lines: 1, pendingQty: 10 });
    expect((await itemOpenBook(ALL, TODAY, "I5")).rows[0]).toMatchObject({
      currency: "USD",
      daysOverdue: 288,
    });
    // The book's other filters still apply.
    expect((await openBookKpis(ALL, TODAY, { item: "I1" })).openLines).toBe(book.lines);
  });
});
