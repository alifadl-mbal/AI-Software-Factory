import "server-only";

import Link from "next/link";
import { AlertTriangle, ArrowRight, type LucideIcon } from "lucide-react";

import { ChartCard } from "@/components/dashboard/chart-card";
import { EmptyState } from "@/components/dashboard/empty-state";
import { ErrorCard } from "@/components/dashboard/error-card";
import { KpiCard } from "@/components/dashboard/kpi-card";
import { PnlChart } from "@/components/dashboard/pnl-chart";
import { Skeleton } from "@/components/ui/skeleton";
import { ReportAsOf } from "@/components/shell/shell-context";
import { previousYear, todayIso, type Filters } from "@/lib/filters";
import { formatAed, formatAedCompact, formatDeltaPct, formatInt, formatMonth, pctChange } from "@/lib/format";
import { cn } from "@/lib/utils";
import { dataAsOf } from "@/lib/server/db";
import { load } from "@/lib/server/errors";
import { apSplit, arSummary } from "@/lib/server/queries/ar-ap";
import { financeKpis, financeMonthly } from "@/lib/server/queries/finance";
import {
  deadStock,
  DEFAULT_DEAD_STOCK_MONTHS,
  inventoryKpis,
  monthEndTrend,
  reorderAlerts,
} from "@/lib/server/queries/inventory";
import { pendingKpis } from "@/lib/server/queries/purchasing";
import { salesKpis, salesMonthly } from "@/lib/server/queries/sales";

import { lastClosed } from "../inventory/sections";
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
  const result = await load(() =>
    Promise.all([salesKpis(filters), salesKpis(previousYear(filters)), salesMonthly(filters)]),
  );
  if (!result.ok) return <ErrorCard message={result.message} />;
  const [current, previous, months] = result.data;
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
  const result = await load(() =>
    Promise.all([financeKpis(filters), financeKpis(previousYear(filters)), financeMonthly(filters)]),
  );
  if (!result.ok) return <ErrorCard message={result.message} />;
  const [current, previous, months] = result.data;
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
  const result = await load(() => Promise.all([inventoryKpis(companies), monthEndTrend(companies, today)]));
  if (!result.ok) return <ErrorCard message={result.message} />;
  const [kpis, months] = result.data;
  const closed = lastClosed(months);
  return (
    <div className={TILE_GRID} data-testid="overview-inventory">
      <DataAsOf />
      <KpiCard
        label="Stock value"
        value={kpis.stockValue}
        spark={months.map((month) => month.closeValue)}
        hint="As of today"
      />
      <KpiCard
        label="Change vs last month-end"
        value={closed ? kpis.stockValue - closed.closeValue : null}
        hint={
          closed
            ? `vs ${formatMonth(closed.month)} close (${formatDeltaPct(pctChange(kpis.stockValue, closed.closeValue))})`
            : "No closed month-end yet"
        }
      />
    </div>
  );
}

/** Pending PO value and the overdue share, as of today. */
export async function PurchasingTiles({ companies, today }: AsOfScope) {
  const result = await load(() => pendingKpis(companies, today));
  if (!result.ok) return <ErrorCard message={result.message} />;
  const pending = result.data;
  return (
    <div className={TILE_GRID} data-testid="overview-purchasing">
      <DataAsOf />
      <KpiCard label="Pending PO value" value={pending.pendingValue} hint="Open PO lines, as of today" />
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
  const result = await load(() => pendingKpis(companies, today));
  if (!result.ok) return <ErrorCard message={result.message} />;
  const { overdueValue, overdueLines } = result.data;
  return (
    <AttentionLink
      href={href}
      label="Overdue PO value"
      value={formatAedCompact(overdueValue)}
      title={formatAed(overdueValue)}
      caption={`${formatInt(overdueLines)} ${overdueLines === 1 ? "line" : "lines"} past PO date + 84 days`}
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
