/**
 * Sales-order book numbers against values worked out by hand from tests/fixtures/ZF_SO_BI.csv.
 *
 * Open book as of 2025-06-30 (pending value = D_FC_VAL * (D_QTY - D_DELIVERED_QTY) / D_QTY):
 *
 *     order     date        expected     cur  pending  value  bucket   salesperson  customer
 *     SO5-1001  2025-06-20  25-Jul-2025  AED  10 of 10  1000  <30 D    Sales One    Customer A
 *     SO5-1001  2025-06-20  25-Jul-2025  AED   3 of 4    300  <30 D    Sales One    Customer A
 *     SO5-1003  2025-04-10  20-Apr-2025  AED   6 of 8    600  2-3 M    Sales Two    Customer B  overdue 71
 *     SOU-2001  2025-01-15  31-Jan-2025  AED   2 of 2   2000  3-6 M    (blank)      Customer C  overdue 150
 *     SOU-2002  2024-09-01  15-Sep-2024  USD  10 of 10  1000  6-12 M   Sales One    Customer D  overdue
 *     SO5-1004  2023-03-01  10-Mar-2023  AED   1 of 1    150  2+ Y     Sales One    Customer A  overdue 843
 *     SO5-1005  2024-05-01  10-Jul-2025  AED   3 of 6    300  1-2 Y    Sales Two    Customer E
 *     SO5-1006  2025-06-30  30-Jun-2025  AED   2 of 2      0  <30 D    Sales One    Customer B  due today
 *
 * Open: 8 lines, 7 orders; AED value 4350 over 7 lines. Overdue: 4 lines, AED 2750.
 * Delivered not invoiced: SO5-1002 3 of 5 = 300 and SO5-1005 3 of 6 = 300, so 600 over 2 lines.
 *
 * Left out of the open book: SO5-1002 (fully delivered), SOU-2003 (Closed, nothing delivered),
 * SOU-2004 (Closed after delivering 4, 2 of them not invoiced), SO5-1008 (over-delivered) and
 * SO5-1009 (delivered and invoiced).
 *
 * Booked: Q1 2025 = SOU-2001 2000 + SO5-1008 500, 2 orders. Q1 2024 = SO5-1009 900, 1 order
 * (SOU-2003 was cancelled). 2023 = SOU-2004 400 (4 of 10 delivered before it closed) + SO5-1004 150.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { AGING_BUCKETS } from "@/lib/aging";
import type { Filters } from "@/lib/filters";
import { setRunnerForTests } from "@/lib/server/db";
import {
  bookedKpis,
  bookedMonthly,
  openBookKpis,
  openByAge,
  openByAgeQuery,
  openByCurrency,
  openByCurrencyQuery,
  openByCustomer,
  openByCustomerQuery,
  openBySalesperson,
  openBySalespersonQuery,
  openKpiQuery,
  openLines,
  openLinesQuery,
  pendingValue,
} from "@/lib/server/queries/sales-orders";
import { ALL_OTHER, UNASSIGNED } from "@/lib/server/sql";

import { Q1_2025, useFixtureSource } from "./fixture";

const TODAY = "2025-06-30";
const ALL: string[] = [];

function period(start: string, end: string, companies: string[] = []): Filters {
  return { range: "custom", start, end, companies };
}

beforeAll(() => {
  useFixtureSource();
});
afterAll(() => setRunnerForTests(undefined));

describe("pending value", () => {
  it.each([
    [1000, 10, 0, 1000],
    [400, 4, 1, 300],
    [800, 8, 2, 600],
    [500, 5, 5, 0],
    [500, 5, 6, 0],
    [100, 0, 0, 0],
  ])("net %d, ordered %d, delivered %d: %d pending", (net, ordered, delivered, expected) => {
    expect(pendingValue(net, ordered, delivered)).toBeCloseTo(expected);
  });
});

/**
 * Order age as of 2025-06-30. Last 2 years (from 2023-06-30) leaves out SO5-1004 (2023-03-01, 150,
 * overdue). Last 12 months (from 2024-06-30) also leaves out SO5-1005 (2024-05-01, 300 pending and
 * 300 delivered not invoiced).
 */
describe("order age", () => {
  it("binds the cut-off as a date on H_DT, and nothing for all", () => {
    for (const query of [
      openByAgeQuery(ALL, TODAY, "2y"),
      openBySalespersonQuery(ALL, TODAY, "2y"),
      openByCustomerQuery(ALL, TODAY, "2y"),
      openByCurrencyQuery(ALL, TODAY, "2y"),
      openLinesQuery(ALL, TODAY, "2y"),
    ]) {
      expect(query.binds.since_date).toBe("2023-06-30");
      expect(query.sql).toContain("AND H_DT >= TO_DATE(:since_date, 'YYYY-MM-DD')");
    }
    expect(openByAgeQuery(ALL, TODAY, "12m").binds.since_date).toBe("2024-06-30");
    expect(openByAgeQuery(ALL, TODAY, "all").binds).not.toHaveProperty("since_date");
    expect(openByAgeQuery(ALL, TODAY, "all").sql).not.toContain("since_date");
  });

  it("the KPI query keeps older lines and counts them separately, in one round trip", async () => {
    const { sql, binds } = openKpiQuery(ALL, TODAY, "2y");
    expect(binds.since_date).toBe("2023-06-30");
    // A flag, not a WHERE: the hidden lines are summed in the same query.
    expect(sql).not.toMatch(/AND H_DT >= /);
    expect(await openBookKpis(ALL, TODAY, "2y")).toEqual({
      openValue: 4200,
      openOrders: 6,
      openLines: 7,
      openAedLines: 6,
      uninvoicedValue: 600,
      uninvoicedLines: 2,
      overdueValue: 2600,
      overdueLines: 3,
      hiddenLines: 1,
      hiddenValue: 150,
    });
    expect(await openBookKpis(ALL, TODAY, "12m")).toEqual({
      openValue: 3900,
      openOrders: 5,
      openLines: 6,
      openAedLines: 5,
      uninvoicedValue: 300,
      uninvoicedLines: 1,
      overdueValue: 2600,
      overdueLines: 3,
      hiddenLines: 2,
      hiddenValue: 450,
    });
  });

  it("every breakdown follows it and adds up to the KPI", async () => {
    const all = await openBookKpis(ALL, TODAY, "all");
    const sum = (values: number[]) => values.reduce((total, value) => total + value, 0);
    for (const age of ["2y", "12m", "all"] as const) {
      const kpis = await openBookKpis(ALL, TODAY, age);
      expect(sum(await openByAge(ALL, TODAY, age))).toBeCloseTo(kpis.openValue);
      expect(sum((await openBySalesperson(ALL, TODAY, age)).map((row) => row.value))).toBeCloseTo(
        kpis.openValue,
      );
      expect(sum((await openByCustomer(ALL, TODAY, age)).map((row) => row.value))).toBeCloseTo(
        kpis.openValue,
      );
      const lines = await openLines(ALL, TODAY, age);
      expect(lines).toHaveLength(kpis.openAedLines);
      expect(sum(lines.map((line) => line.pendingValue))).toBeCloseTo(kpis.openValue);
      // What is shown plus what is left out is the whole book.
      expect(kpis.openValue + kpis.hiddenValue).toBeCloseTo(all.openValue);
      expect(kpis.openLines + kpis.hiddenLines).toBe(all.openLines);
    }
    expect((await openLines(ALL, TODAY, "2y")).map((line) => line.orderNumber)).not.toContain("SO5-1004");
    expect((await openByAge(ALL, TODAY, "2y")).at(-1)).toBe(0);
  });
});

describe("open book KPIs", () => {
  it("adds up open, not-invoiced and overdue lines", async () => {
    expect(await openBookKpis(ALL, TODAY, "all")).toEqual({
      openValue: 4350,
      openOrders: 7,
      openLines: 8,
      openAedLines: 7,
      uninvoicedValue: 600,
      uninvoicedLines: 2,
      overdueValue: 2750,
      overdueLines: 4,
      hiddenLines: 0,
      hiddenValue: 0,
    });
  });

  it("follows the company filter, and not the date filter", async () => {
    expect((await openBookKpis(["101"], TODAY, "all")).openValue).toBeCloseTo(2350);
    expect((await openBookKpis(["102"], TODAY, "all")).openValue).toBeCloseTo(2000);
    const { binds } = openKpiQuery(["101"], TODAY, "all");
    expect(binds).toMatchObject({ company_0: "101", today: TODAY });
    expect(Object.keys(binds)).not.toContain("start_date");
  });

  it("nothing open gives zeros", async () => {
    const kpis = await openBookKpis(["999"], TODAY, "all");
    expect(Object.values(kpis).every((value) => value === 0)).toBe(true);
  });

  it("leaves out Closed orders, fully delivered and over-delivered lines", async () => {
    const lines = await openLines(ALL, TODAY, "all");
    const orders = lines.map((line) => line.orderNumber);
    for (const order of ["SO5-1002", "SOU-2003", "SOU-2004", "SO5-1008", "SO5-1009"]) {
      expect(orders).not.toContain(order);
    }
    const { sql } = openKpiQuery(ALL, TODAY, "all");
    expect(sql).toContain("<> 'Closed'");
    // The documented 'C' status doesn't exist in Orion.
    expect(sql).not.toMatch(/STATUS[^,]*'C'/);
  });

  it("keeps non-AED orders out of the AED totals and lists them per currency", async () => {
    expect(await openByCurrency(ALL, TODAY, "all")).toEqual([{ currency: "USD", lines: 1, openValue: 1000 }]);
    expect(await openByCurrency(["101"], TODAY, "all")).toEqual([]);
  });
});

describe("breakdowns add up to the open value", () => {
  it("by order age, in ladder order", async () => {
    const buckets = await openByAge(ALL, TODAY, "all");
    expect(buckets).toEqual([1300, 0, 600, 2000, 0, 300, 150]);
    expect(buckets).toHaveLength(AGING_BUCKETS.length);
    expect(buckets.reduce((sum, value) => sum + value, 0)).toBeCloseTo(4350);
  });

  it("by salesperson, blank as Unassigned", async () => {
    expect(await openBySalesperson(ALL, TODAY, "all")).toEqual([
      { label: UNASSIGNED, value: 2000 },
      { label: "Sales One", value: 1450 },
      { label: "Sales Two", value: 900 },
    ]);
    expect(await openBySalesperson(ALL, TODAY, "all", 1)).toEqual([
      { label: UNASSIGNED, value: 2000 },
      { label: ALL_OTHER, value: 2350 },
    ]);
  });

  it("by customer, the tail folded into All other", async () => {
    expect(await openByCustomer(ALL, TODAY, "all")).toEqual([
      { label: "Customer C", value: 2000 },
      { label: "Customer A", value: 1450 },
      { label: "Customer B", value: 600 },
      { label: "Customer E", value: 300 },
    ]);
    const top2 = await openByCustomer(ALL, TODAY, "all", 2);
    expect(top2.at(-1)).toEqual({ label: ALL_OTHER, value: 900 });
    expect(top2.reduce((sum, row) => sum + row.value, 0)).toBeCloseTo(4350);
  });

  // Live Orion: H_CUST_NAME is a lookup Orion runs per row, and grouping the open book by it took
  // 9-38 s. Grouping by code and naming the codes from ZF_CUSTOMER takes about a second.
  it("groups by customer code and names the codes from the customer master", () => {
    const { sql } = openByCustomerQuery(ALL, TODAY, "all");
    expect(sql).not.toContain("H_CUST_NAME");
    expect(sql).toContain("GROUP BY cust_code");
    expect(sql).toContain("LEFT JOIN MBALI.ZF_CUSTOMER c ON c.CUST_CODE = by_code.cust_code");
  });

  // Live Orion: a WHERE on the book's computed columns (pend_qty, is_aed) made the first run of each
  // new query text pick a 5 s plan for the view; summing conditionally keeps it under a second.
  it("never filters the open book on its computed columns in a WHERE", () => {
    const queries = [
      openByAgeQuery(ALL, TODAY, "all"),
      openBySalespersonQuery(ALL, TODAY, "all"),
      openByCustomerQuery(ALL, TODAY, "all"),
      openByCurrencyQuery(ALL, TODAY, "all"),
      openLinesQuery(ALL, TODAY, "all"),
    ];
    for (const { sql } of queries) {
      expect(sql).not.toMatch(/WHERE\s+pend_qty/);
      expect(sql).not.toMatch(/WHERE[^\n]*is_aed\s*=/);
    }
  });

  it("adds up two codes that share a customer name, as grouping by name did", async () => {
    // Customer A is CA (SO5-1001, 1300) and CA2 (SO5-1004, 150) in the fixture.
    const rows = await openByCustomer(ALL, TODAY, "all");
    expect(rows.filter((row) => row.label === "Customer A")).toEqual([{ label: "Customer A", value: 1450 }]);
  });
});

describe("open lines table", () => {
  it("lists AED open lines, largest first, with expected date and days overdue", async () => {
    const lines = await openLines(ALL, TODAY, "all");
    expect(lines.map((line) => [line.orderNumber, line.pendingValue])).toEqual([
      ["SOU-2001", 2000],
      ["SO5-1001", 1000],
      ["SO5-1003", 600],
      ["SO5-1005", 300],
      ["SO5-1001", 300],
      ["SO5-1004", 150],
      ["SO5-1006", 0],
    ]);
    expect(lines[0]).toEqual({
      companyCode: "102",
      orderNumber: "SOU-2001",
      orderDate: "2025-01-15",
      customer: "Customer C",
      salesperson: UNASSIGNED,
      item: "Item Four",
      orderedQty: 2,
      deliveredQty: 0,
      invoicedQty: 0,
      pendingValue: 2000,
      expectedDate: "2025-01-31",
      daysOverdue: 150,
    });
    const byOrder = new Map(lines.map((line) => [line.orderNumber, line]));
    expect(byOrder.get("SO5-1003")?.daysOverdue).toBe(71);
    expect(byOrder.get("SO5-1004")?.daysOverdue).toBe(843);
    // Due today is not overdue yet; a blank description falls back to the item code.
    expect(byOrder.get("SO5-1006")).toMatchObject({
      expectedDate: "2025-06-30",
      daysOverdue: null,
      item: "I2",
    });
    expect(byOrder.get("SO5-1005")).toMatchObject({ deliveredQty: 3, invoicedQty: 0, daysOverdue: null });
  });

  it("is capped at the row limit", async () => {
    expect(await openLines(ALL, TODAY, "all", 2)).toHaveLength(2);
  });
});

describe("orders booked in the period", () => {
  it("counts orders and AED value, without cancelled ones", async () => {
    expect(await bookedKpis(Q1_2025)).toEqual({ orders: 2, value: 2500 });
    expect(await bookedKpis(period("2024-01-01", "2024-03-31"))).toEqual({ orders: 1, value: 900 });
  });

  it("counts only the delivered part of a Closed line", async () => {
    expect(await bookedKpis(period("2023-01-01", "2023-12-31"))).toEqual({ orders: 2, value: 550 });
  });

  it("follows the company filter", async () => {
    expect(await bookedKpis({ ...Q1_2025, companies: ["102"] })).toEqual({ orders: 1, value: 2000 });
  });

  it("gives every month of the period against the same month last year", async () => {
    const months = await bookedMonthly(Q1_2025);
    expect(months).toEqual([
      { month: "2025-01", orders: 1, value: 2000, lastYearOrders: 0, lastYearValue: 0 },
      { month: "2025-02", orders: 0, value: 0, lastYearOrders: 1, lastYearValue: 900 },
      { month: "2025-03", orders: 1, value: 500, lastYearOrders: 0, lastYearValue: 0 },
    ]);
    const total = months.reduce((sum, month) => sum + month.value, 0);
    expect(total).toBe((await bookedKpis(Q1_2025)).value);
  });
});
