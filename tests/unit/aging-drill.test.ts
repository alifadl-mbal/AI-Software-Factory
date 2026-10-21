/**
 * The AR salesperson filter, and the aging hover card and drill-down: every card section, every
 * bucket's account list and every account's documents add up to the column they came from, on the
 * hand-checked fixture (see ar-ap.test.ts for its rows) and on the full sample data.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { AGING_BUCKETS } from "@/lib/aging";
import { agingParam, parseAgingAccount, parseAgingParam, parseBucket } from "@/lib/aging-drill";
import { UNASSIGNED_CODE } from "@/lib/filters";
import { setRunnerForTests } from "@/lib/server/db";
import { SampleSource } from "@/lib/server/sample";
import {
  apAgingHover,
  apBucketVendors,
  apBucketDocuments,
  apSplit,
  arAgingHover,
  arBalances,
  arBalancesQuery,
  arBucketCustomers,
  arBucketDocuments,
  arSalespersonOptions,
  arSummary,
  type ArScope,
} from "@/lib/server/queries/ar-ap";
import { ALL_OTHER, foldTop } from "@/lib/server/sql";

import { useFixtureSource } from "./fixture";

const AS_OF = "2025-06-30";
const BUCKETS = AGING_BUCKETS.map((_, index) => index);

const sum = (values: number[]) => values.reduce((total, value) => total + value, 0);

/** Every hover section, account list and account's documents add up to the column. */
async function expectArReconciles(asOf: string, scope: ArScope) {
  const summary = await arSummary(asOf, scope);
  for (const bucket of BUCKETS) {
    const column = summary.buckets[bucket];
    const card = await arAgingHover(asOf, scope, bucket);
    expect(card.total).toBeCloseTo(column, 4);
    expect(card.sections.map((section) => section.id)).toEqual(["company", "salesperson"]);
    for (const section of card.sections) {
      expect(sum(section.rows.map((row) => row.value))).toBeCloseTo(column, 4);
    }
    const accounts = await arBucketCustomers(asOf, scope, bucket);
    expect(accounts.total).toBeCloseTo(column, 4);
    expect(sum(accounts.rows.map((row) => row.balance))).toBeCloseTo(column, 4);
    for (const row of accounts.rows) {
      const documents = await arBucketDocuments(asOf, scope, row.key, bucket);
      expect(documents.balance).toBeCloseTo(row.balance, 4);
      expect(documents.count).toBe(row.lines);
      expect(sum(documents.rows.map((document) => document.balance))).toBeCloseTo(row.balance, 4);
      expect(documents.rows.every((document) => document.bucket === bucket)).toBe(true);
    }
  }
}

async function expectApReconciles(asOf: string, companies: string[]) {
  const { summary } = await apSplit(asOf, companies);
  for (const bucket of BUCKETS) {
    const column = summary.buckets[bucket];
    const card = await apAgingHover(asOf, companies, bucket);
    expect(card.total).toBeCloseTo(column, 4);
    expect(card.sections.map((section) => section.id)).toEqual(["company", "supplier"]);
    for (const section of card.sections) {
      expect(sum(section.rows.map((row) => row.value))).toBeCloseTo(column, 4);
    }
    const vendors = await apBucketVendors(asOf, companies, bucket);
    expect(sum(vendors.rows.map((row) => row.balance))).toBeCloseTo(column, 4);
    for (const row of vendors.rows) {
      const documents = await apBucketDocuments(asOf, row.key, bucket);
      expect(documents.balance).toBeCloseTo(row.balance, 4);
      expect(sum(documents.rows.map((document) => document.balance))).toBeCloseTo(row.balance, 4);
    }
  }
}

describe("on the fixture", () => {
  beforeAll(() => {
    useFixtureSource();
  });
  afterAll(() => setRunnerForTests(undefined));

  describe("salesperson filter", () => {
    it("leaves the SQL unchanged when no salesperson is set", () => {
      expect(arBalancesQuery(AS_OF, { companies: ["101"], salespeople: [] }, "customer")).toEqual(
        arBalancesQuery(AS_OF, ["101"], "customer"),
      );
    });

    it("narrows AR to the customers' own salesperson", async () => {
      // Sara (S1) is C1's salesperson: 1000 + 1000.
      const sara = await arSummary(AS_OF, { companies: ["101"], salespeople: ["S1"] });
      expect(sara.balance).toBeCloseTo(2000, 6);
      // Sam (S2): C2 in 101 (0 + 800 − 300) and C3 in 102 (50).
      const sam = await arSummary(AS_OF, { companies: [], salespeople: ["S2"] });
      expect(sam.balance).toBeCloseTo(550, 6);
      expect((await arSummary(AS_OF, { companies: [], salespeople: [UNASSIGNED_CODE] })).balance).toBe(0);
    });

    it("splits AR by salesperson without losing any", async () => {
      const all = await arSummary(AS_OF, []);
      const parts = await Promise.all(
        ["S1", "S2", "S3"].map(
          async (code) => (await arSummary(AS_OF, { companies: [], salespeople: [code] })).balance,
        ),
      );
      expect(sum(parts)).toBeCloseTo(all.balance, 6);
    });

    it("is never the issuing salesperson", async () => {
      expect((await arSummary(AS_OF, { companies: [], salespeople: ["X9"] })).balance).toBe(0);
    });

    it("offers the salespeople with open AR, by code and name", async () => {
      const options = await arSalespersonOptions(AS_OF, ["101"]);
      expect(options).toEqual(
        expect.arrayContaining([
          { code: "S1", name: "Sara" },
          { code: "S2", name: "Sam" },
        ]),
      );
      expect(options).toHaveLength(2);
    });
  });

  describe("aging hover and drill-down", () => {
    it("AR adds up to each column, whatever the filters", async () => {
      for (const scope of [
        [],
        ["101"],
        ["201"],
        { companies: [], salespeople: ["S2"] },
        { companies: ["101"], salespeople: ["S1", "S2"] },
      ] as ArScope[]) {
        await expectArReconciles(AS_OF, scope);
      }
    });

    it("AR breaks a column down by company and the customer's salesperson", async () => {
      const card = await arAgingHover(AS_OF, [], 0);
      // <30 D: C1 1000, C2 −300 (101), C3 50 (102), B01 1 (201; B02 is 30 days old, so 1-2 M).
      expect(card.total).toBeCloseTo(751, 6);
      const rows = (id: string) => card.sections.find((section) => section.id === id)!.rows;
      expect(rows("company")).toEqual([
        { label: "Alpha Trading", value: 700 },
        { label: "Beta Medical", value: 50 },
        { label: "Boundary Co", value: 1 },
      ]);
      expect(rows("salesperson")).toEqual([
        { label: "Sara (S1)", value: 1000 },
        { label: "Sam (S2)", value: -250 },
        { label: "Selma (S3)", value: 1 },
      ]);
    });

    it("folds all but the five largest slices into All other, keeping the total", () => {
      const slices = [7, -9, 1, 2, 3, 4, 5].map((value, index) => ({ label: `S${index}`, value }));
      const rows = foldTop(slices, 5);
      expect(rows.map((row) => row.label)).toEqual(["S1", "S0", "S6", "S5", "S4", ALL_OTHER]);
      expect(rows.at(-1)!.value).toBe(3);
      expect(sum(rows.map((row) => row.value))).toBe(sum(slices.map((slice) => slice.value)));
      expect(foldTop(slices.slice(0, 2), 5)).toHaveLength(2);
    });

    it("lists a column's customers with their salesperson, largest first", async () => {
      const { rows } = await arBucketCustomers(AS_OF, ["101"], 3);
      expect(rows).toEqual([
        { key: "C1", label: "Customer One", detail: "Sara (S1)", balance: 1000, pdc: 500, lines: 1 },
      ]);
    });

    it("narrows the card to one customer on the customer page", async () => {
      const [customer] = await arBalances(AS_OF, [], "customer", "C1");
      for (const bucket of BUCKETS) {
        expect((await arAgingHover(AS_OF, [], bucket, "C1")).total).toBeCloseTo(customer.buckets[bucket], 6);
      }
    });

    it("AP adds up to each column, prepaid vendors left out", async () => {
      for (const companies of [[], ["101"], ["102"]]) await expectApReconciles(AS_OF, companies);
      const card = await apAgingHover(AS_OF, ["101"], 0);
      // <30 D owed: V1 3000, V2 −500; V3 is prepaid and left out.
      expect(card.total).toBeCloseTo(2500, 6);
      expect(card.sections[1].rows).toEqual([
        { label: "Alpha Supplies", value: 3000 },
        { label: "Beta Logistics", value: -500 },
      ]);
    });

    it("lists one vendor's documents in a column", async () => {
      const documents = await apBucketDocuments(AS_OF, "101|V1", 3);
      expect(documents.rows.map((document) => [document.document, document.balance])).toEqual([
        ["PIN-2", 3000],
      ]);
      expect(documents).toMatchObject({ count: 1, balance: 3000 });
    });
  });

  describe("URL parameters", () => {
    it("reads columns and accounts, and nothing else", () => {
      expect(parseAgingParam(agingParam("ap", 6))).toEqual({ side: "ap", bucket: 6 });
      expect(parseAgingParam("ar-0")).toEqual({ side: "ar", bucket: 0 });
      for (const value of ["ar-7", "xx-1", "ar-", "ar-12", null]) expect(parseAgingParam(value)).toBeNull();
      expect(parseBucket("6")).toBe(6);
      expect(parseBucket("7")).toBeNull();
      expect(parseAgingAccount("101|V0001")).toBe("101|V0001");
      expect(parseAgingAccount("C1'; DROP")).toBeNull();
    });
  });
});

describe("on the sample data", () => {
  const today = new Date().toISOString().slice(0, 10);
  beforeAll(() => {
    const source = new SampleSource({ anchorToDate: today });
    setRunnerForTests((sql, binds) => source.query(sql, binds));
  });
  afterAll(() => setRunnerForTests(undefined));

  it("every AR column's card, customers and documents add up", async () => {
    expect((await arSummary(today, [])).balance).not.toBe(0);
    await expectArReconciles(today, []);
    await expectArReconciles(today, { companies: [], salespeople: ["SM01"] });
  });

  it("totals every document of a column when it lists only the largest", async () => {
    const { rows } = await arBucketCustomers(today, [], 1);
    const account = rows.find((row) => row.lines > 1)!;
    const top = await arBucketDocuments(today, [], account.key, 1, 1);
    expect(top.rows).toHaveLength(1);
    expect(top.count).toBe(account.lines);
    expect(top.balance).toBeCloseTo(account.balance, 4);
  });

  it("every AP column's card, vendors and documents add up", async () => {
    await expectApReconciles(today, []);
  });
});
