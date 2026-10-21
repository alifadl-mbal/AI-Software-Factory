import "server-only";

import { addDays, hasSalesFilter, presetRange, previousYear, todayIso, type Filters } from "@/lib/filters";
import { formatAedCompact, formatDate, formatPct, pctChange } from "@/lib/format";

import { load, type Loaded } from "./errors";
import { apSplit, arSummary, type ApSplit, type BalanceSummary } from "./queries/ar-ap";
import { companies as companyMaster } from "./queries/common";
import { financeByCompany, financeKpis, isZero, summarise, type PnlSummary } from "./queries/finance";
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

// ---------------------------------------------------------------------------------------------
// Companies ranked by net profit, and the one-sentence summary

export interface CompanyRank {
  code: string;
  name: string;
  /** This period and the same days last year, as on Finance with only this company selected. */
  current: PnlSummary;
  previous: PnlSummary;
}

export interface CompanyRanking {
  /** Biggest net profit first. */
  rows: CompanyRank[];
  /** Companies in scope (all, or the selected ones) left out for having no P&L postings. */
  leftOut: number;
}

/**
 * Companies ranked by net profit for the period, each with the same days last year. A company is
 * shown when it has P&L postings in either period; the rest only count towards `leftOut`. The
 * rows add up to the group P&L, since a company left out has nothing on its P&L accounts.
 */
export async function companyRanking(filters: Filters): Promise<CompanyRanking> {
  const [current, previous, master] = await Promise.all([
    financeByCompany(filters),
    financeByCompany(previousYear(filters)),
    companyMaster(),
  ]);
  const names = new Map(master.map((company) => [company.code, company.name]));
  const byCode = (list: typeof current) => new Map(list.map((row) => [row.company, row]));
  const currentByCode = byCode(current);
  const previousByCode = byCode(previous);
  const empty = summarise([]);
  const codes = new Set([...current, ...previous].filter((row) => row.hasPnl).map((row) => row.company));
  const rows = [...codes]
    .map((code) => ({
      code,
      name: names.get(code) ?? code,
      current: currentByCode.get(code) ?? empty,
      previous: previousByCode.get(code) ?? empty,
    }))
    .sort((a, b) => b.current.netProfit - a.current.netProfit || a.code.localeCompare(b.code));
  const inScope = filters.companies.length > 0 ? filters.companies : master.map((company) => company.code);
  return { rows, leftOut: inScope.filter((code) => !codes.has(code)).length };
}

function periodPhrase(filters: Pick<Filters, "range" | "start" | "end">): string {
  switch (filters.range) {
    case "mtd":
      return "Month to date";
    case "qtd":
      return "Quarter to date";
    case "ytd":
      return "Year to date";
    case "12m":
      return "Over the last 12 months";
    case "custom":
      return filters.start === filters.end
        ? `On ${formatDate(filters.start)}`
        : `From ${formatDate(filters.start)} to ${formatDate(filters.end)}`;
  }
}

export interface SummaryInput {
  filters: Filters;
  /** Net revenue as on Sales (the Net revenue tile). */
  sales: VsLastYear<Pick<SalesKpis, "netRevenue">>;
  /** The GL P&L as on Finance (the Net profit and Net margin % tiles). */
  finance: VsLastYear<Pick<PnlSummary, "netProfit" | "netMarginPct">>;
  ranking: Pick<CompanyRanking, "rows">;
}

/** "an" before a figure read with a vowel sound (8%, 11.2%, 18.7%, 80%), "a" before the rest. */
export function article(figure: string): "a" | "an" {
  const whole = figure.replace(/^[-+]/, "").split(/[.%]/)[0].replace(/,/g, "");
  return whole.startsWith("8") || whole === "11" || whole === "18" ? "an" : "a";
}

/**
 * The Overview's one-sentence summary, worded from the same figures and formats as its tiles and
 * ranking. A part with no figure behind it (no last year, no margin, one company) is left out
 * rather than shown as 0%, NaN or a dash.
 */
export function summarySentence({ filters, sales, finance, ranking }: SummaryInput): string {
  const revenue = sales.current.netRevenue;
  const change = pctChange(revenue, sales.previous.netRevenue);
  let first = isZero(revenue)
    ? `${periodPhrase(filters)}, there was no net revenue`
    : `${periodPhrase(filters)}, net revenue was ${formatAedCompact(revenue)}`;
  if (!isZero(revenue) && change !== null && Number.isFinite(change)) {
    first +=
      Math.abs(change) < 0.0005
        ? ", level with the same days last year"
        : `, ${change > 0 ? "up" : "down"} ${formatPct(Math.abs(change))} on the same days last year`;
  }
  // The P&L and the ranking come from the ledger, which has no salesperson or brand: under either
  // filter they go in a sentence of their own that says so, not after the filtered revenue.
  const filtered = hasSalesFilter(filters);
  const { netProfit, netMarginPct } = finance.current;
  let pnl = "";
  let joiner = "";
  if (netProfit < 0 && !isZero(netProfit)) {
    pnl = `a net loss of ${formatAedCompact(-netProfit)}`;
    joiner = "with";
  } else if (netMarginPct !== null && Number.isFinite(netMarginPct) && !isZero(netProfit)) {
    const margin = formatPct(netMarginPct);
    pnl = `${article(margin)} ${margin} net margin`;
    joiner = "at";
  }
  if (pnl && !filtered) first += `, ${joiner} ${pnl}`;
  const sentences = [`${first}.`];

  const leader = ranking.rows[0];
  const led =
    filters.companies.length !== 1 && ranking.rows.length > 1 && leader && leader.current.netProfit > 0
      ? `${leader.name} led with ${formatAedCompact(leader.current.netProfit)} net profit`
      : "";
  if (!filtered) {
    if (led) sentences.push(`${led}.`);
  } else if (pnl || led) {
    const business = pnl ? `the business made ${pnl}` : "";
    const parts = [business, led].filter(Boolean).join("; ");
    sentences.push(`Across all salespeople and brands, ${parts}.`);
  }
  return sentences.join(" ");
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
  return { range, ...presetRange(range, today), companies: [], salespeople: [], brands: [] };
}

/** Every Overview figure for all companies, as of `today` (Asia/Dubai). */
export async function overviewFigures(today: string = todayIso()): Promise<OverviewFigures> {
  const companies: string[] = [];
  const yesterday = addDays(today, -1);
  const mtdFilters = periodFilters("mtd", today);
  const ytdFilters = periodFilters("ytd", today);
  const yesterdayFilters: Filters = {
    range: "custom",
    start: yesterday,
    end: yesterday,
    companies,
    salespeople: [],
    brands: [],
  };

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
