/** Filters reach SQL only as bind variables, never as text pasted into the statement. */
import { afterEach, describe, expect, it } from "vitest";

import {
  filtersToSearch,
  hasSalesFilter,
  monthsInRange,
  parseFilters,
  presetRange,
  previousYear,
  shiftYears,
  type Filters,
} from "@/lib/filters";
import { setRunnerForTests } from "@/lib/server/db";
import { breakdownQuery, kpiQuery, monthlyQuery, salesKpis } from "@/lib/server/queries/sales";
import { filterWhere, salesWhere } from "@/lib/server/sql";

import { useFixtureSource } from "./fixture";

const SNEAKY = "101') OR ('1' = '1";
const TODAY = "2026-10-20";

describe("filterWhere", () => {
  it("uses binds for dates and companies", () => {
    const { sql, binds } = filterWhere(
      { start: "2026-01-01", end: "2026-03-31", companies: ["101", "107"] },
      "CSL_DATE",
      "CSL_COMP_CODE",
    );
    expect(sql).toBe(
      "CSL_DATE >= TO_DATE(:start_date, 'YYYY-MM-DD')" +
        " AND CSL_DATE < TO_DATE(:end_date_exclusive, 'YYYY-MM-DD')" +
        " AND CSL_COMP_CODE IN (:company_0, :company_1)",
    );
    expect(binds).toEqual({
      start_date: "2026-01-01",
      end_date_exclusive: "2026-04-01",
      company_0: "101",
      company_1: "107",
    });
  });

  it("binds salesperson and brand codes, one per IN-list entry", () => {
    const { sql, binds } = filterWhere(
      { start: "2026-01-01", end: "2026-01-31", companies: [], salespeople: ["S01", "S07"], brands: ["NW"] },
      "D",
      "C",
      { salesperson: "SM", item: "ITEM" },
    );
    expect(sql).toContain("TRIM(SM) IN (:salesperson_0, :salesperson_1)");
    expect(sql).toContain(
      `TRIM(ITEM) IN (SELECT TRIM("Item") FROM MBALI.ZF_STK_SO_PO_SL_BI WHERE TRIM("Brand") IN (:brand_0))`,
    );
    expect(binds).toMatchObject({ salesperson_0: "S01", salesperson_1: "S07", brand_0: "NW" });
  });

  it("Unassigned matches blank salespeople and items without a brand", () => {
    const fragment = salesWhere(
      { salespeople: ["_none"], brands: ["_none", "CT"] },
      { salesperson: "SM", item: "ITEM" },
    );
    expect(fragment?.sql).toBe(
      "NULLIF(TRIM(SM), '') IS NULL AND (" +
        `TRIM(ITEM) IN (SELECT TRIM("Item") FROM MBALI.ZF_STK_SO_PO_SL_BI WHERE TRIM("Brand") IN (:brand_0))` +
        ` OR (NULLIF(TRIM(ITEM), '') IS NULL OR NOT EXISTS (SELECT 1 FROM MBALI.ZF_STK_SO_PO_SL_BI brand_map` +
        ` WHERE TRIM(brand_map."Item") = TRIM(ITEM) AND NULLIF(TRIM(brand_map."Brand"), '') IS NOT NULL)))`,
    );
    expect(fragment?.binds).toEqual({ brand_0: "CT" });
  });

  it("a view without the columns gets no salesperson or brand clause", () => {
    expect(salesWhere({ salespeople: ["S01"], brands: ["NW"] }, {})).toBeUndefined();
    expect(salesWhere({ salespeople: [], brands: [] }, { salesperson: "SM", item: "ITEM" })).toBeUndefined();
    const { sql } = filterWhere(
      { start: "2026-01-01", end: "2026-01-31", companies: [], salespeople: ["S01"], brands: ["NW"] },
      "D",
      "C",
    );
    expect(sql).not.toMatch(/salesperson|brand/);
  });

  it("no company selected means no company clause", () => {
    const { sql, binds } = filterWhere({ start: "2026-01-01", end: "2026-01-31", companies: [] }, "D", "C");
    expect(sql).not.toContain("C IN");
    expect(Object.keys(binds).sort()).toEqual(["end_date_exclusive", "start_date"]);
  });
});

describe("sales queries bind every filter value", () => {
  const filters: Filters = {
    range: "custom",
    start: "2026-02-01",
    end: "2026-02-28",
    companies: [SNEAKY],
    salespeople: [],
    brands: [],
  };

  it.each([
    ["kpis", () => kpiQuery(filters)],
    ["monthly", () => monthlyQuery(filters)],
    ["breakdown", () => breakdownQuery(filters, "customer")],
    ["top 20", () => breakdownQuery(filters, "item", 20)],
  ])("%s", (_, build) => {
    const query = build();
    expect(query.binds.start_date).toBe("2026-02-01");
    expect(query.binds.end_date_exclusive).toBe("2026-03-01");
    expect(query.binds.company_0).toBe(SNEAKY);
    expect(query.sql).toContain(":start_date");
    expect(query.sql).toContain(":company_0");
    expect(query.sql).not.toContain(SNEAKY);
    expect(query.sql).not.toContain("2026");
  });

  it.each([
    ["kpis", () => kpiQuery(sneakySales)],
    ["monthly", () => monthlyQuery(sneakySales)],
    ["breakdown", () => breakdownQuery(sneakySales, "brand")],
    ["top 20", () => breakdownQuery(sneakySales, "salesperson", 20)],
  ])("%s binds salesperson and brand", (_, build) => {
    const query = build();
    expect(query.binds).toMatchObject({ salesperson_0: SNEAKY, brand_0: SNEAKY });
    expect(query.sql).toContain(":salesperson_0");
    expect(query.sql).toContain(":brand_0");
    expect(query.sql).not.toContain(SNEAKY);
  });

  const sneakySales: Filters = { ...filters, companies: [], salespeople: [SNEAKY], brands: [SNEAKY] };

  afterEach(() => setRunnerForTests(undefined));

  it("an injection attempt is just an unknown company", async () => {
    useFixtureSource();
    const result = await salesKpis({ ...filters, start: "2025-01-01", end: "2025-03-31" });
    expect(result.netRevenue).toBe(0);
  });
});

describe("URL filters", () => {
  it("defaults to year to date and all companies", () => {
    expect(parseFilters({}, TODAY)).toEqual({
      range: "ytd",
      start: "2026-01-01",
      end: TODAY,
      companies: [],
      salespeople: [],
      brands: [],
    });
  });

  it("presets", () => {
    expect(presetRange("mtd", TODAY)).toEqual({ start: "2026-10-01", end: TODAY });
    expect(presetRange("qtd", TODAY)).toEqual({ start: "2026-10-01", end: TODAY });
    expect(presetRange("qtd", "2026-05-15")).toEqual({ start: "2026-04-01", end: "2026-05-15" });
    expect(presetRange("12m", TODAY)).toEqual({ start: "2025-10-21", end: TODAY });
  });

  it("custom range and companies round-trip through the query string", () => {
    const filters = parseFilters(
      new URLSearchParams("range=custom&from=2026-03-01&to=2026-02-01&company=107,101,bad%20code"),
      TODAY,
    );
    expect(filters).toEqual({
      range: "custom",
      start: "2026-02-01",
      end: "2026-03-01",
      companies: ["101", "107"],
      salespeople: [],
      brands: [],
    });
    expect(filtersToSearch(filters)).toBe("?range=custom&from=2026-02-01&to=2026-03-01&company=101,107");
    expect(parseFilters(new URLSearchParams(filtersToSearch(filters).slice(1)), TODAY)).toEqual(filters);
  });

  it("salesperson and brand codes are validated, de-duplicated and sorted, like companies", () => {
    const filters = parseFilters(
      new URLSearchParams("salesperson=S07,S01,S07,bad%20code,_none&brand=NW,,CT&company=101"),
      TODAY,
    );
    expect(filters.salespeople).toEqual(["S01", "S07", "_none"]);
    expect(filters.brands).toEqual(["CT", "NW"]);
    expect(filtersToSearch(filters)).toBe("?company=101&salesperson=S01,S07,_none&brand=CT,NW");
    expect(parseFilters(new URLSearchParams(filtersToSearch(filters).slice(1)), TODAY)).toEqual(filters);
    expect(parseFilters({ salesperson: ["S02", "S01"] }, TODAY).salespeople).toEqual(["S02"]);
  });

  it("an empty salesperson or brand list means all, and stays out of the URL", () => {
    const filters = parseFilters({ salesperson: "", brand: ",," }, TODAY);
    expect(filters).toMatchObject({ salespeople: [], brands: [] });
    expect(hasSalesFilter(filters)).toBe(false);
    expect(hasSalesFilter({ ...filters, brands: ["NW"] })).toBe(true);
    expect(filtersToSearch({ ...filters, salespeople: ["S01"] })).toBe("?salesperson=S01");
    expect(filtersToSearch({ ...filters, salespeople: ["S01"], brands: [] })).toBe("?salesperson=S01");
  });

  it("invalid values fall back to the default", () => {
    expect(parseFilters({ range: "custom", from: "2026-02-30", to: "x" }, TODAY).range).toBe("ytd");
    expect(parseFilters({ range: "forever" }, TODAY).range).toBe("ytd");
    expect(filtersToSearch(parseFilters({}, TODAY))).toBe("");
  });

  it("previous year and leap day", () => {
    expect(shiftYears("2024-02-29", -1)).toBe("2023-02-28");
    const filters = parseFilters({ company: "101" }, TODAY);
    expect(previousYear(filters)).toEqual({ ...filters, start: "2025-01-01", end: "2025-10-20" });
  });

  it("months in range", () => {
    expect(monthsInRange("2025-11-15", "2026-02-01")).toEqual(["2025-11", "2025-12", "2026-01", "2026-02"]);
  });
});

describe("daysBetween", () => {
  it("counts whole days across months and leap years", async () => {
    const { daysBetween } = await import("@/lib/filters");
    expect(daysBetween("2025-04-07", "2025-06-30")).toBe(84);
    expect(daysBetween("2024-02-28", "2024-03-01")).toBe(2);
    expect(daysBetween("2025-06-30", "2025-06-29")).toBe(-1);
  });
});
