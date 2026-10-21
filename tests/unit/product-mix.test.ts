/**
 * The Product mix page against tests/fixtures/ZF_CSL_BI.csv (see sales.test.ts for the rows).
 *
 * Q1 2025 per item code: IX (Brand One) 1000 + 2000 − 200 = 2800, cost 600 + 1500 − 120 = 1980;
 * IY (Brand Two) 500, cost 300; IZ (no brand: Unassigned) 0 + 800 = 800, cost 400 + 0.
 * Q1 2024: IX 700 − 100 = 600; nothing else. So IX is +366.7% and IY and IZ are new.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { UNASSIGNED_CODE } from "@/lib/filters";
import {
  marginPct,
  yoyBucket,
  yoyChange,
  yoyColors,
  YOY_EDGES,
  YOY_LEGEND,
  type MixBrand,
} from "@/lib/product-mix";
import { setRunnerForTests } from "@/lib/server/db";
import {
  ALL_OTHER_BRANDS,
  buildMixTree,
  buildWatchlists,
  MIN_BASE_AED,
  productMix,
  TREEMAP_BRANDS,
  TREEMAP_ITEMS,
  WATCHLIST_SIZE,
} from "@/lib/server/product-mix";
import { itemMixQuery, salesItemMix, salesKpis, type ItemMixRow } from "@/lib/server/queries/sales";
import { ALL_OTHER, UNASSIGNED } from "@/lib/server/sql";

import { Q1_2025, useFixtureSource } from "./fixture";

beforeAll(() => {
  useFixtureSource();
});
afterAll(() => setRunnerForTests(undefined));

function leaves(brands: MixBrand[]) {
  return brands.flatMap((brand) => brand.items);
}

function sum(tiles: { netRevenue: number }[]) {
  return tiles.reduce((total, tile) => total + tile.netRevenue, 0);
}

describe("item mix query", () => {
  it("groups by item code with its brand, and binds every filter", () => {
    const { sql, binds } = itemMixQuery({
      ...Q1_2025,
      companies: ["101"],
      salespeople: ["A1"],
      brands: ["B1"],
    });
    expect(sql).toContain(`GROUP BY COALESCE(NULLIF(TRIM(CSL_BRAND_NAME), ''), 'Unassigned'), CSL_ITEM_CODE`);
    expect(sql).toContain("CSL_TXN_TYPE IN ('INV', 'SARTN')");
    expect(sql).not.toMatch(/GROUP BY[^\n]*CSL_NAME/);
    expect(binds).toMatchObject({
      start_date: "2025-01-01",
      end_date_exclusive: "2025-04-01",
      company_0: "101",
      salesperson_0: "A1",
      brand_0: "B1",
    });
  });

  it("gives each code this period and the same days last year", async () => {
    const rows = await salesItemMix(Q1_2025);
    const byCode = Object.fromEntries(rows.map((row) => [row.code, row]));
    expect(Object.keys(byCode).sort()).toEqual(["IX", "IY", "IZ"]);
    expect(byCode.IX).toMatchObject({ brand: "Brand One", name: "Item X" });
    expect(byCode.IX.current).toMatchObject({
      netRevenue: 2800,
      cost: 1980,
      grossValue: 3080,
      discount: 280,
      returnsValue: -200,
      invoicedValue: 3000,
    });
    expect(byCode.IX.lastYear.netRevenue).toBeCloseTo(600);
    expect(byCode.IY).toMatchObject({ brand: "Brand Two" });
    expect(byCode.IY.lastYear.netRevenue).toBe(0);
    expect(byCode.IZ).toMatchObject({ brand: UNASSIGNED });
    expect(byCode.IZ.current).toMatchObject({ netRevenue: 800, cost: 400 });
  });

  it("follows the salesperson and brand filters", async () => {
    const bySalesperson = await salesItemMix({ ...Q1_2025, salespeople: ["A1"] });
    expect(Object.fromEntries(bySalesperson.map((row) => [row.code, row.current.netRevenue]))).toEqual({
      IX: 800,
      IY: 500,
    });
    const unassigned = await salesItemMix({ ...Q1_2025, brands: [UNASSIGNED_CODE] });
    expect(unassigned.map((row) => row.code)).toEqual(["IZ"]);
    const brandOne = await salesItemMix({ ...Q1_2025, brands: ["B1"] });
    expect(brandOne.map((row) => row.code)).toEqual(["IX"]);
  });
});

describe("product mix", () => {
  it("the treemap's tiles add up to Sales net revenue, Unassigned included", async () => {
    for (const filters of [
      Q1_2025,
      { ...Q1_2025, companies: ["102"] },
      { ...Q1_2025, salespeople: ["A1"] },
      { ...Q1_2025, start: "2024-01-01", end: "2025-12-31" },
    ]) {
      const [mix, kpis] = await Promise.all([productMix(filters), salesKpis(filters)]);
      expect(sum(mix.brands)).toBeCloseTo(kpis.netRevenue, 6);
      expect(sum(leaves(mix.brands))).toBeCloseTo(kpis.netRevenue, 6);
      expect(mix.netRevenue).toBeCloseTo(kpis.netRevenue, 6);
      expect(mix.grossMargin).toBeCloseTo(kpis.grossMargin, 6);
      for (const brand of mix.brands) expect(sum(brand.items)).toBeCloseTo(brand.netRevenue, 6);
    }
    const mix = await productMix(Q1_2025);
    expect(mix.brands.map((brand) => [brand.label, brand.netRevenue])).toEqual([
      ["Brand One", 2800],
      [UNASSIGNED, 800],
      ["Brand Two", 500],
    ]);
    expect(mix.brands[0].items).toEqual([
      { label: "Item X", code: "IX", netRevenue: 2800, lastYearNetRevenue: 600, grossMargin: 820 },
    ]);
    expect(mix).toMatchObject({ itemCount: 3, lastYearItemCount: 1, brandCount: 3, lastYearBrandCount: 1 });
  });

  it("an empty period has no tiles", async () => {
    const mix = await productMix({ ...Q1_2025, start: "2030-01-01", end: "2030-01-31" });
    expect(mix.brands).toEqual([]);
    expect(mix.watchlists.every((list) => list.rows.length === 0)).toBe(true);
  });
});

function item(
  code: string,
  brand: string,
  netRevenue: number,
  lastYear = 0,
  extra: Partial<ItemMixRow["current"]> = {},
): ItemMixRow {
  const figures = (value: number) => ({
    netRevenue: value,
    cost: value / 2,
    grossValue: value,
    discount: 0,
    returnsValue: 0,
    invoicedValue: value,
  });
  return {
    code,
    name: `Item ${code}`,
    brand,
    current: { ...figures(netRevenue), ...extra },
    lastYear: figures(lastYear),
  };
}

describe("mix tree", () => {
  it("folds brands beyond the top and non-positive ones into 'All other brands'", () => {
    const items = Array.from({ length: TREEMAP_BRANDS + 3 }, (_, index) =>
      item(`C${index}`, `Brand ${String(index).padStart(2, "0")}`, 1000 - index),
    );
    items.push(item("NEG", "Negative brand", -50), item("OLD", "Old brand", 0, 400));
    const tree = buildMixTree(items);
    expect(tree).toHaveLength(TREEMAP_BRANDS + 1);
    const rest = tree.at(-1)!;
    expect(rest.label).toBe(ALL_OTHER_BRANDS);
    expect(rest.items.map((tile) => tile.code)).toEqual(
      expect.arrayContaining([`C${TREEMAP_BRANDS}`, `C${TREEMAP_BRANDS + 2}`]),
    );
    expect(rest.items.at(-1)).toMatchObject({ label: ALL_OTHER, netRevenue: -50, lastYearNetRevenue: 400 });
    expect(sum(tree)).toBeCloseTo(sum(items.map((row) => row.current)), 6);
  });

  it("folds items beyond the top of a brand into 'All other'", () => {
    const items = Array.from({ length: TREEMAP_ITEMS + 5 }, (_, index) =>
      item(`C${index}`, "One", 100 + index),
    );
    const [brand] = buildMixTree(items);
    expect(brand.items).toHaveLength(TREEMAP_ITEMS + 1);
    expect(brand.items[0].code).toBe(`C${TREEMAP_ITEMS + 4}`);
    expect(brand.items.at(-1)).toMatchObject({
      label: ALL_OTHER,
      code: null,
      netRevenue: 100 + 101 + 102 + 103 + 104,
    });
    expect(sum(brand.items)).toBeCloseTo(brand.netRevenue, 6);
  });
});

describe("watchlists", () => {
  const base = MIN_BASE_AED;
  const items = [
    item("UP1", "A", base * 3, base),
    item("UP2", "A", base * 2, base),
    item("TINY", "A", base, base / 10), // +900%, but too small a base
    item("DOWN1", "B", 0, base * 4),
    item("DOWN2", "B", base, base * 2),
    item("DISC", "B", base * 2, 0, { grossValue: base * 2.5, discount: base / 2 }),
    item("DISCSMALL", "B", 100, 0, { grossValue: base / 2, discount: base / 4 }),
    item("RET", "B", base, 0, { invoicedValue: base * 2, returnsValue: -base }),
  ];
  const lists = Object.fromEntries(buildWatchlists(items).map((list) => [list.id, list]));

  it("ranks growers and decliners by AED change, with a minimum last-year base", () => {
    expect(lists.growers.rows.map((row) => row.code)).toEqual(["UP1", "UP2"]);
    expect(lists.growers.rows[0].change).toBe(base * 2);
    expect(lists.decliners.rows.map((row) => row.code)).toEqual(["DOWN1", "DOWN2"]);
    expect(lists.decliners.rows[0].change).toBe(-base * 4);
  });

  it("ranks discount % and returns %, with a minimum base", () => {
    expect(lists.discount.rows.map((row) => [row.code, row.discountPct])).toEqual([["DISC", 0.2]]);
    expect(lists.returns.rows.map((row) => [row.code, row.returnsPct])).toEqual([["RET", 0.5]]);
  });

  it("breaks ties on the larger base, then the lower code", () => {
    const tied = [
      item("B", "A", 0, 0, { grossValue: base * 2, discount: base / 2.5 }),
      item("C", "A", 0, 0, { grossValue: base * 3, discount: (base * 3) / 5 }),
      item("A", "A", 0, 0, { grossValue: base * 2, discount: base / 2.5 }),
    ];
    const discount = buildWatchlists(tied).find((list) => list.id === "discount")!;
    expect(discount.rows.map((row) => row.code)).toEqual(["C", "A", "B"]);
  });

  it("states each rule and stops at the list size", () => {
    for (const list of Object.values(lists)) expect(list.rule).toMatch(/AED 10K/);
    const many = Array.from({ length: 15 }, (_, index) => item(`G${index}`, "A", base * (2 + index), base));
    expect(buildWatchlists(many)[0].rows).toHaveLength(WATCHLIST_SIZE);
  });
});

describe("YoY colour scale", () => {
  it("is null without a positive base", () => {
    expect(yoyChange(100, 0)).toBeNull();
    expect(yoyChange(100, -10)).toBeNull();
    expect(yoyChange(150, 100)).toBeCloseTo(0.5);
    expect(yoyChange(0, 100)).toBe(-1);
  });

  it("puts every change in one step, edges going to the step above", () => {
    expect(yoyBucket(-1)).toBe(-3);
    expect(yoyBucket(-0.3)).toBe(-2);
    expect(yoyBucket(-0.2)).toBe(-2);
    expect(yoyBucket(-0.15)).toBe(-1);
    expect(yoyBucket(-0.05)).toBe(0);
    expect(yoyBucket(0)).toBe(0);
    expect(yoyBucket(0.05)).toBe(1);
    expect(yoyBucket(0.15)).toBe(2);
    expect(yoyBucket(0.3)).toBe(3);
    expect(yoyBucket(4)).toBe(3);
    expect(yoyBucket(null)).toBe("new");
    expect(yoyBucket(Number.NaN)).toBe("new");
    expect(YOY_EDGES).toHaveLength(6);
  });

  it("has a distinct colour and a legend entry per step", () => {
    const fills = YOY_LEGEND.map(({ bucket }) => yoyColors(bucket).fill);
    expect(new Set(fills).size).toBe(8);
    expect(yoyColors(3)).toEqual({ fill: "var(--yoy-up-3)", text: "var(--yoy-up-3-fg)" });
    expect(yoyColors("new").fill).toBe("var(--yoy-new)");
    expect(yoyColors(-3).fill).toBe("var(--yoy-down-3)");
  });

  it("margin % is null without revenue", () => {
    expect(marginPct({ netRevenue: 0, grossMargin: 5 })).toBeNull();
    expect(marginPct({ netRevenue: 200, grossMargin: 50 })).toBe(0.25);
  });
});
