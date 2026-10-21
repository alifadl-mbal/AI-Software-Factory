import "server-only";

import { AlertTriangle } from "lucide-react";

import { ChartCard, HOVER_CARD_FRAME } from "@/components/dashboard/chart-card";
import { EmptyState } from "@/components/dashboard/empty-state";
import { ErrorCard } from "@/components/dashboard/error-card";
import { KpiCard } from "@/components/dashboard/kpi-card";
import { KPI_GRID } from "@/components/dashboard/skeletons";
import { ReportAsOf } from "@/components/shell/shell-context";
import { previousYear, type Filters } from "@/lib/filters";
import { formatAed, formatInt } from "@/lib/format";
import { cn } from "@/lib/utils";
import { UNMAPPED } from "@/lib/server/chart-of-accounts";
import { dataAsOf } from "@/lib/server/db";
import { load } from "@/lib/server/errors";
import {
  financeKpis,
  financeMonthly,
  financeMonthlyVsLastYear,
  isZero,
  pnlStatement,
  statementRows,
} from "@/lib/server/queries/finance";

import { PnlTrendChart } from "./pnl-drill";
import { PnlStatement } from "./pnl-statement";

/** Seven cards: wrap to four per row on wide screens. */
export const FINANCE_KPI_GRID = cn(KPI_GRID, "xl:grid-cols-4");

/**
 * The headline cards, each with last year's figure and a monthly sparkline. Figures keep the
 * signed convention underneath; costs are flipped to positive here, for display only.
 */
export async function FinanceKpis({ filters }: { filters: Filters }) {
  const result = await load(() =>
    Promise.all([financeKpis(filters), financeKpis(previousYear(filters)), financeMonthly(filters)]),
  );
  if (!result.ok) return <ErrorCard message={result.message} />;
  const [current, previous, months] = result.data;

  return (
    <div className={FINANCE_KPI_GRID} data-testid="finance-kpis">
      <ReportAsOf iso={dataAsOf().toISOString()} />
      <KpiCard
        label="Revenue"
        value={current.revenue}
        previous={previous.revenue}
        spark={months.map((month) => month.revenue)}
      />
      <KpiCard
        label="Cost of sales"
        value={-current.costOfSales}
        previous={-previous.costOfSales}
        spark={months.map((month) => -month.costOfSales)}
        lowerIsBetter
      />
      <KpiCard
        label="Gross profit"
        value={current.grossProfit}
        previous={previous.grossProfit}
        spark={months.map((month) => month.grossProfit)}
      />
      <KpiCard
        label="Gross profit %"
        value={current.grossMarginPct}
        previous={previous.grossMarginPct}
        format="pct"
        delta="pp"
        spark={months.map((month) => month.grossMarginPct ?? 0)}
      />
      <KpiCard
        label="G&A expenses"
        value={-current.generalAndAdmin}
        previous={-previous.generalAndAdmin}
        spark={months.map((month) => -month.generalAndAdmin)}
        lowerIsBetter
      />
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

/** A visible total for postings on accounts missing from the chart of accounts. Nothing when zero. */
export async function FinanceUnmapped({ filters }: { filters: Filters }) {
  const result = await load(() => financeKpis(filters));
  if (!result.ok || isZero(result.data.unmapped)) return null;
  const { unmapped, unmappedAccounts } = result.data;
  return (
    <div
      role="status"
      className="flex items-start gap-3 rounded-xl border border-chart-4/40 bg-chart-4/10 p-4 text-sm"
      data-testid="unmapped-total"
    >
      <AlertTriangle className="mt-0.5 size-4 shrink-0 text-chart-4" aria-hidden />
      <p>
        <span className="font-semibold">
          Unmapped accounts: <span className="tabular">{formatAed(unmapped)}</span>
        </span>{" "}
        <span className="text-muted-foreground">
          (net, credit − debit) on {formatInt(unmappedAccounts)}{" "}
          {unmappedAccounts === 1 ? "account" : "accounts"} missing from the chart of accounts. They are
          listed as “{UNMAPPED}” in the P&amp;L statement and kept out of profit until finance adds them to{" "}
          <code className="text-xs">data/chart-of-accounts.csv</code>.
        </span>
      </p>
    </div>
  );
}

export async function FinanceTrend({ filters }: { filters: Filters }) {
  const result = await load(() => financeMonthlyVsLastYear(filters));
  const total = result.ok ? result.data.reduce((sum, month) => sum + month.netProfit, 0) : 0;
  return (
    <ChartCard
      title="Monthly P&L"
      className={HOVER_CARD_FRAME}
      description="Revenue, gross profit and net profit by month; hover or tap a bar for its breakdown, select it to open its P&L"
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
        <PnlTrendChart
          data={result.data.map((month) => ({
            month: month.month,
            revenue: month.revenue,
            grossProfit: month.grossProfit,
            netProfit: month.netProfit,
            lastYearRevenue: month.lastYearRevenue,
          }))}
          start={filters.start}
          end={filters.end}
        />
      )}
    </ChartCard>
  );
}

export async function FinanceStatement({ filters }: { filters: Filters }) {
  const result = await load(() => pnlStatement(filters));
  return (
    <ChartCard
      title="P&L statement"
      description="This period against the same period last year. Costs are shown as positive amounts; expand a line for its GL accounts and click an account for its journal lines."
    >
      {!result.ok ? (
        <ErrorCard message={result.message} />
      ) : result.data.every((group) => group.accounts.length === 0) ? (
        <EmptyState />
      ) : (
        <PnlStatement rows={statementRows(result.data)} />
      )}
    </ChartCard>
  );
}
