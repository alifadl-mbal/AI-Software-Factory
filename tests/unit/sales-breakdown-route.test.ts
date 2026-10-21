/** GET /api/sales/breakdown, called directly, against the hand-checked fixtures (see sales.test.ts). */
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { GET } from "@/app/api/sales/breakdown/route";
import { setRunnerForTests } from "@/lib/server/db";
import type { HoverBreakdown } from "@/lib/server/queries/sales";

import { useFixtureSource } from "./fixture";

beforeAll(() => {
  useFixtureSource();
});
afterAll(() => setRunnerForTests(undefined));

const Q1 = { range: "custom", from: "2025-01-01", to: "2025-03-31" };

async function get(
  params: Record<string, string>,
): Promise<{ status: number; body: { ok: boolean; data: HoverBreakdown } }> {
  const url = new URL("http://localhost:3000/api/sales/breakdown");
  for (const [name, value] of Object.entries(params)) url.searchParams.set(name, value);
  const response = await GET(new Request(url));
  return { status: response.status, body: await response.json() };
}

describe("GET /api/sales/breakdown", () => {
  it("a month: total, last year and the three breakdowns", async () => {
    const { status, body } = await get({ ...Q1, period: "2025-02" });
    expect(status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.data.netRevenue).toBeCloseTo(1800);
    expect(body.data.lastYearNetRevenue).toBeCloseTo(600);
    expect(body.data.breakdowns.map((entry) => entry.dimension)).toEqual([
      "company",
      "salesperson",
      "itemGroup",
    ]);
  });

  it("applies the company filter", async () => {
    const { body } = await get({ ...Q1, period: "2025-02", company: "102" });
    expect(body.data.netRevenue).toBeCloseTo(2000);
    expect(body.data.breakdowns[0].rows).toHaveLength(1);
  });

  it("a month the range cuts covers only the range's days", async () => {
    const { body } = await get({ range: "custom", from: "2025-03-01", to: "2025-03-10", period: "2025-03" });
    // Only the zero-value delivery note of 1 March; the 15 March invoice is outside.
    expect(body.data.netRevenue).toBe(0);
  });

  it("a company bar", async () => {
    const { status, body } = await get({ ...Q1, by: "company", label: "Alpha Trading" });
    expect(status).toBe(200);
    expect(body.data.netRevenue).toBeCloseTo(1300);
    expect(body.data.breakdowns.map((entry) => entry.dimension)).toEqual(["salesperson", "itemGroup"]);
  });

  it("refuses a missing or malformed request with 400", async () => {
    for (const params of [
      Q1,
      { ...Q1, period: "2025-13" },
      { ...Q1, period: "2025-02; DROP" },
      { ...Q1, period: "2026-01" },
      { ...Q1, by: "customer", label: "Customer A" },
      { ...Q1, by: "company", label: "" },
      { ...Q1, by: "company", label: "x".repeat(201) },
    ]) {
      const { status, body } = await get(params);
      expect(status, JSON.stringify(params)).toBe(400);
      expect(body.ok).toBe(false);
    }
  });

  it("treats injection-like labels as text", async () => {
    const { status, body } = await get({ ...Q1, by: "company", label: "' OR '1'='1" });
    expect(status).toBe(200);
    expect(body.data.netRevenue).toBe(0);
  });
});
