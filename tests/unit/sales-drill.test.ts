/**
 * The Sales drill-down (period → documents → lines) and the month → week → day table, against the
 * hand-checked fixture described at the top of sales.test.ts. Q1 2025 has five documents:
 *
 *     102 IN5 2001  2025-02-05  net 2000  cost 1500
 *     101 IU5 1001  2025-01-10  net 1500  cost  900   (two lines: 1000 / 600 and 500 / 300)
 *     102 INP 4002  2025-03-15  net  800  cost    0   (blank customer and salesperson)
 *     101 SRU 3001  2025-02-20  net -200  cost -120   (return)
 *     102 DNP 4001  2025-03-01  net    0  cost  400   (zero-value delivery note)
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { setRunnerForTests } from "@/lib/server/db";
import {
  dailyQuery,
  documentLinesQuery,
  documentsQuery,
  salesDaily,
  salesDocumentLines,
  salesDocuments,
  salesKpis,
  salesMonthly,
} from "@/lib/server/queries/sales";
import { UNASSIGNED } from "@/lib/server/sql";
import { buildCalendar, marginPct, totalOf } from "@/lib/sales-calendar";
import {
  docParam,
  drillFilters,
  drillRange,
  drillTitle,
  isoWeek,
  parseDocParam,
  parseDrill,
  rangeDrill,
} from "@/lib/sales-drill";

import { Q1_2025, useFixtureSource } from "./fixture";

beforeAll(() => {
  useFixtureSource();
});
afterAll(() => setRunnerForTests(undefined));

describe("drill periods", () => {
  it("parses a month, a day and a range", () => {
    expect(parseDrill("2026-02")).toEqual({ start: "2026-02-01", end: "2026-02-28" });
    expect(parseDrill("2024-02")).toEqual({ start: "2024-02-01", end: "2024-02-29" });
    expect(parseDrill("2026-12")).toEqual({ start: "2026-12-01", end: "2026-12-31" });
    expect(parseDrill("2026-10-14")).toEqual({ start: "2026-10-14", end: "2026-10-14" });
    expect(parseDrill("2026-10-12..2026-10-18")).toEqual({ start: "2026-10-12", end: "2026-10-18" });
  });

  it("rejects anything else", () => {
    for (const bad of [
      null,
      "",
      "2026-13",
      "2026-1",
      "2026-02-30",
      "2026-10-18..2026-10-12",
      "a..b..c",
      "2026-10-01..x",
    ]) {
      expect(parseDrill(bad)).toBeNull();
    }
  });

  it("cuts the period to the filtered range", () => {
    const filters = { ...Q1_2025, start: "2025-01-15", end: "2025-03-10" };
    expect(drillRange("2025-01", filters)).toEqual({ start: "2025-01-15", end: "2025-01-31" });
    expect(drillRange("2025-03", filters)).toEqual({ start: "2025-03-01", end: "2025-03-10" });
    expect(drillRange("2025-02", filters)).toEqual({ start: "2025-02-01", end: "2025-02-28" });
    expect(drillRange("2025-04", filters)).toBeNull();
    expect(drillRange("2025-01-14", filters)).toBeNull();
  });

  it("keeps every other filter", () => {
    const filters = { ...Q1_2025, companies: ["101"] };
    expect(drillFilters(filters, { start: "2025-02-01", end: "2025-02-28" })).toEqual({
      range: "custom",
      start: "2025-02-01",
      end: "2025-02-28",
      companies: ["101"],
    });
  });

  it("titles the period", () => {
    expect(drillTitle("2025-02", { start: "2025-02-01", end: "2025-02-28" })).toBe("Feb 2025");
    expect(drillTitle("2025-02", { start: "2025-02-01", end: "2025-02-20" })).toBe(
      "Feb 2025 (1 Feb 2025 – 20 Feb 2025)",
    );
    expect(drillTitle("2026-10-12..2026-10-18", { start: "2026-10-12", end: "2026-10-18" })).toBe(
      "Week 42 · 12–18 Oct 2026",
    );
    expect(drillTitle("2026-10-14", { start: "2026-10-14", end: "2026-10-14" })).toBe("14 Oct 2026");
    expect(rangeDrill("2026-10-14", "2026-10-14")).toBe("2026-10-14");
    expect(rangeDrill("2026-10-12", "2026-10-18")).toBe("2026-10-12..2026-10-18");
  });

  it("round-trips a document key and rejects bad ones", () => {
    const key = { company: "101", txnCode: "IU5", no: "1001" };
    expect(parseDocParam(docParam(key))).toEqual(key);
    for (const bad of [null, "", "101~IU5", "101~IU5~1~2", "101~I U5~1", "101~~1"]) {
      expect(parseDocParam(bad)).toBeNull();
    }
  });
});

describe("ISO weeks", () => {
  it("start on Monday, and week 1 holds the first Thursday", () => {
    expect(isoWeek("2026-01-01")).toEqual({ year: 2026, week: 1 }); // Thursday
    expect(isoWeek("2025-12-29")).toEqual({ year: 2026, week: 1 }); // Monday before it
    expect(isoWeek("2025-12-28")).toEqual({ year: 2025, week: 52 }); // Sunday
    expect(isoWeek("2027-01-01")).toEqual({ year: 2026, week: 53 }); // Friday: still 2026
    expect(isoWeek("2027-01-04")).toEqual({ year: 2027, week: 1 });
    expect(isoWeek("2026-10-12")).toEqual({ year: 2026, week: 42 });
    expect(isoWeek("2026-10-18")).toEqual({ year: 2026, week: 42 });
    expect(isoWeek("2026-10-19")).toEqual({ year: 2026, week: 43 });
  });
});

describe("month → week → day calendar", () => {
  const days = [
    { date: "2026-09-30", netRevenue: 100, cost: 60, returnsValue: 0, invoiceCount: 2 },
    { date: "2026-10-01", netRevenue: 50, cost: 20, returnsValue: -10, invoiceCount: 1 },
    { date: "2026-10-05", netRevenue: -30, cost: -10, returnsValue: -30, invoiceCount: 0 },
  ];
  const months = buildCalendar("2026-09-28", "2026-10-06", days);

  it("has a row for every day, zeros included", () => {
    const dayRows = months.flatMap((month) => month.children.flatMap((week) => week.children));
    expect(dayRows.map((row) => row.start)).toEqual([
      "2026-09-28",
      "2026-09-29",
      "2026-09-30",
      "2026-10-01",
      "2026-10-02",
      "2026-10-03",
      "2026-10-04",
      "2026-10-05",
      "2026-10-06",
    ]);
    expect(dayRows[0]).toMatchObject({
      label: "Mon 28 Sep 2026",
      netRevenue: 0,
      sellingDays: 0,
      drill: "2026-09-28",
    });
    // A return-only day sells nothing.
    expect(dayRows[7]).toMatchObject({ netRevenue: -30, sellingDays: 0 });
  });

  it("splits an ISO week that runs across a month end", () => {
    expect(months.map((month) => [month.label, month.drill])).toEqual([
      ["Sep 2026", "2026-09"],
      ["Oct 2026", "2026-10"],
    ]);
    // Week 40 is 28 Sep – 4 Oct: three days in September, four in October.
    expect(months[0].children.map((week) => [week.label, week.drill])).toEqual([
      ["Week 40 · 28–30 Sep 2026", "2026-09-28..2026-09-30"],
    ]);
    expect(months[1].children.map((week) => [week.label, week.drill])).toEqual([
      ["Week 40 · 1–4 Oct 2026", "2026-10-01..2026-10-04"],
      ["Week 41 · 5–6 Oct 2026", "2026-10-05..2026-10-06"],
    ]);
  });

  it("rolls the figures up so they reconcile", () => {
    expect(months[0]).toMatchObject({ netRevenue: 100, cost: 60, invoiceCount: 2, sellingDays: 1 });
    expect(months[1]).toMatchObject({
      netRevenue: 20,
      cost: 10,
      returnsValue: -40,
      invoiceCount: 1,
      sellingDays: 1,
    });
    expect(totalOf(months)).toEqual({
      sellingDays: 2,
      invoiceCount: 3,
      netRevenue: 120,
      cost: 70,
      returnsValue: -40,
    });
    expect(marginPct(totalOf(months))).toBeCloseTo(50 / 120);
    expect(marginPct({ netRevenue: 0, cost: 5 })).toBeNull();
  });
});

describe("query builders", () => {
  it("apply every filter through binds, never inline", () => {
    const filters = { ...Q1_2025, companies: ["101", "102"] };
    const doc = { company: "101", txnCode: "IU5", no: "1001" };
    for (const query of [
      dailyQuery(filters),
      documentsQuery(filters, 50),
      documentLinesQuery(filters, doc),
    ]) {
      expect(query.sql).toContain("CSL_TXN_TYPE IN ('INV', 'SARTN')");
      expect(query.sql).toContain("CSL_COMP_CODE IN (:company_0, :company_1)");
      expect(query.sql).not.toContain("2025-01-01");
      expect(query.binds).toMatchObject({
        start_date: "2025-01-01",
        end_date_exclusive: "2025-04-01",
        company_0: "101",
      });
    }
    expect(documentsQuery(filters, 50).binds.row_limit).toBe(50);
    expect(documentLinesQuery(filters, doc).binds).toMatchObject({
      doc_company: "101",
      doc_txn_code: "IU5",
      doc_no: "1001",
    });
    expect(documentLinesQuery(filters, doc).sql).not.toContain("IU5");
  });
});

describe("drill-down figures", () => {
  it("lists the documents largest first, returns and delivery notes included", async () => {
    const result = await salesDocuments(Q1_2025);
    expect(result.total).toBe(5);
    expect(result.documents.map((doc) => `${doc.company}-${doc.txnCode}-${doc.no}`)).toEqual([
      "102-IN5-2001",
      "101-IU5-1001",
      "102-INP-4002",
      "101-SRU-3001",
      "102-DNP-4001",
    ]);
    expect(result.documents[1]).toMatchObject({
      date: "2025-01-10",
      txnType: "INV",
      customerCode: "CA",
      customer: "Customer A",
      salesperson: "Alice",
      netValue: 1500,
      cost: 900,
    });
    expect(result.documents[1].marginPct).toBeCloseTo(0.4);
    expect(result.documents[2]).toMatchObject({
      customerCode: "CU",
      customer: UNASSIGNED,
      salesperson: UNASSIGNED,
    });
    expect(result.documents[3]).toMatchObject({ txnType: "SARTN", netValue: -200, cost: -120 });
    expect(result.documents[4]).toMatchObject({ netValue: 0, cost: 400, marginPct: null });
  });

  it("totals equal the KPIs and the month's bar, whatever the limit", async () => {
    const capped = await salesDocuments(Q1_2025, 2);
    expect(capped.documents).toHaveLength(2);
    expect(capped.total).toBe(5);
    expect(capped.totals).toEqual(await salesKpis(Q1_2025));

    const [, february] = await salesMonthly(Q1_2025);
    const range = drillRange("2025-02", Q1_2025)!;
    const drilled = await salesDocuments(drillFilters(Q1_2025, range));
    expect(drilled.totals.netRevenue).toBeCloseTo(february.netRevenue);
    expect(drilled.totals.netRevenue).toBeCloseTo(1800);
    expect(drilled.documents.reduce((sum, doc) => sum + doc.netValue, 0)).toBeCloseTo(1800);
  });

  it("applies the company filter", async () => {
    const result = await salesDocuments({ ...Q1_2025, companies: ["101"] });
    expect(result.documents.map((doc) => doc.company)).toEqual(["101", "101"]);
    expect(result.totals.netRevenue).toBeCloseTo(1300);
  });

  it("lists one document's lines", async () => {
    const lines = await salesDocumentLines(Q1_2025, { company: "101", txnCode: "IU5", no: "1001" });
    expect(lines).toEqual([
      { itemCode: "IX", item: "Item X", quantity: 10, netValue: 1000, cost: 600, marginPct: 0.4 },
      { itemCode: "IY", item: "Item Y", quantity: 5, netValue: 500, cost: 300, marginPct: 0.4 },
    ]);
    // Outside the drilled period, nothing.
    const outside = drillFilters(Q1_2025, { start: "2025-02-01", end: "2025-02-28" });
    expect(await salesDocumentLines(outside, { company: "101", txnCode: "IU5", no: "1001" })).toEqual([]);
  });

  it("daily figures reconcile to the KPIs", async () => {
    const days = await salesDaily(Q1_2025);
    expect(days.map((day) => day.date)).toEqual([
      "2025-01-10",
      "2025-02-05",
      "2025-02-20",
      "2025-03-01",
      "2025-03-15",
    ]);
    const months = buildCalendar(Q1_2025.start, Q1_2025.end, days);
    const total = totalOf(months);
    const kpis = await salesKpis(Q1_2025);
    expect(total.netRevenue).toBeCloseTo(kpis.netRevenue);
    expect(total.cost).toBeCloseTo(kpis.cost);
    expect(total.returnsValue).toBeCloseTo(kpis.returnsValue);
    expect(total.invoiceCount).toBe(kpis.invoiceCount);
    expect(total.sellingDays).toBe(3);
    expect(months.flatMap((month) => month.children.flatMap((week) => week.children))).toHaveLength(90);
  });
});
