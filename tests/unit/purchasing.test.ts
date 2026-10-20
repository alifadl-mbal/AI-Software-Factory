/**
 * Purchasing numbers against values worked out by hand from tests/fixtures/ZF_PO_PENDING_BI.csv
 * and tests/fixtures/ZF_CPR_BI.csv.
 *
 * Pending POs as of 2025-06-30 (pending value = (LC_VAL - LC_DISC) * PEND_QTY / QTY):
 *
 *     101 LPO-5001  2025-04-08  overdue  -1  1000  Supplier One    On Time
 *     101 LPO-5002  2025-04-07  overdue   0  1000  Supplier One    0-90   (5 of 10 pending)
 *     102 FPO-6001  2025-01-08  overdue  89   500  Supplier Two    0-90
 *     102 FPO-6002  2025-01-07  overdue  90   300  Supplier Two    90-180
 *     101 LPO-5003  2024-10-10  overdue 179   200  Supplier Three  90-180
 *     101 LPO-5004  2024-10-09  overdue 180   300  Supplier Three  180-365 (100 discount)
 *     102 LPO-6003  2024-04-08  overdue 364   250  Supplier Two    180-365
 *     102 LPO-6004  2024-04-07  overdue 365   150  (blank)         365+
 *
 * Left out: LPO-5005 (open, PO_PEND_QTY = 0) and LPO-5006 (PO_CLO_STATUS = 1).
 *
 * Receipts, Q1 2025: 5000 + 3672.5 (USD) - 800 (return) + 0 (EUR at rate 0) + 1200 (AED at rate 0,
 * not flagged) = 9072.5. Q1 2024: 4000 - 500 = 3500. The April line is outside.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { previousYear } from "@/lib/filters";
import { setRunnerForTests } from "@/lib/server/db";
import {
  agingBucket,
  BUCKET_ORDER,
  daysOverdue,
  overdueLines,
  overdueLinesQuery,
  pendingByBucket,
  pendingByCompany,
  pendingBySupplier,
  pendingKpiQuery,
  pendingKpis,
  receiptsBySupplier,
  receiptsKpis,
  receiptsMonthly,
  zeroRateReceipts,
} from "@/lib/server/queries/purchasing";
import { ALL_OTHER, UNASSIGNED } from "@/lib/server/sql";

import { Q1_2025, useFixtureSource } from "./fixture";

const TODAY = "2025-06-30";
const ALL: string[] = [];

beforeAll(() => {
  useFixtureSource();
});
afterAll(() => setRunnerForTests(undefined));

describe("pending PO filters", () => {
  it("leaves out fully received lines (PO_PEND_QTY = 0) and closed lines", async () => {
    const kpis = await pendingKpis(ALL, TODAY);
    expect(kpis.openLines).toBe(8);
    expect(kpis.pendingValue).toBeCloseTo(3700);
    const lines = await overdueLines(ALL, TODAY);
    expect(lines.map((line) => line.poNumber)).not.toContain("LPO-5005");
    expect(lines.map((line) => line.poNumber)).not.toContain("LPO-5006");
  });

  it("compares PO_CLO_STATUS as a number and requires a pending quantity", () => {
    const { sql } = pendingKpiQuery(ALL, TODAY);
    expect(sql).toContain("PO_CLO_STATUS = 0");
    expect(sql).toContain("PO_PEND_QTY > 0");
    // 'O' on a NUMBER column raises ORA-01722 on Orion.
    expect(sql).not.toMatch(/PO_CLO_STATUS\s*(=|IN|<>)\s*\(?\s*'/);
  });

  it("the company filter applies, and the date filter doesn't", async () => {
    expect((await pendingKpis(["101"], TODAY)).pendingValue).toBeCloseTo(2500);
    const { binds } = pendingKpiQuery(["101"], TODAY);
    expect(binds).toMatchObject({ company_0: "101" });
    expect(Object.keys(binds)).not.toContain("start_date");
  });

  it("splits overdue from on time", async () => {
    const kpis = await pendingKpis(ALL, TODAY);
    expect(kpis.overdueValue).toBeCloseTo(2700);
    expect(kpis.overdueLines).toBe(7);
    expect(kpis.overduePct).toBeCloseTo(2700 / 3700);
  });

  it("nothing pending gives zeros", async () => {
    const kpis = await pendingKpis(["999"], TODAY);
    expect(kpis).toEqual({
      pendingValue: 0,
      openLines: 0,
      overdueValue: 0,
      overdueLines: 0,
      overduePct: null,
    });
  });
});

describe("aging buckets", () => {
  it.each([
    ["2025-04-08", -1, "On Time"],
    ["2025-04-07", 0, "0-90 Days Overdue"],
    ["2025-01-08", 89, "0-90 Days Overdue"],
    ["2025-01-07", 90, "90-180 Days Overdue"],
    ["2024-10-10", 179, "90-180 Days Overdue"],
    ["2024-10-09", 180, "180-365 Days Overdue"],
    ["2024-04-08", 364, "180-365 Days Overdue"],
    ["2024-04-07", 365, "365+ Days Overdue"],
  ])("a PO dated %s is %i days overdue: %s", (poDate, overdue, bucket) => {
    expect(daysOverdue(poDate, TODAY)).toBe(overdue);
    expect(agingBucket(poDate, TODAY)).toBe(bucket);
  });

  it("the SQL puts each line in the same bucket, at the 89/90/180/365 boundaries", async () => {
    const buckets = await pendingByBucket(ALL, TODAY);
    expect(buckets).toEqual([
      { label: "On Time", value: 1000 },
      { label: "0-90 Days Overdue", value: 1500 },
      { label: "90-180 Days Overdue", value: 500 },
      { label: "180-365 Days Overdue", value: 550 },
      { label: "365+ Days Overdue", value: 150 },
    ]);
    const lines = await overdueLines(ALL, TODAY);
    for (const line of lines) {
      expect(
        buckets.find((bucket) => bucket.label === agingBucket(line.poDate, TODAY))!.value,
      ).toBeGreaterThan(0);
    }
  });

  it("every bucket is listed in order, even empty ones", async () => {
    const buckets = await pendingByBucket(["101"], TODAY);
    expect(buckets.map((bucket) => bucket.label)).toEqual([...BUCKET_ORDER]);
    expect(buckets.find((bucket) => bucket.label === "365+ Days Overdue")!.value).toBe(0);
  });
});

describe("pending breakdowns", () => {
  it("by supplier, blanks as Unassigned, top N folds the rest", async () => {
    expect(await pendingBySupplier(ALL, TODAY)).toEqual([
      { label: "Supplier One", value: 2000 },
      { label: "Supplier Two", value: 1050 },
      { label: "Supplier Three", value: 500 },
      { label: UNASSIGNED, value: 150 },
    ]);
    expect(await pendingBySupplier(ALL, TODAY, 1)).toEqual([
      { label: "Supplier One", value: 2000 },
      { label: ALL_OTHER, value: 1700 },
    ]);
  });

  it("by company", async () => {
    expect(await pendingByCompany(ALL, TODAY)).toEqual([
      { label: "101", value: 2500 },
      { label: "102", value: 1200 },
    ]);
  });
});

describe("overdue lines", () => {
  it("lists overdue lines only, largest first, with days open", async () => {
    const lines = await overdueLines(ALL, TODAY);
    expect(lines.map((line) => line.poNumber)).toEqual([
      "LPO-5002",
      "FPO-6001",
      "LPO-5004",
      "FPO-6002",
      "LPO-6003",
      "LPO-5003",
      "LPO-6004",
    ]);
    expect(lines[0]).toEqual({
      companyCode: "101",
      poNumber: "LPO-5002",
      supplier: "Supplier One",
      itemCode: "I2",
      item: "Item Two",
      poDate: "2025-04-07",
      daysOpen: 84,
      daysOverdue: 0,
      pendingQty: 5,
      pendingValue: 1000,
    });
    // A blank item description falls back to the item code; blank supplier to Unassigned.
    expect(lines.at(-1)).toMatchObject({ item: "I8", supplier: UNASSIGNED, pendingQty: 1.5, daysOpen: 449 });
  });

  it("is capped at the row limit", async () => {
    expect(await overdueLines(ALL, TODAY, 2)).toHaveLength(2);
    expect(overdueLinesQuery(ALL, TODAY).binds.row_limit).toBe(1000);
  });
});

describe("receipts", () => {
  it("spend for the period; returns to supplier reduce it", async () => {
    const kpis = await receiptsKpis(Q1_2025);
    expect(kpis.spend).toBeCloseTo(9072.5);
    expect(kpis.returnsValue).toBeCloseTo(-800);
    expect(kpis.spend).toBeCloseTo(5000 + 3672.5 + 1200 - 800);
    expect(kpis.lineCount).toBe(5);
  });

  it("last year and one company", async () => {
    expect((await receiptsKpis(previousYear(Q1_2025))).spend).toBeCloseTo(3500);
    expect((await receiptsKpis({ ...Q1_2025, companies: ["101"] })).spend).toBeCloseTo(5400);
  });

  it("monthly, this year vs last year", async () => {
    const months = await receiptsMonthly(Q1_2025);
    expect(months).toEqual([
      { month: "2025-01", spend: 5000, lastYearSpend: 0 },
      { month: "2025-02", spend: 2872.5, lastYearSpend: 4000 },
      { month: "2025-03", spend: 1200, lastYearSpend: -500 },
    ]);
  });

  it("top suppliers by spend", async () => {
    expect(await receiptsBySupplier(Q1_2025)).toEqual([
      { label: "Supplier One", value: 5400 },
      { label: "Supplier Two", value: 3672.5 },
      { label: "Supplier Three", value: 0 },
    ]);
  });
});

describe("zero exchange rate warning", () => {
  it("flags non-AED lines with rate 0, not AED ones", async () => {
    expect(await zeroRateReceipts(Q1_2025)).toEqual([
      { currency: "EUR", lineCount: 1, fcValue: 2000, landedValue: 0 },
    ]);
  });

  it("follows the filters, and is empty when there are none", async () => {
    expect(await zeroRateReceipts({ ...Q1_2025, companies: ["101"] })).toEqual([]);
    expect(await zeroRateReceipts(previousYear(Q1_2025))).toEqual([]);
  });
});
