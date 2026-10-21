/**
 * POST /api/cron/warm, called directly: auth, the timings it answers with, and that it warms what
 * the pages actually load. For that, every page's default view is "rendered" after a warm-up by
 * calling its server section components with the props the page gives them; none of them may
 * reach the data source.
 */
import { isValidElement, type ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import * as overviewSections from "@/app/_overview/sections";
import { GET, POST } from "@/app/api/cron/warm/route";
import * as financeSections from "@/app/finance/sections";
import FinancePage from "@/app/finance/page";
import * as inventorySections from "@/app/inventory/sections";
import InventoryPage from "@/app/inventory/page";
import OverviewPage from "@/app/page";
import * as productSections from "@/app/products/sections";
import ProductsPage from "@/app/products/page";
import * as purchasingSections from "@/app/purchasing/sections";
import PurchasingPage from "@/app/purchasing/page";
import * as arApSections from "@/app/receivables-payables/sections";
import ReceivablesPayablesPage from "@/app/receivables-payables/page";
import * as salesOrderSections from "@/app/sales-orders/sections";
import SalesOrdersPage from "@/app/sales-orders/page";
import * as salesSections from "@/app/sales/sections";
import SalesPage from "@/app/sales/page";
import { todayIso } from "@/lib/filters";
import { setRunnerForTests } from "@/lib/server/db";
import { companies } from "@/lib/server/queries/common";
import { SampleSource } from "@/lib/server/sample";
import type { WarmResult } from "@/lib/server/warm";

const SECRET = "test-cron-secret";
const TODAY = todayIso();
const sample = new SampleSource({
  rebaseToYear: Number(TODAY.slice(0, 4)),
  rebaseToMonth: TODAY.slice(0, 7),
  anchorToDate: TODAY,
});

let reads: string[];

beforeEach(() => {
  vi.stubEnv("CRON_SECRET", SECRET);
  vi.spyOn(console, "info").mockImplementation(() => {});
  reads = [];
  setRunnerForTests((sql, binds) => {
    reads.push(sql.replace(/\s+/g, " ").slice(0, 120));
    return sample.query(sql, binds);
  });
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  setRunnerForTests(undefined);
});

function post(authorization?: string): Promise<Response> {
  return POST(
    new Request("http://localhost:3000/api/cron/warm", {
      method: "POST",
      headers: authorization ? { Authorization: authorization } : {},
    }),
  );
}

type Component = (props: Record<string, unknown>) => ReactNode | Promise<ReactNode>;

const SECTION_MODULES: Record<string, unknown>[] = [
  overviewSections as Record<string, unknown>,
  salesSections as Record<string, unknown>,
  productSections as Record<string, unknown>,
  financeSections as Record<string, unknown>,
  inventorySections as Record<string, unknown>,
  purchasingSections as Record<string, unknown>,
  arApSections as Record<string, unknown>,
  salesOrderSections as Record<string, unknown>,
];
const SECTIONS = new Set<unknown>(
  SECTION_MODULES.flatMap((module) => Object.values(module).filter((value) => typeof value === "function")),
);

/** Call every server section component in the tree, as React would, and walk what they return. */
async function renderSections(node: ReactNode | Promise<ReactNode>): Promise<number> {
  const resolved = await node;
  if (Array.isArray(resolved)) {
    let count = 0;
    for (const child of resolved) count += await renderSections(child);
    return count;
  }
  if (!isValidElement<Record<string, unknown>>(resolved)) return 0;
  const { type, props } = resolved;
  if (SECTIONS.has(type)) {
    return 1 + (await renderSections((type as Component)(props)));
  }
  return renderSections(props.children as ReactNode);
}

type PageComponent = (props: { searchParams: Promise<Record<string, string>> }) => Promise<ReactNode>;

const PAGES: [string, PageComponent][] = [
  ["/", OverviewPage as unknown as PageComponent],
  ["/sales", SalesPage as unknown as PageComponent],
  ["/products", ProductsPage as unknown as PageComponent],
  ["/finance", FinancePage as unknown as PageComponent],
  ["/inventory", InventoryPage as unknown as PageComponent],
  ["/purchasing", PurchasingPage as unknown as PageComponent],
  ["/receivables-payables", ReceivablesPayablesPage as unknown as PageComponent],
  ["/sales-orders", SalesOrdersPage as unknown as PageComponent],
];

describe("POST /api/cron/warm", () => {
  it("refuses a missing or wrong token with 401, without touching the source", async () => {
    for (const header of [undefined, "Bearer wrong", `Basic ${SECRET}`, SECRET]) {
      const response = await post(header);
      expect(response.status, String(header)).toBe(401);
      expect(response.headers.get("WWW-Authenticate")).toBe("Bearer");
    }
    expect(reads).toEqual([]);
  });

  it("is switched off (503) while CRON_SECRET is unset", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.stubEnv("CRON_SECRET", "");
    expect((await post("Bearer ")).status).toBe(503);
  });

  it("answers 200 with every section's time with the right token", async () => {
    const response = await post(`Bearer ${SECRET}`);
    expect(response.status).toBe(200);
    const body = (await response.json()) as WarmResult;
    expect(body.ok).toBe(true);
    expect(body.today).toBe(TODAY);
    expect(new Set(body.sections.map((section) => section.page))).toEqual(
      new Set(["(shell)", ...PAGES.map(([path]) => path)]),
    );
    for (const section of body.sections) {
      expect(section.ok, `${section.page} ${section.section}`).toBe(true);
      expect(section.ms).toBeGreaterThanOrEqual(0);
    }
    expect(body.sections.find((s) => s.section.startsWith("Receivables tiles"))).toBeDefined();
  });

  it("warms everything the default view of every page loads", async () => {
    expect((await post(`Bearer ${SECRET}`)).status).toBe(200);
    expect(reads.length).toBeGreaterThan(0);
    reads = [];
    await companies(); // the Filters panel's company list
    for (const [path, Page] of PAGES) {
      const rendered = await renderSections(Page({ searchParams: Promise.resolve({}) }));
      expect(rendered, path).toBeGreaterThan(2);
      expect(reads, `${path} read the source after a warm-up`).toEqual([]);
    }
  });

  it("re-reads results older than the run, so a run every 10 minutes keeps them fresh", async () => {
    await post(`Bearer ${SECRET}`);
    const first = reads.length;
    reads = [];
    // The next run starts later than every result of the first one. Without moving the clock on, a
    // run starting in the same millisecond as the first run's last query would count that result as
    // fresh and this test would depend on how fast the machine is.
    const now = Date.now();
    vi.spyOn(Date, "now").mockReturnValue(now + 1000);
    await post(`Bearer ${SECRET}`);
    expect(reads.length).toBe(first);
  });

  it("answers 502 naming the failed sections, and still warms the rest", async () => {
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    setRunnerForTests((sql, binds) =>
      sql.includes("ZF_SOA_DETL_CUST_INV_SM_BI")
        ? Promise.reject(new Error("ORA-12541: TNS:no listener"))
        : sample.query(sql, binds),
    );
    const response = await post(`Bearer ${SECRET}`);
    expect(response.status).toBe(502);
    const body = (await response.json()) as WarmResult;
    expect(body.ok).toBe(false);
    const failed = body.sections.filter((section) => !section.ok);
    expect(failed.map((section) => section.page)).toEqual([
      "/",
      "/receivables-payables",
      "/receivables-payables",
      "/receivables-payables",
      "/receivables-payables",
    ]);
    expect(failed[0].message).toContain("Couldn't connect to Orion (ORA-12541)");
    expect(body.sections.filter((section) => section.ok).length).toBeGreaterThan(30);
    expect(errors.mock.calls.flat().join("\n")).toContain("warm-up for");
  });

  it("answers 405 to GET", () => {
    const response = GET();
    expect(response.status).toBe(405);
    expect(response.headers.get("Allow")).toBe("POST");
  });
});
