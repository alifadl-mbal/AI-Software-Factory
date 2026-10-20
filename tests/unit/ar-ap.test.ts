/**
 * Receivables and payables against values worked out by hand from the fixtures, as of 2025-06-30.
 *
 * tests/fixtures/ZF_SOA_DETL_CUST_INV_SM_BI.csv, company 101 (balance = TOT_BAL − TOT_PDC):
 *
 *     C1  2025-06-20  bal 1000  pdc   0  → 1000  <30 D   Sara / Fadi
 *     C1  2025-01-15  bal 1500  pdc 500  → 1000  3-6 M   Sara / Fadi   over 90
 *     C1  2024-03-01  bal    0           settled
 *     C1  2023-01-01  bal  0.6           settled (FX rounding under 1 AED)
 *     C2  2025-05-15  bal 4000  pdc 4000 →    0  1-2 M   Sam  / Fadi   cheque in hand
 *     C2  2024-10-10  bal  800           →  800  6-12 M  Sam  / (none) over 90
 *     C2  2025-06-25  bal -300           → -300  <30 D   Sam  / Fadi   credit note
 *
 * Every line is issued by salesperson X9, who must never show up. Company 102 holds 50; company
 * 201 has one document on each side of every bucket boundary, with power-of-two balances.
 *
 * tests/fixtures/ZF_SOAP_DETL_BI.csv, company 101 (we owe = −TOT_BAL − TOT_PDC):
 *
 *     V1 Alpha   2025-06-10  3000  <30 D
 *     V1 Alpha   2025-02-01  3000  3-6 M  over 90 (5000 invoice, 2000 already paid)
 *     V1 Alpha   2024-01-10 / 2024-02-10  settled, with stray AMT_CR 7000 / AMT_DR 6500
 *     V1 Alpha   2025-05-20     0  1-2 M  (1000 invoice covered by a PDC we issued)
 *     V2 Beta    2024-11-15  2000  6-12 M over 90
 *     V2 Beta    2025-06-15  -500  <30 D  (payment on account)
 *     V3 Gamma   2025-04-15 -4000 advance, 2025-05-10 +1500 invoice  → prepaid 2500
 *     V4 Delta   USD invoice 900, AED payment 900                     → nets to zero
 *
 * Company 102 owes V5 100, dated 2023-01-01.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { AGING_BUCKETS } from "@/lib/aging";
import { setRunnerForTests } from "@/lib/server/db";
import { apBalancesQuery, apSplit, arBalances, arBalancesQuery, arSummary } from "@/lib/server/queries/ar-ap";
import { UNASSIGNED } from "@/lib/server/sql";

import { useFixtureSource } from "./fixture";

const AS_OF = "2025-06-30";
const ladder = (values: Partial<Record<(typeof AGING_BUCKETS)[number], number>>) =>
  AGING_BUCKETS.map((bucket) => values[bucket] ?? 0);

beforeAll(() => {
  useFixtureSource();
});
afterAll(() => setRunnerForTests(undefined));

describe("receivables", () => {
  it("outstanding is the open balance net of PDCs, settled lines left out", async () => {
    const summary = await arSummary(AS_OF, ["101"]);
    // TOT_BAL alone would be 7000; ORG_LC_AMT would be 16100; the 0.6 rounding line would add 0.6.
    expect(summary.balance).toBeCloseTo(2500, 6);
    expect(summary.pdc).toBeCloseTo(4500, 6);
    expect(summary.over90).toBeCloseTo(1800, 6);
    expect(summary.over90Pct).toBeCloseTo(1800 / 2500, 6);
    expect(summary.buckets).toEqual(ladder({ "<30 D": 700, "3-6 M": 1000, "6-12 M": 800 }));
  });

  it("settled lines don't count as open documents or set the oldest bucket", async () => {
    const customers = await arBalances(AS_OF, ["101"], "customer");
    const one = customers.find((row) => row.label === "Customer One")!;
    expect(one.lines).toBe(2);
    expect(one.balance).toBeCloseTo(2000, 6);
    expect(AGING_BUCKETS[one.oldestBucket!]).toBe("3-6 M");
  });

  it("a PDC takes the line out of the balance but the cheque is still counted", async () => {
    const customers = await arBalances(AS_OF, ["101"], "customer");
    const two = customers.find((row) => row.label === "Customer Two")!;
    expect(two.balance).toBeCloseTo(500, 6);
    expect(two.pdc).toBeCloseTo(4000, 6);
    expect(two.buckets[AGING_BUCKETS.indexOf("1-2 M")]).toBe(0);
    // The fully covered line has no balance, so the oldest open debit is the 6-12 M invoice.
    expect(AGING_BUCKETS[two.oldestBucket!]).toBe("6-12 M");
  });

  it("puts each boundary document in the right bucket", async () => {
    const summary = await arSummary(AS_OF, ["201"]);
    expect(summary.buckets).toEqual(
      ladder({
        "<30 D": 1,
        "1-2 M": 2 + 4,
        "2-3 M": 8 + 4096 + 16,
        "3-6 M": 32 + 64,
        "6-12 M": 128 + 256,
        "1-2 Y": 512 + 1024,
        "2+ Y": 2048,
      }),
    );
    // Exactly 90 days old (4096) is not over 90; 91 days (16) and older are.
    expect(summary.over90).toBe(16 + 32 + 64 + 128 + 256 + 512 + 1024 + 2048);
  });

  it("attributes sales AR by the customer's salesperson, never the invoicing one", async () => {
    const rows = await arBalances(AS_OF, ["101"], "salesperson");
    expect(Object.fromEntries(rows.map((row) => [row.label, row.balance]))).toEqual({
      "Sara (S1)": 2000,
      "Sam (S2)": 500,
    });
    expect(rows.map((row) => row.customers)).toEqual([1, 1]);
  });

  it("groups collection follow-up by the finance salesperson, blanks as Unassigned", async () => {
    const rows = await arBalances(AS_OF, ["101"], "collector");
    expect(Object.fromEntries(rows.map((row) => [row.label, row.balance]))).toEqual({
      "Fadi (F1)": 1700,
      [UNASSIGNED]: 800,
    });
  });

  it("never reads the invoicing salesperson column", () => {
    for (const group of ["customer", "salesperson", "collector"] as const) {
      expect(arBalancesQuery(AS_OF, [], group).sql).not.toMatch(/SDR_INV_SM/);
    }
  });

  it("applies the company filter, and all companies by default", async () => {
    expect((await arSummary(AS_OF, ["102"])).balance).toBeCloseTo(50, 6);
    expect((await arSummary(AS_OF, ["101", "102"])).balance).toBeCloseTo(2550, 6);
    expect((await arSummary(AS_OF, [])).balance).toBeCloseTo(2500 + 50 + 8191, 6);
  });

  it("binds every user value", () => {
    const query = arBalancesQuery(AS_OF, ["101' OR 1=1 --"], "customer");
    expect(query.sql).not.toContain("OR 1=1");
    expect(query.binds.company_0).toBe("101' OR 1=1 --");
  });
});

describe("payables", () => {
  it("owed balance comes from the open part, settled lines and PDCs left out", async () => {
    const { summary, owed } = await apSplit(AS_OF, ["101"]);
    // AMT_CR − AMT_DR over every line would give 13900 − 11900 = 2000 plus stray settled amounts.
    expect(summary.balance).toBeCloseTo(7500, 6);
    expect(summary.over90).toBeCloseTo(5000, 6);
    expect(summary.pdc).toBeCloseTo(1000, 6);
    expect(summary.buckets).toEqual(ladder({ "<30 D": 2500, "3-6 M": 3000, "6-12 M": 2000 }));
    expect(owed.map((vendor) => [vendor.label, vendor.balance])).toEqual([
      ["Alpha Supplies", 6000],
      ["Beta Logistics", 1500],
    ]);
    expect(owed[0].lines).toBe(3);
    expect(owed[0].account).toBe("Trade Account Payable");
    expect(AGING_BUCKETS[owed[1].oldestBucket!]).toBe("6-12 M");
  });

  it("reports prepayments separately instead of netting them", async () => {
    const { summary, prepaid, prepayments } = await apSplit(AS_OF, ["101"]);
    expect(prepayments).toBeCloseTo(2500, 6);
    expect(prepaid.map((vendor) => [vendor.label, vendor.balance])).toEqual([["Gamma Machines", -2500]]);
    // Netting the prepaid vendor in would have shown 5000.
    expect(summary.balance).not.toBeCloseTo(5000, 6);
  });

  it("nets a vendor's lines across currencies before deciding owed or prepaid", async () => {
    const { owed, prepaid } = await apSplit(AS_OF, ["101"]);
    expect([...owed, ...prepaid].some((vendor) => vendor.label === "Delta Germany")).toBe(false);
  });

  it("applies the company filter", async () => {
    const { summary, prepayments } = await apSplit(AS_OF, ["102"]);
    expect(summary.balance).toBeCloseTo(100, 6);
    expect(summary.buckets).toEqual(ladder({ "2+ Y": 100 }));
    expect(prepayments).toBe(0);
    expect((await apSplit(AS_OF, [])).summary.balance).toBeCloseTo(7600, 6);
  });

  it("uses the open balance, not AMT_CR − AMT_DR", () => {
    const { sql } = apBalancesQuery(AS_OF, []);
    expect(sql).toContain("SOAP_TOT_BAL");
    expect(sql).not.toMatch(/SOAP_AMT_(CR|DR)/);
  });
});
