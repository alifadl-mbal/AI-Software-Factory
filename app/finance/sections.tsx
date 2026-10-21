import "server-only";

import { AlertTriangle } from "lucide-react";

import { ChartCard } from "@/components/dashboard/chart-card";
import { EmptyState } from "@/components/dashboard/empty-state";
import { ErrorCard } from "@/components/dashboard/error-card";
import { KpiCard } from "@/components/dashboard/kpi-card";
import { PnlChart } from "@/components/dashboard/pnl-chart";
import { KPI_GRID } from "@/components/dashboard/skeletons";
import { ReportAsOf } from "@/components/shell/shell-context";
import { previousYear, type Filters } from "@/lib/filters";
import { formatAed, formatInt } from "@/lib/format";
import { cn } from "@/lib/utils";
import {
  COST_OF_SALES,
  EXPENSE_LEVELS,
  GENERAL_AND_ADMIN,
  REVENUE,
  UNMAPPED,
} from "@/lib/server/chart-of-accounts";
import { dataAsOf } from "@/lib/server/db";
import { load } from "@/lib/server/errors";
import {
  financeKpis,
  financeMonthly,
  financeMonthlyVsLastYear,
  isZero,
  pnlStatement,
  type StatementGroup,
} from "@/lib/server/queries/finance";

import { PnlStatement, type StatementRow } from "./pnl-statement";

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
      description="Revenue, gross profit and net profit by month"
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
            lastYearRevenue: month.lastYearRevenue,
          }))}
          period={{ start: filters.start, end: filters.end }}
        />
      )}
    </ChartCard>
  );
}

/** Statement rows in display terms: costs flipped to positive, profit lines signed. */
export function statementRows(groups: StatementGroup[]): StatementRow[] {
  const find = (level1: string) =>
    groups.find((group) => group.level1 === level1) ?? { level1, current: 0, previous: 0, accounts: [] };
  const groupRow = (group: StatementGroup, label = group.level1): StatementRow => {
    const sign = EXPENSE_LEVELS.includes(group.level1) ? -1 : 1;
    const unmapped = group.level1 === UNMAPPED;
    return {
      id: group.level1.toLowerCase().replace(/[^a-z]+/g, "-"),
      label,
      kind: unmapped ? "unmapped" : "group",
      current: sign * group.current,
      previous: sign * group.previous,
      signedChange: unmapped ? null : group.current - group.previous,
      accounts: group.accounts.map((account) => ({
        mainAcnt: account.mainAcnt,
        name: account.name,
        current: sign * account.current,
        previous: sign * account.previous,
        signedChange: unmapped ? null : account.current - account.previous,
      })),
      note: unmapped
        ? "Accounts missing from the chart of accounts; kept out of profit. Net amount, credit − debit."
        : undefined,
    };
  };
  const subtotal = (id: string, label: string, parts: StatementGroup[]): StatementRow => {
    const current = parts.reduce((total, group) => total + group.current, 0);
    const previous = parts.reduce((total, group) => total + group.previous, 0);
    return { id, label, kind: "subtotal", current, previous, signedChange: current - previous, accounts: [] };
  };

  const revenue = find(REVENUE);
  const costOfSales = find(COST_OF_SALES);
  const generalAndAdmin = find(GENERAL_AND_ADMIN);
  const rows = [
    groupRow(revenue),
    groupRow(costOfSales),
    subtotal("gross-profit", "Gross profit", [revenue, costOfSales]),
    groupRow(generalAndAdmin),
    subtotal("net-profit", "Net profit", [revenue, costOfSales, generalAndAdmin]),
  ];
  const unmapped = groups.find((group) => group.level1 === UNMAPPED);
  if (unmapped) rows.push(groupRow(unmapped));
  return rows;
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
