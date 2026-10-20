/**
 * The customer page's queries against values worked out by hand from the fixtures. Each figure is
 * also checked against the dashboard row it must equal.
 *
 * tests/fixtures/ZF_CUSTOMER.csv: CA and CA2 share the name "Customer A"; CB is the only
 * "Customer B"; X_1 and X%2 have LIKE wildcards in their code or name.
 *
 * Sales, Q1 2025 (ZF_CSL_BI): CA has invoice IU5-1001 (1000 + 500, cost 600 + 300) and return
 * SRU-3001 (−200, 2 units, cost −120), so net revenue 1300, margin 1300 − 780 = 520. Q1 2024: 700 − 100.
 *
 * AR as of 2025-06-30: C1 owes 1000 (<30 D) + 1000 (3-6 M, after a 500 PDC); two older lines are
 * settled. Salesperson Sara, credit limit 50,000.
 *
 * Open book as of 2025-06-30: CA has SO5-1001 (1000 + 300 pending); CA2 has SO5-1004 (150).
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { previousYear } from "@/lib/filters";
import { setRunnerForTests } from "@/lib/server/db";
import { arBalances, arDocuments, arDocumentsQuery, arProfile, summarize } from "@/lib/server/queries/ar-ap";
import {
  codesByNameQuery,
  customer,
  customerCodesByName,
  isCustomerCode,
  likeEscape,
  searchCustomers,
  searchQuery,
  searchText,
} from "@/lib/server/queries/customers";
import { kpiQuery, salesBreakdown, salesKpis, salesMonthly, salesReturns } from "@/lib/server/queries/sales";
import { openBookKpis, openByCustomer, openKpiQuery, openLines } from "@/lib/server/queries/sales-orders";
import { ALL_OTHER, UNASSIGNED } from "@/lib/server/sql";

import { Q1_2025, useFixtureSource } from "./fixture";

const TODAY = "2025-06-30";
const ALL: string[] = [];

beforeAll(() => {
  useFixtureSource();
});
afterAll(() => setRunnerForTests(undefined));

describe("customer master", () => {
  it("reads the master fields, placeholders as nothing", async () => {
    expect(await customer("CA")).toEqual({
      code: "CA",
      name: "Customer A",
      parent: "Alpha Holdings",
      type: "Hospital",
      category: null,
      city: "DUBAI",
      country: "UNITED ARAB EMIRATES",
      frozen: false,
    });
    expect(await customer("CA2")).toMatchObject({
      parent: null,
      type: null,
      category: null,
      city: null,
      frozen: true,
    });
  });

  it("an unknown or malformed code is not found", async () => {
    expect(await customer("NOPE")).toBeNull();
    expect(await customer("ca")).toBeNull();
    for (const code of ["", " CA", "CODE-LONGER-THAN-12", "a\u0000b"]) {
      expect(isCustomerCode(code), code).toBe(false);
      expect(await customer(code)).toBeNull();
    }
    expect(isCustomerCode("X%2")).toBe(true);
  });
});

describe("search", () => {
  it("finds customers by part of the name, case-insensitive, with a kind per result", async () => {
    expect(await searchCustomers("customer a")).toEqual([
      { kind: "customer", code: "CA", name: "Customer A", detail: "DUBAI" },
      { kind: "customer", code: "CA2", name: "Customer A", detail: null },
    ]);
  });

  it("puts the exact code first, then code and name prefixes", async () => {
    const codes = (await searchCustomers("c1")).map((result) => result.code);
    expect(codes[0]).toBe("C1");
    expect((await searchCustomers("cb"))[0].code).toBe("CB");
  });

  it("takes LIKE wildcards literally", async () => {
    expect(likeEscape("100%_a\\b")).toBe("100\\%\\_a\\\\b");
    expect((await searchCustomers("_C")).map((result) => result.code)).toEqual(["X_1"]);
    expect((await searchCustomers("x%")).map((result) => result.code)).toEqual(["X%2"]);
  });

  it("binds SQL-injection-like input and never puts it in the SQL", async () => {
    for (const text of ["' OR '1'='1", "x'); DROP TABLE t --", "%' UNION SELECT 1 --"]) {
      const { sql, binds } = searchQuery(text);
      expect(sql).not.toContain(text);
      expect(sql).not.toContain("'1'='1");
      expect(Object.values(binds).some((value) => String(value).includes(text.toUpperCase()))).toBe(true);
      expect(await searchCustomers(text)).toEqual([]);
    }
  });

  it("caps the results", async () => {
    expect(await searchCustomers("customer", 3)).toHaveLength(3);
    expect(searchQuery("abc").binds.row_limit).toBe(20);
  });

  it("needs at least 2 characters", () => {
    expect(searchText(undefined)).toBeNull();
    expect(searchText("a")).toBeNull();
    expect(searchText("  a  ")).toBeNull();
    expect(searchText("  ab ")).toBe("ab");
    expect(searchText("x".repeat(500))).toHaveLength(80);
  });
});

describe("codes for the names on the dashboards", () => {
  it("links a name only when one code carries it", async () => {
    const codes = await customerCodesByName(["Customer A", "Customer B", "Nobody", ALL_OTHER, UNASSIGNED]);
    expect(Object.fromEntries(codes)).toEqual({ "Customer B": "CB" });
    expect(codesByNameQuery(["Customer B"]).binds).toEqual({ name_0: "Customer B" });
    expect(await customerCodesByName([])).toEqual(new Map());
  });
});

describe("sales of one customer", () => {
  it("KPIs equal the customer's row on the Sales dashboard", async () => {
    const kpis = await salesKpis(Q1_2025, "CB");
    const row = (await salesBreakdown(Q1_2025, "customer")).find((entry) => entry.label === "Customer B");
    expect(kpis.netRevenue).toBeCloseTo(2000);
    expect(kpis.netRevenue).toBeCloseTo(row!.netRevenue);
    expect(kpis.grossMargin).toBeCloseTo(row!.grossMargin);
  });

  it("net revenue, margin and returns, with last year", async () => {
    const kpis = await salesKpis(Q1_2025, "CA");
    expect(kpis.netRevenue).toBeCloseTo(1300);
    expect(kpis.grossMargin).toBeCloseTo(520);
    expect(kpis.marginPct).toBeCloseTo(0.4);
    expect(kpis.returnsValue).toBeCloseTo(-200);
    expect((await salesKpis(previousYear(Q1_2025), "CA")).netRevenue).toBeCloseTo(600);
    expect((await salesKpis(Q1_2025, "NOPE")).netRevenue).toBe(0);
  });

  it("the monthly trend, top items and returns add up to the KPIs", async () => {
    const kpis = await salesKpis(Q1_2025, "CA");
    const months = await salesMonthly(Q1_2025, "CA");
    expect(months.map((month) => month.netRevenue)).toEqual([1500, -200, 0]);
    expect(months.reduce((sum, month) => sum + month.netRevenue, 0)).toBeCloseTo(kpis.netRevenue);
    for (const items of [
      await salesBreakdown(Q1_2025, "item", 15, "CA"),
      await salesBreakdown(Q1_2025, "item", 1, "CA"),
    ]) {
      expect(items.reduce((sum, row) => sum + row.netRevenue, 0)).toBeCloseTo(kpis.netRevenue);
      expect(items.reduce((sum, row) => sum + row.grossMargin, 0)).toBeCloseTo(kpis.grossMargin);
    }
    const returns = await salesReturns(Q1_2025, "CA");
    expect(returns).toEqual([
      {
        date: "2025-02-20",
        companyCode: "101",
        document: "SRU-3001",
        item: "Item X",
        quantity: 2,
        value: -200,
      },
    ]);
    expect(returns.reduce((sum, line) => sum + line.value, 0)).toBeCloseTo(kpis.returnsValue);
  });

  it("binds the code, and leaves the dashboard's SQL as it was without one", () => {
    const { sql, binds } = kpiQuery(Q1_2025, "CA'--");
    expect(sql).toContain("CSL_CUST_CODE = :cust_code");
    expect(sql).not.toContain("CA'--");
    expect(binds.cust_code).toBe("CA'--");
    expect(kpiQuery(Q1_2025).sql).not.toContain("cust_code");
  });
});

describe("AR of one customer", () => {
  it("equals the customer's row on the Receivables page, and its aging adds up", async () => {
    const [row] = await arBalances(TODAY, ALL, "customer", "C1");
    const dashboard = (await arBalances(TODAY, ALL, "customer")).find((entry) => entry.key === "C1");
    expect(row).toEqual(dashboard);
    const summary = summarize([row]);
    expect(summary.balance).toBeCloseTo(2000);
    expect(summary.over90).toBeCloseTo(1000);
    expect(summary.buckets.reduce((sum, value) => sum + value, 0)).toBeCloseTo(summary.balance);
    expect(await arBalances(TODAY, ALL, "customer", "NOPE")).toEqual([]);
    expect(await arBalances(TODAY, ["102"], "customer", "C1")).toEqual([]);
  });

  it("lists the open documents, largest first (older first on a tie), adding up to the balance", async () => {
    const documents = await arDocuments(TODAY, ALL, "C1");
    expect(documents).toEqual([
      {
        companyCode: "101",
        document: "CIN-2",
        date: "2025-01-15",
        currency: "AED",
        amount: 2000,
        balance: 1000,
        pdc: 500,
        bucket: 3,
      },
      {
        companyCode: "101",
        document: "CIN-1",
        date: "2025-06-20",
        currency: "AED",
        amount: 1000,
        balance: 1000,
        pdc: 0,
        bucket: 0,
      },
    ]);
    expect(documents.reduce((sum, document) => sum + document.balance, 0)).toBeCloseTo(2000);
    expect(await arDocuments(TODAY, ALL, "C1", 1)).toHaveLength(1);
    expect(arDocumentsQuery(TODAY, ALL, "C1").binds).toMatchObject({ cust_code: "C1", row_limit: 200 });
  });

  it("reads the salesperson and credit limit off the AR lines", async () => {
    expect(await arProfile(TODAY, ALL, "C1")).toEqual({ salesperson: "Sara", creditLimit: 50000 });
    expect(await arProfile(TODAY, ALL, "NOPE")).toEqual({ salesperson: null, creditLimit: null });
  });
});

describe("open orders of one customer", () => {
  it("open value adds up from its lines and matches the Sales orders breakdown", async () => {
    const kpis = await openBookKpis(ALL, TODAY, "all", "CA");
    expect(kpis.openValue).toBeCloseTo(1300);
    expect(kpis.openAedLines).toBe(2);
    const lines = await openLines(ALL, TODAY, "all", 1000, "CA");
    expect(lines.map((line) => [line.orderNumber, line.pendingValue, line.customerCode])).toEqual([
      ["SO5-1001", 1000, "CA"],
      ["SO5-1001", 300, "CA"],
    ]);
    // "Customer A" on the dashboard is CA and CA2 together: a shared name, so it stays unlinked.
    const byName = (await openByCustomer(ALL, TODAY, "all")).find((row) => row.label === "Customer A");
    const ca2 = await openBookKpis(ALL, TODAY, "all", "CA2");
    expect(kpis.openValue + ca2.openValue).toBeCloseTo(byName!.value);
    expect((await openBookKpis(ALL, TODAY, "all", "NOPE")).openValue).toBe(0);
  });

  it("narrows by customer and order age together", async () => {
    const { sql, binds } = openKpiQuery(ALL, TODAY, "2y", "CA");
    expect(sql).toContain("H_CUST_CODE = :cust_code");
    expect(binds).toMatchObject({ cust_code: "CA", since_date: expect.any(String) });
    const all = await openBookKpis(ALL, TODAY, "all", "CA");
    const recent = await openBookKpis(ALL, TODAY, "2y", "CA");
    expect(recent.openValue + recent.hiddenValue).toBeCloseTo(all.openValue);
  });
});
