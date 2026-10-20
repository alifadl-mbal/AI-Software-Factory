import "server-only";

import { addDays, presetRange, previousYear, todayIso, type Filters } from "@/lib/filters";

import { load, type Loaded } from "./errors";
import { apSplit, arSummary, type ApSplit, type BalanceSummary } from "./queries/ar-ap";
import { financeKpis, type PnlSummary } from "./queries/finance";
import {
  deadStock,
  DEFAULT_DEAD_STOCK_MONTHS,
  inventoryKpis,
  monthEndTrend,
  reorderAlerts,
  type DeadStock,
  type MonthEnd,
} from "./queries/inventory";
import { DEFAULT_ORDER_AGE } from "@/lib/order-age";

import { pendingKpis, type PendingKpis } from "./queries/purchasing";
import { salesKpis, type SalesKpis } from "./queries/sales";
import { openBookKpis, openByCurrency, type CurrencyBook, type OpenBookKpis } from "./queries/sales-orders";

/**
 * The Overview's headline figures, loaded once for the Overview page and the daily snapshot email.
 *
 * Every figure comes from the dashboards' own loaders with the same arguments, so the email, the
 * Overview and each dashboard agree for the same day (and share the 15-minute cache entries).
 * Period figures follow `Filters`; stock, pending POs, AR/AP and the order book are as of today
 * and follow only the companies. Pending POs and the order book use the default order age (orders
 * placed in the last 2 years, `lib/order-age.ts`), as the dashboards do unless told otherwise.
 */

export interface VsLastYear<T> {
  current: T;
  previous: T;
}

/** A period's figures and the same period a year earlier. */
async function vsLastYear<T>(
  filters: Filters,
  loader: (filters: Filters) => Promise<T>,
): Promise<VsLastYear<T>> {
  const [current, previous] = await Promise.all([loader(filters), loader(previousYear(filters))]);
  return { current, previous };
}

export function salesVsLastYear(filters: Filters): Promise<VsLastYear<SalesKpis>> {
  return vsLastYear(filters, salesKpis);
}

export function financeVsLastYear(filters: Filters): Promise<VsLastYear<PnlSummary>> {
  return vsLastYear(filters, financeKpis);
}

/** The newest month-end before the current month (the current one is provisional). */
export function lastClosed(months: MonthEnd[], today: string = todayIso()): MonthEnd | undefined {
  const current = today.slice(0, 7);
  return months.filter((month) => month.month < current).at(-1);
}

export interface StockPosition {
  stockValue: number;
  /** The last closed month-end; `undefined` before the first one. */
  closed: MonthEnd | undefined;
  /** Stock value minus the last closed month-end; `null` without one. */
  change: number | null;
  months: MonthEnd[];
}

export async function stockPosition(companies: string[], today: string = todayIso()): Promise<StockPosition> {
  const [kpis, months] = await Promise.all([inventoryKpis(companies), monthEndTrend(companies, today)]);
  const closed = lastClosed(months, today);
  return {
    stockValue: kpis.stockValue,
    closed,
    change: closed ? kpis.stockValue - closed.closeValue : null,
    months,
  };
}

export interface OrderBook {
  book: OpenBookKpis;
  /** Open orders in other currencies, left out of the AED figures. */
  otherCurrencies: CurrencyBook[];
}

export async function orderBook(companies: string[], today: string): Promise<OrderBook> {
  const [book, otherCurrencies] = await Promise.all([
    openBookKpis(companies, today, DEFAULT_ORDER_AGE),
    openByCurrency(companies, today, DEFAULT_ORDER_AGE),
  ]);
  return { book, otherCurrencies };
}

// ---------------------------------------------------------------------------------------------
// Everything at once, for the daily snapshot

export interface SalesSnapshot {
  /** Yesterday on its own (no comparison). */
  yesterday: SalesKpis;
  mtd: VsLastYear<SalesKpis>;
  ytd: VsLastYear<SalesKpis>;
}

export interface Attention {
  overduePo: Loaded<Pick<PendingKpis, "overdueValue" | "overdueLines">>;
  arOver90: Loaded<number>;
  deadStock: Loaded<Pick<DeadStock, "value" | "count" | "months">>;
  reorderCount: Loaded<number>;
}

/** Each area loads on its own: one failing leaves the others in place. */
export interface OverviewFigures {
  /** YYYY-MM-DD in Asia/Dubai. */
  today: string;
  yesterday: string;
  /** The MTD and YTD filters used (all companies), so links and tests can rebuild them. */
  mtdFilters: Filters;
  ytdFilters: Filters;
  sales: Loaded<SalesSnapshot>;
  /** Year to date. */
  finance: Loaded<VsLastYear<PnlSummary>>;
  inventory: Loaded<StockPosition>;
  purchasing: Loaded<PendingKpis>;
  receivables: Loaded<BalanceSummary>;
  payables: Loaded<Pick<ApSplit, "summary"> & { vendorsOwed: number }>;
  salesOrders: Loaded<OrderBook>;
  attention: Attention;
}

function periodFilters(range: "mtd" | "ytd", today: string): Filters {
  return { range, ...presetRange(range, today), companies: [] };
}

/** Every Overview figure for all companies, as of `today` (Asia/Dubai). */
export async function overviewFigures(today: string = todayIso()): Promise<OverviewFigures> {
  const companies: string[] = [];
  const yesterday = addDays(today, -1);
  const mtdFilters = periodFilters("mtd", today);
  const ytdFilters = periodFilters("ytd", today);
  const yesterdayFilters: Filters = { range: "custom", start: yesterday, end: yesterday, companies };

  const [sales, finance, inventory, purchasing, receivables, payables, salesOrders, dead, reorder] =
    await Promise.all([
      load(async () => {
        const [day, mtd, ytd] = await Promise.all([
          salesKpis(yesterdayFilters),
          salesVsLastYear(mtdFilters),
          salesVsLastYear(ytdFilters),
        ]);
        return { yesterday: day, mtd, ytd };
      }),
      load(() => financeVsLastYear(ytdFilters)),
      load(() => stockPosition(companies, today)),
      load(() => pendingKpis(companies, today, DEFAULT_ORDER_AGE)),
      load(() => arSummary(today, companies)),
      load(async () => {
        const split = await apSplit(today, companies);
        return { summary: split.summary, vendorsOwed: split.owed.length };
      }),
      load(() => orderBook(companies, today)),
      load(() => deadStock(companies, DEFAULT_DEAD_STOCK_MONTHS, today)),
      load(() => reorderAlerts(companies)),
    ]);

  return {
    today,
    yesterday,
    mtdFilters,
    ytdFilters,
    sales,
    finance,
    inventory,
    purchasing,
    receivables,
    payables,
    salesOrders,
    attention: {
      overduePo: map(purchasing, ({ overdueValue, overdueLines }) => ({ overdueValue, overdueLines })),
      arOver90: map(receivables, (ar) => ar.over90),
      deadStock: map(dead, ({ value, count, months }) => ({ value, count, months })),
      reorderCount: map(reorder, (alerts) => alerts.length),
    },
  };
}

function map<T, U>(loaded: Loaded<T>, pick: (data: T) => U): Loaded<U> {
  return loaded.ok ? { ok: true, data: pick(loaded.data) } : loaded;
}
