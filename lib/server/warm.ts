import "server-only";

import { parseFilters, previousYear, todayIso, type Filters } from "@/lib/filters";

import { refreshedSince } from "./db";
import { friendlyMessage } from "./errors";
import { financeVsLastYear, salesVsLastYear, stockPosition } from "./overview";
import { apSplit, arBalances, arSummary } from "./queries/ar-ap";
import { companies } from "./queries/common";
import { expenseBreakdown, financeKpis, financeMonthly, pnlStatement } from "./queries/finance";
import {
  deadStock,
  DEFAULT_DEAD_STOCK_MONTHS,
  inventoryKpis,
  monthEndTrend,
  parseDeadStockMonths,
  reorderAlerts,
  stockBreakdown,
} from "./queries/inventory";
import {
  overdueLines,
  pendingByBucket,
  pendingByCompany,
  pendingBySupplier,
  pendingKpis,
  receiptsBySupplier,
  receiptsKpis,
  receiptsMonthly,
  zeroRateReceipts,
} from "./queries/purchasing";
import { salesBreakdown, salesKpis, salesMonthly, TOP_N as SALES_TOP_N } from "./queries/sales";
import {
  bookedKpis,
  bookedMonthly,
  openBookKpis,
  openByAge,
  openByCurrency,
  openByCustomer,
  openBySalesperson,
  openLines,
} from "./queries/sales-orders";

/**
 * The warm-up job behind `POST /api/cron/warm`: loads the default view (default date preset, all
 * companies) of the Overview and of every dashboard, so the first visitor finds it in the cache.
 *
 * Each section calls the same loaders with the same arguments as the page's section component
 * (app/<page>/sections.tsx), so the cache keys match; tests/unit/warm.test.ts renders every page's
 * sections after a warm-up and fails if any of them still has to read the source.
 *
 * Results fetched before the run started are re-read and waited for, so a run every 10 minutes
 * keeps everything younger than the 15-minute TTL; visitors keep getting the cached result
 * meanwhile. Pages are warmed one after another, a page's sections at once as the page runs them,
 * so the run never needs more Orion connections than one page view.
 */

interface Section {
  name: string;
  load: () => Promise<unknown>;
}

interface Page {
  path: string;
  sections: Section[];
}

/** The default view of every page, as of `today`. */
export function warmPlan(today: string): Page[] {
  const filters: Filters = parseFilters({}, today);
  const lastYear = previousYear(filters);
  const all: string[] = [];

  return [
    {
      path: "(shell)",
      sections: [{ name: "Company list", load: () => companies() }],
    },
    {
      path: "/",
      sections: [
        { name: "Sales tiles", load: () => Promise.all([salesVsLastYear(filters), salesMonthly(filters)]) },
        {
          name: "Finance tiles",
          load: () => Promise.all([financeVsLastYear(filters), financeMonthly(filters)]),
        },
        { name: "Inventory tiles", load: () => stockPosition(all, today) },
        { name: "Purchasing tiles, overdue POs", load: () => pendingKpis(all, today) },
        { name: "Receivables tiles, AR over 90 days", load: () => arSummary(today, all) },
        { name: "Payables tiles", load: () => apSplit(today, all) },
        { name: "Dead stock", load: () => deadStock(all, DEFAULT_DEAD_STOCK_MONTHS, today) },
        { name: "Reorder alerts", load: () => reorderAlerts(all) },
      ],
    },
    {
      path: "/sales",
      sections: [
        {
          name: "KPIs",
          load: () => Promise.all([salesKpis(filters), salesKpis(lastYear), salesMonthly(filters)]),
        },
        { name: "Revenue by company", load: () => salesBreakdown(filters, "company", undefined) },
        { name: "Revenue by item group", load: () => salesBreakdown(filters, "itemGroup", 12) },
        { name: "Revenue by salesperson", load: () => salesBreakdown(filters, "salesperson", 12) },
        { name: "Top customers", load: () => salesBreakdown(filters, "customer", SALES_TOP_N) },
        { name: "Top items", load: () => salesBreakdown(filters, "item", SALES_TOP_N) },
      ],
    },
    {
      path: "/finance",
      sections: [
        {
          name: "KPIs and trend",
          load: () => Promise.all([financeKpis(filters), financeKpis(lastYear), financeMonthly(filters)]),
        },
        { name: "P&L statement", load: () => pnlStatement(filters) },
        { name: "Costs by GL account", load: () => expenseBreakdown(filters, "account", 12) },
        { name: "Costs by division", load: () => expenseBreakdown(filters, "division", 12) },
        { name: "Costs by department", load: () => expenseBreakdown(filters, "department", 12) },
      ],
    },
    {
      path: "/inventory",
      sections: [
        {
          name: "KPIs and month-end trend",
          load: () => Promise.all([inventoryKpis(all), monthEndTrend(all, today)]),
        },
        { name: "Stock by company", load: () => stockBreakdown(all, "company", undefined) },
        { name: "Stock by item group", load: () => stockBreakdown(all, "itemGroup", 12) },
        { name: "Stock by location", load: () => stockBreakdown(all, "location", 12) },
        { name: "Stock by grade", load: () => stockBreakdown(all, "grade", 12) },
        { name: "Dead and slow stock", load: () => deadStock(all, parseDeadStockMonths(undefined), today) },
        { name: "Reorder alerts", load: () => reorderAlerts(all) },
      ],
    },
    {
      path: "/purchasing",
      sections: [
        {
          name: "KPIs and receipts trend",
          load: () =>
            Promise.all([
              pendingKpis(all, today),
              receiptsKpis(filters),
              receiptsKpis(lastYear),
              receiptsMonthly(filters),
            ]),
        },
        { name: "Zero-rate receipts", load: () => zeroRateReceipts(filters) },
        { name: "Pending by age", load: () => pendingByBucket(all, today) },
        { name: "Pending by company", load: () => pendingByCompany(all, today) },
        { name: "Pending by supplier", load: () => pendingBySupplier(all, today) },
        { name: "Overdue PO lines", load: () => overdueLines(all, today) },
        { name: "Top suppliers by spend", load: () => receiptsBySupplier(filters) },
      ],
    },
    {
      path: "/receivables-payables",
      sections: [
        {
          name: "AR by customer (KPIs, aging, top customers)",
          load: () => arBalances(today, all, "customer"),
        },
        { name: "AR by salesperson", load: () => arBalances(today, all, "salesperson") },
        { name: "AR collection", load: () => arBalances(today, all, "collector") },
        { name: "AP (KPIs, aging, vendors, prepayments)", load: () => apSplit(today, all) },
      ],
    },
    {
      path: "/sales-orders",
      sections: [
        {
          name: "KPIs and booked trend",
          load: () =>
            Promise.all([
              openBookKpis(all, today),
              bookedKpis(filters),
              bookedKpis(lastYear),
              bookedMonthly(filters),
            ]),
        },
        { name: "Non-AED currency note", load: () => openByCurrency(all, today) },
        { name: "Open value by order age", load: () => openByAge(all, today) },
        { name: "Open value by salesperson", load: () => openBySalesperson(all, today) },
        { name: "Open value by customer", load: () => openByCustomer(all, today) },
        { name: "Open order lines", load: () => openLines(all, today) },
      ],
    },
  ];
}

export interface SectionTiming {
  page: string;
  section: string;
  ms: number;
  ok: boolean;
  /** The friendly message (as on screen) when it failed; the details are in the server log. */
  message?: string;
}

export interface WarmResult {
  ok: boolean;
  today: string;
  startedAt: string;
  ms: number;
  sections: SectionTiming[];
}

let running: Promise<WarmResult> | undefined;

/** Warm every page's default view. A call while a run is going on joins it. */
export function warmCache(today: string = todayIso()): Promise<WarmResult> {
  running ??= runWarm(today).finally(() => {
    running = undefined;
  });
  return running;
}

async function runWarm(today: string): Promise<WarmResult> {
  const started = Date.now();
  const sections: SectionTiming[] = [];
  await refreshedSince(started, async () => {
    for (const page of warmPlan(today)) {
      sections.push(
        ...(await Promise.all(
          page.sections.map(async ({ name, load }): Promise<SectionTiming> => {
            const t0 = performance.now();
            try {
              await load();
              return { page: page.path, section: name, ms: Math.round(performance.now() - t0), ok: true };
            } catch (error) {
              const ms = Math.round(performance.now() - t0);
              return { page: page.path, section: name, ms, ok: false, message: friendlyMessage(error) };
            }
          }),
        )),
      );
    }
  });
  return {
    ok: sections.every((section) => section.ok),
    today,
    startedAt: new Date(started).toISOString(),
    ms: Date.now() - started,
    sections,
  };
}
