/**
 * Hover cards and drill-downs on Purchasing, Sales orders and the item page (issue #52), against
 * the hand-checked fixtures (see purchasing.test.ts, sales-orders.test.ts and sales.test.ts for the
 * figures). Every card and drill total must equal the bar it came from, so most checks here
 * reconcile them with the page's own loaders rather than restate numbers.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { GET as itemBreakdown } from "@/app/api/items/breakdown/route";
import { GET as receiptsBreakdown } from "@/app/api/purchasing/breakdown/route";
import { GET as receiptDocumentsRoute } from "@/app/api/purchasing/documents/route";
import { GET as orderBreakdown } from "@/app/api/sales-orders/breakdown/route";
import { GET as orderLinesRoute } from "@/app/api/sales-orders/order-lines/route";
import { GET as ordersRoute } from "@/app/api/sales-orders/orders/route";
import { AGING_BUCKETS } from "@/lib/aging";
import { todayIso, type Filters } from "@/lib/filters";
import { clipToBucket } from "@/lib/periods";
import { docParam } from "@/lib/sales-drill";
import { setRunnerForTests } from "@/lib/server/db";
import {
  pendingByBucket,
  pendingKpis,
  receiptDocuments,
  receiptLines,
  receiptsHover,
  receiptsKpis,
  receiptsMonthly,
} from "@/lib/server/queries/purchasing";
import { salesHoverBreakdown, salesMonthly } from "@/lib/server/queries/sales";
import {
  bookedHover,
  bookedMonthly,
  bookedOrderLines,
  bookedOrders,
  openAgeHover,
  openAgeOrders,
  openByAge,
  openOrderLines,
} from "@/lib/server/queries/sales-orders";
import { ALL_OTHER, UNASSIGNED } from "@/lib/server/sql";

import { Q1_2025, useFixtureSource } from "./fixture";

beforeAll(() => {
  useFixtureSource();
});
afterAll(() => setRunnerForTests(undefined));

const H1_2025: Filters = { ...Q1_2025, end: "2025-06-30" };
const TODAY = "2025-06-30";

function sum(values: number[]): number {
  return values.reduce((total, value) => total + value, 0);
}

function month(filters: Filters, key: string): Filters {
  return clipToBucket(filters, key)!;
}

async function json(response: Response) {
  return { status: response.status, body: await response.json() };
}

function request(path: string, params: Record<string, string>): Request {
  const url = new URL(`http://localhost:3000${path}`);
  for (const [name, value] of Object.entries(params)) url.searchParams.set(name, value);
  return new Request(url);
}

describe("Purchasing: brand filter", () => {
  it("narrows receipts through the per-item brand map", async () => {
    // Brand One is item I1: the 5000 receipt less the 800 return.
    expect((await receiptsKpis({ ...Q1_2025, brands: ["B1"] })).spend).toBeCloseTo(4200);
    // Unassigned: I3 (3672.5), I5 (0) and I2 has Brand Two, so 3672.5.
    expect((await receiptsKpis({ ...Q1_2025, brands: ["_none"] })).spend).toBeCloseTo(3672.5);
  });

  it("narrows pending POs, and the company list alone still means every brand", async () => {
    const all = await pendingKpis([], TODAY, "all");
    const branded = await pendingKpis({ companies: [], brands: ["B1"] }, TODAY, "all");
    // Brand One: LPO-5001 (I1, 1000); LPO-5005 is fully received.
    expect(branded.pendingValue).toBeCloseTo(1000);
    expect(branded.openLines).toBe(1);
    expect(
      sum((await pendingByBucket({ companies: [], brands: ["B1"] }, TODAY, "all")).map((b) => b.value)),
    ).toBeCloseTo(1000);
    expect((await pendingKpis({ companies: [], brands: [] }, TODAY, "all")).pendingValue).toBeCloseTo(
      all.pendingValue,
    );
  });
});

describe("Purchasing: receipts hover and drill", () => {
  it("February: spend, last year and its company, supplier and brand slices", async () => {
    const hover = await receiptsHover(month(Q1_2025, "2025-02"));
    expect(hover.spend).toBeCloseTo(2872.5);
    expect(hover.lastYearSpend).toBeCloseTo(4000);
    const [companies, suppliers, brands] = hover.breakdowns;
    expect(companies.rows).toEqual([
      { label: "Beta Supplies", value: 3672.5 },
      { label: "Alpha Trading", value: -800 },
    ]);
    expect(suppliers.rows.map((row) => row.label)).toEqual(["Supplier Two", "Supplier One"]);
    expect(brands.rows).toEqual([
      { label: UNASSIGNED, value: 3672.5 },
      { label: "Brand One", value: -800 },
    ]);
  });

  it("every month's card, receipts and lines add up to the bar", async () => {
    for (const filters of [Q1_2025, { ...Q1_2025, companies: ["101"] }, { ...Q1_2025, brands: ["B1"] }]) {
      for (const bar of await receiptsMonthly(filters)) {
        const days = month(filters, bar.month);
        const hover = await receiptsHover(days);
        expect(hover.spend).toBeCloseTo(bar.spend);
        for (const breakdown of hover.breakdowns)
          expect(sum(breakdown.rows.map((row) => row.value))).toBeCloseTo(bar.spend);
        const docs = await receiptDocuments(days);
        expect(docs.totals.spend).toBeCloseTo(bar.spend);
        expect(sum(docs.documents.map((doc) => doc.spend))).toBeCloseTo(bar.spend);
        for (const doc of docs.documents) {
          const lines = await receiptLines(days, doc);
          expect(sum(lines.map((line) => line.spend))).toBeCloseTo(doc.spend);
          expect(lines).toHaveLength(doc.lineCount);
        }
      }
    }
  });

  it("caps the list but not the totals", async () => {
    const docs = await receiptDocuments(Q1_2025, 2);
    expect(docs.documents).toHaveLength(2);
    expect(docs.total).toBe(5);
    expect(docs.totals.spend).toBeCloseTo(9072.5);
    expect(docs.documents[0]).toMatchObject({
      company: "101",
      txnCode: "GRN",
      no: "800",
      supplier: "Supplier One",
    });
  });

  it("the routes answer and refuse a malformed request", async () => {
    const params = { range: "custom", from: "2025-01-01", to: "2025-03-31" };
    const card = await json(
      await receiptsBreakdown(request("/api/purchasing/breakdown", { ...params, period: "2025-02" })),
    );
    expect(card.status).toBe(200);
    expect(card.body.data.spend).toBeCloseTo(2872.5);
    const docs = await json(
      await receiptDocumentsRoute(request("/api/purchasing/documents", { ...params, drill: "2025-02" })),
    );
    expect(docs.body.data.documents).toHaveLength(2);
    for (const bad of [{ period: "2025-13" }, { period: "2026-01" }, {}]) {
      expect(
        (await receiptsBreakdown(request("/api/purchasing/breakdown", { ...params, ...bad }))).status,
      ).toBe(400);
    }
    expect(
      (await receiptDocumentsRoute(request("/api/purchasing/documents", { ...params, drill: "x" }))).status,
    ).toBe(400);
  });
});

describe("Sales orders: booked hover and drill", () => {
  it("June: value, orders and brand slices", async () => {
    const hover = await bookedHover(month(H1_2025, "2025-06"));
    // SO5-1001 (1000 of I1 + 400 of I2) and SO5-1006 (0).
    expect(hover.value).toBeCloseTo(1400);
    expect(hover.orders).toBe(2);
    const brands = hover.breakdowns.find((breakdown) => breakdown.dimension === "brand")!;
    expect(brands.rows).toEqual([
      { label: "Brand One", value: 1000 },
      { label: "Brand Two", value: 400 },
    ]);
  });

  it("every month's card, orders and lines add up to the bar", async () => {
    for (const filters of [
      H1_2025,
      { ...H1_2025, companies: ["101"] },
      { ...H1_2025, salespeople: ["B1"] },
    ]) {
      for (const bar of await bookedMonthly(filters)) {
        const days = month(filters, bar.month);
        const hover = await bookedHover(days);
        expect(hover.value).toBeCloseTo(bar.value);
        expect(hover.orders).toBe(bar.orders);
        for (const breakdown of hover.breakdowns)
          expect(sum(breakdown.rows.map((row) => row.value))).toBeCloseTo(bar.value);
        const orders = await bookedOrders(days);
        expect(orders.totals).toEqual({ value: bar.value, orders: bar.orders });
        expect(orders.total).toBe(bar.orders);
        expect(sum(orders.orders.map((order) => order.value))).toBeCloseTo(bar.value);
        for (const order of orders.orders) {
          const lines = await bookedOrderLines(days, order);
          expect(sum(lines.map((line) => line.value))).toBeCloseTo(order.value);
        }
      }
    }
  });

  it("names customers from the master and keeps the codes for links", async () => {
    const { orders } = await bookedOrders(month(H1_2025, "2025-01"));
    expect(orders).toEqual([
      expect.objectContaining({
        company: "102",
        txnCode: "SOU",
        no: "2001",
        customerCode: "SC0001",
        customer: "Customer C",
        salesperson: UNASSIGNED,
        value: 2000,
      }),
    ]);
  });
});

describe("Sales orders: order-age hover and drill", () => {
  it("each column's card, orders and lines add up to the column, on every order-age choice", async () => {
    for (const age of ["2y", "12m", "all"] as const) {
      for (const scope of [
        { companies: [] as string[] },
        { companies: ["101"] },
        { companies: [], salespeople: ["A1"] },
      ]) {
        const values = await openByAge(scope, TODAY, age);
        for (let bucket = 1; bucket <= AGING_BUCKETS.length; bucket++) {
          const value = values[bucket - 1];
          const hover = await openAgeHover(scope, TODAY, age, bucket);
          expect(hover.value).toBeCloseTo(value);
          for (const breakdown of hover.breakdowns)
            expect(sum(breakdown.rows.map((row) => row.value))).toBeCloseTo(value);
          const orders = await openAgeOrders(scope, TODAY, age, bucket);
          expect(orders.totals.value).toBeCloseTo(value);
          expect(sum(orders.orders.map((order) => order.value))).toBeCloseTo(value);
          for (const order of orders.orders) {
            const lines = await openOrderLines(scope, TODAY, age, bucket, order);
            expect(sum(lines.map((line) => line.value))).toBeCloseTo(order.value);
            expect(lines).toHaveLength(order.lineCount);
          }
        }
      }
    }
  });

  it("<30 D: SO5-1001 and SO5-1006, by company and salesperson", async () => {
    const hover = await openAgeHover([], TODAY, "all", 1);
    expect(hover.value).toBeCloseTo(1300);
    expect(hover.breakdowns.map((breakdown) => breakdown.dimension)).toEqual(["company", "salesperson"]);
    expect(hover.breakdowns[1].rows).toEqual([{ label: "Sales One", value: 1300 }]);
    const { orders } = await openAgeOrders([], TODAY, "all", 1);
    expect(orders.map((order) => docParam(order))).toEqual(["101~SO5~1001", "101~SO5~1006"]);
    expect(orders[0]).toMatchObject({ customer: "Customer A", lineCount: 2, value: 1300 });
  });

  it("the routes follow ?since and refuse malformed requests", async () => {
    // The routes age the book against the real today; the fixture's orders are all years old, so
    // the 2+ Y column holds SO5-1004 (2023) at least, and "last 2 years" leaves it out.
    const today = todayIso();
    const all = await json(
      await orderBreakdown(request("/api/sales-orders/breakdown", { bucket: "7", since: "all" })),
    );
    expect(all.body.data.value).toBeCloseTo((await openByAge([], today, "all"))[6]);
    expect(all.body.data.value).toBeGreaterThan(0);
    const recent = await json(await orderBreakdown(request("/api/sales-orders/breakdown", { bucket: "7" })));
    expect(recent.body.data.value).toBe(0);
    const orders = await json(
      await ordersRoute(request("/api/sales-orders/orders", { bucket: "7", since: "all" })),
    );
    expect(orders.body.data.orders.map(docParam)).toContain("101~SO5~1004");
    const lines = await json(
      await orderLinesRoute(
        request("/api/sales-orders/order-lines", { bucket: "7", since: "all", doc: "101~SO5~1004" }),
      ),
    );
    expect(lines.body.data).toEqual([expect.objectContaining({ itemCode: "I8", value: 150 })]);
    for (const params of [{ bucket: "8" }, { bucket: "0" }, { bucket: "1x" }, {}]) {
      expect((await orderBreakdown(request("/api/sales-orders/breakdown", params))).status).toBe(400);
    }
    expect((await orderLinesRoute(request("/api/sales-orders/order-lines", { bucket: "1" }))).status).toBe(
      400,
    );
  });
});

describe("Item page: hover by company", () => {
  it("a month of one item adds up to its units and net revenue", async () => {
    for (const code of ["I1", "I2", "I3"]) {
      for (const bar of await salesMonthly(Q1_2025, { item: code })) {
        const hover = await salesHoverBreakdown(month(Q1_2025, bar.month), ["company"], undefined, code);
        expect(hover.netRevenue).toBeCloseTo(bar.netRevenue);
        expect(hover.quantity).toBeCloseTo(bar.quantity);
        expect(hover.lastYearNetRevenue).toBeCloseTo(bar.lastYearNetRevenue);
        expect(hover.lastYearQuantity).toBeCloseTo(bar.lastYearQuantity);
        const rows = hover.breakdowns[0].rows;
        expect(sum(rows.map((row) => row.netRevenue))).toBeCloseTo(bar.netRevenue);
        expect(sum(rows.map((row) => row.quantity))).toBeCloseTo(bar.quantity);
        expect(rows.every((row) => row.label !== ALL_OTHER || rows.length > 5)).toBe(true);
      }
    }
  });

  it("the route checks the code and the month", async () => {
    const params = { range: "custom", from: "2025-01-01", to: "2025-03-31" };
    expect(
      (await itemBreakdown(request("/api/items/breakdown", { ...params, code: "I1", period: "2025-02" })))
        .status,
    ).toBe(200);
    expect(
      (await itemBreakdown(request("/api/items/breakdown", { ...params, period: "2025-02" }))).status,
    ).toBe(400);
    expect(
      (await itemBreakdown(request("/api/items/breakdown", { ...params, code: "I1", period: "2024-02" })))
        .status,
    ).toBe(400);
  });
});
