import "server-only";

import Link from "next/link";
import { AlertTriangle, ArrowRight, type LucideIcon } from "lucide-react";

import { ChartCard } from "@/components/dashboard/chart-card";
import { EmptyState } from "@/components/dashboard/empty-state";
import { ErrorCard } from "@/components/dashboard/error-card";
import { KpiCard } from "@/components/dashboard/kpi-card";
import { PnlChart } from "@/components/dashboard/pnl-chart";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { ReportAsOf } from "@/components/shell/shell-context";
import { filtersToSearch, todayIso, type Filters } from "@/lib/filters";
import {
  formatAed,
  formatAedCompact,
  formatDeltaPct,
  formatInt,
  formatMonth,
  formatPct,
  pctChange,
} from "@/lib/format";
import { DEFAULT_ORDER_AGE, orderAgeScope } from "@/lib/order-age";
import { cn } from "@/lib/utils";
import { dataAsOf } from "@/lib/server/db";
import { load } from "@/lib/server/errors";
import { apSplit, arSummary } from "@/lib/server/queries/ar-ap";
import {
  companyRanking,
  financeVsLastYear,
  salesVsLastYear,
  stockPosition,
  summarySentence,
  type CompanyRank,
} from "@/lib/server/overview";
import { financeMonthly } from "@/lib/server/queries/finance";
import { deadStock, DEFAULT_DEAD_STOCK_MONTHS, reorderAlerts } from "@/lib/server/queries/inventory";
import { pendingKpis } from "@/lib/server/queries/purchasing";
import { salesMonthly } from "@/lib/server/queries/sales";

import { ApCurrencyNote } from "../receivables-payables/sections";

/**
 * The Overview's sections. Each loads through the same loaders as its dashboard, so a figure here
 * always equals the same figure there for the same filters (and shares its 15-minute cache entry).
 */

/** The tiles of one area: one column on phones, two side by side from `sm`. */
export const TILE_GRID = "grid gap-3 sm:grid-cols-2";

interface AsOfScope {
  companies: string[];
  today: string;
}

function DataAsOf() {
  return <ReportAsOf iso={dataAsOf().toISOString()} />;
}

/** Net revenue and gross margin %, vs the same period last year. */
export async function SalesTiles({ filters }: { filters: Filters }) {
  const result = await load(() => Promise.all([salesVsLastYear(filters), salesMonthly(filters)]));
  if (!result.ok) return <ErrorCard message={result.message} />;
  const [{ current, previous }, months] = result.data;
  return (
    <div className={TILE_GRID} data-testid="overview-sales">
      <DataAsOf />
      <KpiCard
        label="Net revenue"
        value={current.netRevenue}
        previous={previous.netRevenue}
        spark={months.map((month) => month.netRevenue)}
      />
      <KpiCard
        label="Gross margin %"
        value={current.marginPct}
        previous={previous.marginPct}
        format="pct"
        delta="pp"
        spark={months.map((month) => month.marginPct ?? 0)}
      />
    </div>
  );
}

/** Net profit and net margin %, vs the same period last year. */
export async function FinanceTiles({ filters }: { filters: Filters }) {
  const result = await load(() => Promise.all([financeVsLastYear(filters), financeMonthly(filters)]));
  if (!result.ok) return <ErrorCard message={result.message} />;
  const [{ current, previous }, months] = result.data;
  return (
    <div className={TILE_GRID} data-testid="overview-finance">
      <DataAsOf />
      <KpiCard
        label="Net profit"
        value={current.netProfit}
        previous={previous.netProfit}
        spark={months.map((month) => month.netProfit)}
      />
      <KpiCard
        label="Net margin %"
        value={current.netMarginPct}
        previous={previous.netMarginPct}
        format="pct"
        delta="pp"
        spark={months.map((month) => month.netMarginPct ?? 0)}
      />
    </div>
  );
}

/** Stock value as of today, and the change since the last closed month-end. */
export async function InventoryTiles({ companies, today }: AsOfScope) {
  const result = await load(() => stockPosition(companies, today));
  if (!result.ok) return <ErrorCard message={result.message} />;
  const { stockValue, closed, change, months } = result.data;
  return (
    <div className={TILE_GRID} data-testid="overview-inventory">
      <DataAsOf />
      <KpiCard
        label="Stock value"
        value={stockValue}
        spark={months.map((month) => month.closeValue)}
        hint="As of today"
      />
      <KpiCard
        label="Change vs last month-end"
        value={change}
        hint={
          closed
            ? `vs ${formatMonth(closed.month)} close (${formatDeltaPct(pctChange(stockValue, closed.closeValue))})`
            : "No closed month-end yet"
        }
      />
    </div>
  );
}

/** The order age the overview's pending-PO figures use: the dashboards' default. */
export const OVERVIEW_ORDER_SCOPE = orderAgeScope(DEFAULT_ORDER_AGE);

/** Pending PO value and the overdue share, as of today, on orders from the last 2 years. */
export async function PurchasingTiles({ companies, today }: AsOfScope) {
  const result = await load(() => pendingKpis(companies, today, DEFAULT_ORDER_AGE));
  if (!result.ok) return <ErrorCard message={result.message} />;
  const pending = result.data;
  return (
    <div className={TILE_GRID} data-testid="overview-purchasing">
      <DataAsOf />
      <KpiCard
        label="Pending PO value"
        value={pending.pendingValue}
        hint={`Open PO lines on ${OVERVIEW_ORDER_SCOPE}`}
      />
      <KpiCard
        label="Overdue %"
        value={pending.overduePct}
        format="pct"
        hint={`${formatAedCompact(pending.overdueValue)} past PO date + 84 days`}
      />
    </div>
  );
}

/** AR outstanding and the share of it over 90 days, as of today. */
export async function ReceivablesTiles({ companies, today }: AsOfScope) {
  const result = await load(() => arSummary(today, companies));
  if (!result.ok) return <ErrorCard message={result.message} />;
  const ar = result.data;
  return (
    <div className={TILE_GRID} data-testid="overview-receivables">
      <DataAsOf />
      <KpiCard label="AR outstanding" value={ar.balance} hint="As of today; net of PDCs" />
      <KpiCard
        label="Share over 90 days"
        value={ar.over90Pct}
        format="pct"
        hint={
          ar.over90Pct === null ? "No AR outstanding" : `${formatAedCompact(ar.over90)} of AR outstanding`
        }
      />
    </div>
  );
}

/** AP outstanding as of today, with the same currency note as the AR/AP page. */
export async function PayablesTiles({ companies, today }: AsOfScope) {
  const result = await load(() => apSplit(today, companies));
  if (!result.ok) return <ErrorCard message={result.message} />;
  const ap = result.data;
  return (
    <div className={TILE_GRID} data-testid="overview-payables">
      <DataAsOf />
      <KpiCard
        label="AP outstanding"
        value={ap.summary.balance}
        hint={`As of today; owed to ${formatInt(ap.owed.length)} vendors, net of PDCs issued`}
      />
      <div className="flex items-center rounded-xl border border-dashed p-4">
        <ApCurrencyNote />
      </div>
    </div>
  );
}

/** Monthly revenue and net profit; the Finance dashboard adds gross profit. */
export async function OverviewPnl({ filters }: { filters: Filters }) {
  const result = await load(() => financeMonthly(filters));
  const total = result.ok ? result.data.reduce((sum, month) => sum + month.netProfit, 0) : 0;
  return (
    <ChartCard
      title="Monthly P&L"
      description="Revenue and net profit by month"
      action={
        result.ok ? (
          <span className="tabular text-sm font-medium" title="Net profit for the period">
            {formatAed(total)}
          </span>
        ) : undefined
      }
    >
      {!result.ok ? (
        <ErrorCard message={result.message} />
      ) : result.data.every((month) => month.revenue === 0 && month.netProfit === 0) ? (
        <EmptyState />
      ) : (
        <PnlChart
          data={result.data.map((month) => ({
            month: month.month,
            revenue: month.revenue,
            grossProfit: month.grossProfit,
            netProfit: month.netProfit,
          }))}
          showGrossProfit={false}
        />
      )}
    </ChartCard>
  );
}

// ---------------------------------------------------------------------------------------------
// Summary sentence and company ranking

/** One sentence on the period, from the same loaders as the Sales and Finance tiles and the ranking. */
export async function OverviewSummary({ filters }: { filters: Filters }) {
  const result = await load(() =>
    Promise.all([salesVsLastYear(filters), financeVsLastYear(filters), companyRanking(filters)]),
  );
  if (!result.ok) return <ErrorCard message={result.message} />;
  const [sales, finance, ranking] = result.data;
  return (
    <p className="max-w-4xl text-base text-pretty sm:text-lg" data-testid="overview-summary">
      {summarySentence({ filters, sales, finance, ranking })}
    </p>
  );
}

export function SummarySkeleton() {
  return (
    <div className="flex max-w-4xl flex-col gap-2" aria-busy="true" aria-label="Loading">
      <Skeleton className="h-5 w-full" />
      <Skeleton className="h-5 w-2/3" />
    </div>
  );
}

/** Where `value` sits on a bar track running from `min` to `max`, as a percentage. */
function trackPosition(value: number, min: number, max: number): number {
  return max === min ? 0 : ((value - min) / (max - min)) * 100;
}

/** One net-profit bar; every bar in the table shares the same track, so lengths compare. */
function ProfitBar({
  value,
  min,
  max,
  className,
}: {
  value: number;
  min: number;
  max: number;
  className: string;
}) {
  const zero = trackPosition(0, min, max);
  const end = trackPosition(value, min, max);
  return (
    <div className="relative h-2.5 w-full" aria-hidden>
      {min < 0 && (
        <div className="absolute inset-y-0 w-px bg-muted-foreground/60" style={{ left: `${zero}%` }} />
      )}
      <div
        className={cn("absolute inset-y-0 rounded-sm", className)}
        style={{ left: `${Math.min(zero, end)}%`, width: `${Math.abs(end - zero)}%` }}
      />
    </div>
  );
}

export const RANKING_TITLE = "Companies by net profit";
const RANKING_DESCRIPTION = "Posted GL, as on Finance · this period vs the same days last year";

/**
 * Companies ranked by net profit, with this period and the same days last year as bars, revenue,
 * net margin and the change. Each company links to the Overview filtered to it, as picking it in
 * the company filter would.
 */
export async function CompanyRanking({ filters }: { filters: Filters }) {
  const result = await load(() => Promise.all([companyRanking(filters), financeVsLastYear(filters)]));
  if (!result.ok) {
    return (
      <ChartCard title={RANKING_TITLE} description={RANKING_DESCRIPTION}>
        <ErrorCard message={result.message} />
      </ChartCard>
    );
  }
  const [{ rows, leftOut }, total] = result.data;
  const values = rows.flatMap((row) => [row.current.netProfit, row.previous.netProfit]);
  const min = Math.min(0, ...values);
  const max = Math.max(0, ...values);
  const single = filters.companies.length === 1;
  const href = (row: CompanyRank) => `/${filtersToSearch({ ...filters, companies: [row.code] })}`;
  const note = [
    single ? "" : "Pick a company to show only its figures.",
    leftOut > 0
      ? `${formatInt(leftOut)} ${leftOut === 1 ? "company has" : "companies have"} no P&L postings in either period and ${leftOut === 1 ? "is" : "are"} left out.`
      : "",
  ]
    .filter(Boolean)
    .join(" ");
  return (
    <ChartCard
      title={RANKING_TITLE}
      description={RANKING_DESCRIPTION}
      action={
        rows.length > 0 ? (
          <span
            className="tabular text-sm font-medium"
            title="Net profit for the period"
            data-testid="ranking-total"
          >
            {formatAed(total.current.netProfit)}
          </span>
        ) : undefined
      }
    >
      {rows.length === 0 ? (
        <EmptyState />
      ) : (
        <div className="flex flex-col gap-3">
          <div
            className="flex w-fit flex-wrap items-center gap-x-4 gap-y-1 rounded-full bg-panel px-3.5 py-2 text-xs text-muted-foreground"
            aria-hidden
          >
            <span className="inline-flex items-center gap-1.5">
              <span className="size-2.5 rounded-full bg-chart-cy" /> This period
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="size-2.5 rounded-full bg-chart-py" /> Same days last year
            </span>
          </div>
          <Table className="min-w-[36rem]" data-testid="company-ranking">
            <TableHeader>
              <TableRow>
                <TableHead>Company</TableHead>
                <TableHead className="w-[34%]">Net profit</TableHead>
                <TableHead className="text-right">Revenue</TableHead>
                <TableHead className="text-right">Net margin</TableHead>
                <TableHead className="text-right">YoY</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row) => (
                <TableRow key={row.code} data-testid="ranking-row" data-company={row.code}>
                  <TableCell className="max-w-56 whitespace-normal">
                    {single ? (
                      <span className="font-medium">{row.name}</span>
                    ) : (
                      <Link
                        href={href(row)}
                        className="rounded-sm font-medium underline-offset-4 outline-none hover:text-primary hover:underline focus-visible:ring-3 focus-visible:ring-ring/50"
                        title={`Show only ${row.name}`}
                        data-testid="ranking-company-link"
                      >
                        {row.name}
                      </Link>
                    )}
                    <span className="block text-xs text-muted-foreground">{row.code}</span>
                  </TableCell>
                  <TableCell>
                    <div className="flex flex-col gap-1">
                      <span className="tabular font-medium" data-testid="ranking-net-profit">
                        {formatAed(row.current.netProfit)}
                      </span>
                      <ProfitBar value={row.current.netProfit} min={min} max={max} className="bg-chart-cy" />
                      <ProfitBar value={row.previous.netProfit} min={min} max={max} className="bg-chart-py" />
                      <span className="tabular text-xs text-muted-foreground">
                        Last year {formatAed(row.previous.netProfit)}
                      </span>
                    </div>
                  </TableCell>
                  <TableCell className="tabular text-right">{formatAed(row.current.revenue)}</TableCell>
                  <TableCell className="tabular text-right">{formatPct(row.current.netMarginPct)}</TableCell>
                  <TableCell className="tabular text-right">
                    {formatDeltaPct(pctChange(row.current.netProfit, row.previous.netProfit))}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
            <TableFooter>
              <TableRow data-testid="ranking-group-row">
                <TableCell>Group</TableCell>
                <TableCell>
                  <span className="tabular block">{formatAed(total.current.netProfit)}</span>
                  <span className="tabular block text-xs font-normal text-muted-foreground">
                    Last year {formatAed(total.previous.netProfit)}
                  </span>
                </TableCell>
                <TableCell className="tabular text-right">{formatAed(total.current.revenue)}</TableCell>
                <TableCell className="tabular text-right">{formatPct(total.current.netMarginPct)}</TableCell>
                <TableCell className="tabular text-right">
                  {formatDeltaPct(pctChange(total.current.netProfit, total.previous.netProfit))}
                </TableCell>
              </TableRow>
            </TableFooter>
          </Table>
          {note && (
            <p className="text-xs text-muted-foreground" data-testid="ranking-note">
              {note}
            </p>
          )}
        </div>
      )}
    </ChartCard>
  );
}

// ---------------------------------------------------------------------------------------------
// Needs attention

function AttentionLink({
  href,
  label,
  value,
  title,
  caption,
  testId,
  icon: Icon = AlertTriangle,
}: {
  href: string;
  label: string;
  value: string;
  /** The full figure, for the tooltip. */
  title?: string;
  caption: string;
  testId: string;
  icon?: LucideIcon;
}) {
  return (
    <Link
      href={href}
      className="group flex h-full items-center gap-3 rounded-lg border p-3 transition-colors outline-none hover:border-primary/40 hover:bg-muted/50 focus-visible:ring-3 focus-visible:ring-ring/50"
      data-testid={testId}
    >
      <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-chart-4/12 text-chart-4">
        <Icon className="size-4.5" aria-hidden />
      </span>
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="text-sm font-medium">{label}</span>
        <span className="text-xs text-muted-foreground">{caption}</span>
      </span>
      <span className="tabular text-base font-semibold" title={title} data-testid="attention-value">
        {value}
      </span>
      <ArrowRight
        className="size-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5 group-hover:text-foreground"
        aria-hidden
      />
    </Link>
  );
}

/** Placeholder for one Needs-attention row. */
export function AttentionSkeleton() {
  return (
    <div className="flex items-center gap-3 rounded-lg border p-3" aria-busy="true" aria-label="Loading">
      <Skeleton className="size-9 rounded-full" />
      <div className="flex flex-1 flex-col gap-1.5">
        <Skeleton className="h-4 w-28" />
        <Skeleton className="h-3 w-36" />
      </div>
      <Skeleton className="h-5 w-16" />
    </div>
  );
}

export async function OverduePoAttention({ companies, today, href }: AsOfScope & { href: string }) {
  const result = await load(() => pendingKpis(companies, today, DEFAULT_ORDER_AGE));
  if (!result.ok) return <ErrorCard message={result.message} />;
  const { overdueValue, overdueLines } = result.data;
  return (
    <AttentionLink
      href={href}
      label="Overdue PO value"
      value={formatAedCompact(overdueValue)}
      title={formatAed(overdueValue)}
      caption={`${formatInt(overdueLines)} ${overdueLines === 1 ? "line" : "lines"} past PO date + 84 days, ${OVERVIEW_ORDER_SCOPE}`}
      testId="attention-overdue-po"
    />
  );
}

export async function ArOver90Attention({ companies, today, href }: AsOfScope & { href: string }) {
  const result = await load(() => arSummary(today, companies));
  if (!result.ok) return <ErrorCard message={result.message} />;
  const { over90 } = result.data;
  return (
    <AttentionLink
      href={href}
      label="AR over 90 days"
      value={formatAedCompact(over90)}
      title={formatAed(over90)}
      caption="Customer balances 3 months old or more"
      testId="attention-ar-over-90"
    />
  );
}

export async function DeadStockAttention({ companies, href }: { companies: string[]; href: string }) {
  const result = await load(() => deadStock(companies, DEFAULT_DEAD_STOCK_MONTHS, todayIso()));
  if (!result.ok) return <ErrorCard message={result.message} />;
  const { value, count } = result.data;
  return (
    <AttentionLink
      href={href}
      label={`Dead stock (${DEFAULT_DEAD_STOCK_MONTHS} months)`}
      value={formatAedCompact(value)}
      title={formatAed(value)}
      caption={`${formatInt(count)} ${count === 1 ? "item" : "items"} with no movement`}
      testId="attention-dead-stock"
    />
  );
}

export async function ReorderAttention({ companies, href }: { companies: string[]; href: string }) {
  const result = await load(() => reorderAlerts(companies));
  if (!result.ok) return <ErrorCard message={result.message} />;
  const count = result.data.length;
  return (
    <AttentionLink
      href={href}
      label="Reorder alerts"
      value={formatInt(count)}
      caption="Items at or below their reorder level"
      testId="attention-reorder"
    />
  );
}

// ---------------------------------------------------------------------------------------------
// Layout

/** One area's tiles under a heading that links to its dashboard. */
export function AreaGroup({
  id,
  title,
  icon: Icon,
  href,
  caption,
  className,
  children,
}: {
  id: string;
  title: string;
  icon: LucideIcon;
  href: string;
  caption: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <section aria-labelledby={`${id}-heading`} className={cn("flex min-w-0 flex-col gap-3", className)}>
      <div className="flex flex-wrap items-end justify-between gap-x-3 gap-y-1">
        <h3 id={`${id}-heading`} className="text-base font-semibold">
          <Link
            href={href}
            className="group inline-flex items-center gap-2 rounded-md outline-none hover:text-primary focus-visible:ring-3 focus-visible:ring-ring/50"
            data-testid={`area-link-${id}`}
          >
            <span className="flex size-7 items-center justify-center rounded-md bg-primary/10 text-primary">
              <Icon className="size-4" aria-hidden />
            </span>
            {title}
            <span className="sr-only"> dashboard</span>
            <ArrowRight
              className="size-4 text-muted-foreground transition-transform group-hover:translate-x-0.5 group-hover:text-foreground"
              aria-hidden
            />
          </Link>
        </h3>
        <p className="text-xs text-muted-foreground" data-testid={`area-caption-${id}`}>
          {caption}
        </p>
      </div>
      {children}
    </section>
  );
}
