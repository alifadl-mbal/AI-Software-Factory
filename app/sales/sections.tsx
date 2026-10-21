import "server-only";

import { BarBreakdown } from "@/components/dashboard/bar-breakdown";
import { ChartCard } from "@/components/dashboard/chart-card";
import { DataTable, type ColumnSpec } from "@/components/dashboard/data-table";
import { EmptyState } from "@/components/dashboard/empty-state";
import { ErrorCard } from "@/components/dashboard/error-card";
import { KpiCard } from "@/components/dashboard/kpi-card";
import { KPI_GRID } from "@/components/dashboard/skeletons";
import { ReportAsOf } from "@/components/shell/shell-context";
import { customerHref } from "@/lib/customers";
import { previousYear, type Filters } from "@/lib/filters";
import { itemHref } from "@/lib/items";
import { formatAed } from "@/lib/format";
import { buildCalendar } from "@/lib/sales-calendar";
import { dataAsOf } from "@/lib/server/db";
import { load } from "@/lib/server/errors";
import { customerCodesByName } from "@/lib/server/queries/customers";
import { itemCodesByName } from "@/lib/server/queries/items";
import {
  salesBreakdown,
  salesDaily,
  salesKpis,
  salesMonthly,
  TOP_N,
  type BreakdownRow,
  type Dimension,
} from "@/lib/server/queries/sales";

import { CalendarTable } from "./calendar-table";
import { DrillableTrendChart } from "./sales-drill";

/** The five headline cards, each with last year's figure and a monthly sparkline. */
export async function SalesKpis({ filters }: { filters: Filters }) {
  const result = await load(() =>
    Promise.all([salesKpis(filters), salesKpis(previousYear(filters)), salesMonthly(filters)]),
  );
  if (!result.ok) return <ErrorCard message={result.message} />;
  const [current, previous, months] = result.data;

  return (
    <div className={KPI_GRID} data-testid="sales-kpis">
      <ReportAsOf iso={dataAsOf().toISOString()} />
      <KpiCard
        label="Net revenue"
        value={current.netRevenue}
        previous={previous.netRevenue}
        spark={months.map((month) => month.netRevenue)}
      />
      <KpiCard
        label="Gross margin"
        value={current.grossMargin}
        previous={previous.grossMargin}
        spark={months.map((month) => month.grossMargin)}
      />
      <KpiCard
        label="Margin %"
        value={current.marginPct}
        previous={previous.marginPct}
        format="pct"
        delta="pp"
        spark={months.map((month) => month.marginPct ?? 0)}
      />
      <KpiCard
        label="Invoices"
        value={current.invoiceCount}
        previous={previous.invoiceCount}
        format="int"
        spark={months.map((month) => month.invoiceCount)}
      />
      <KpiCard
        label="Returns"
        value={current.returnsValue}
        previous={previous.returnsValue}
        spark={months.map((month) => Math.abs(month.returnsValue))}
        hint="Credit notes; already netted out of revenue"
      />
    </div>
  );
}

export async function SalesTrend({ filters }: { filters: Filters }) {
  const result = await load(() => salesMonthly(filters));
  const total = result.ok ? result.data.reduce((sum, month) => sum + month.netRevenue, 0) : 0;
  return (
    <ChartCard
      title="Monthly net revenue"
      description="This year against the same months last year; select a bar to list its documents"
      action={result.ok ? <span className="tabular text-sm font-medium">{formatAed(total)}</span> : undefined}
    >
      {!result.ok ? (
        <ErrorCard message={result.message} />
      ) : result.data.every((month) => month.netRevenue === 0 && month.lastYearNetRevenue === 0) ? (
        <EmptyState />
      ) : (
        <DrillableTrendChart
          data={result.data.map((month) => ({
            month: month.month,
            thisYear: month.netRevenue,
            lastYear: month.lastYearNetRevenue,
          }))}
        />
      )}
    </ChartCard>
  );
}

function totalOf(rows: BreakdownRow[]): number {
  return rows.reduce((sum, row) => sum + row.netRevenue, 0);
}

/** Net revenue by one dimension as ranked bars. */
export async function SalesBreakdownChart({
  filters,
  dimension,
  title,
  description,
  topN,
}: {
  filters: Filters;
  dimension: Dimension;
  title: string;
  description: string;
  topN?: number;
}) {
  const result = await load(() => salesBreakdown(filters, dimension, topN));
  return (
    <ChartCard
      title={title}
      description={description}
      action={
        result.ok && result.data.length > 0 ? (
          <span className="tabular text-sm font-medium">{formatAed(totalOf(result.data))}</span>
        ) : undefined
      }
    >
      {!result.ok ? (
        <ErrorCard message={result.message} />
      ) : result.data.length === 0 ? (
        <EmptyState />
      ) : (
        <BarBreakdown
          data={result.data.map((row) => ({ label: row.label, value: row.netRevenue }))}
          ariaLabel={`${title}: ${result.data
            .slice(0, 5)
            .map((row) => `${row.label} ${formatAed(row.netRevenue)}`)
            .join(", ")}`}
        />
      )}
    </ChartCard>
  );
}

const TABLE_COLUMNS = (labelHeader: string): ColumnSpec[] => [
  { key: "label", header: labelHeader, linkKey: "href" },
  { key: "netRevenue", header: "Net revenue", format: "aed", sum: true },
  { key: "grossMargin", header: "Gross margin", format: "aed", sum: true },
  { key: "marginPct", header: "Margin %", format: "pct" },
  { key: "share", header: "Share", format: "pct" },
];

/** Top 20 of one dimension as a table; everything else is one 'All other' row. */
export async function SalesTopTable({
  filters,
  dimension,
  title,
  labelHeader,
}: {
  filters: Filters;
  dimension: Dimension;
  title: string;
  labelHeader: string;
}) {
  const result = await load(() => salesBreakdown(filters, dimension, TOP_N));
  const total = result.ok ? totalOf(result.data) : 0;
  // Customers and items are grouped by name (as reconciled); a name links to its page when one
  // code has it.
  const lookup =
    dimension === "customer" ? customerCodesByName : dimension === "item" ? itemCodesByName : null;
  const codes =
    result.ok && lookup
      ? await lookup(result.data.map((row) => row.label)).catch(() => new Map<string, string>())
      : new Map<string, string>();
  const href = dimension === "item" ? itemHref : customerHref;
  return (
    <ChartCard title={title} description={`Top ${TOP_N} by net revenue; the rest are grouped as "All other"`}>
      {!result.ok ? (
        <ErrorCard message={result.message} />
      ) : (
        <DataTable
          title={title}
          columns={TABLE_COLUMNS(labelHeader)}
          rows={result.data.map((row) => ({
            label: row.label,
            href: codes.has(row.label) ? href(codes.get(row.label)!, filters) : null,
            netRevenue: row.netRevenue,
            grossMargin: row.grossMargin,
            marginPct: row.marginPct,
            share: total ? row.netRevenue / total : null,
          }))}
          showTotals
        />
      )}
    </ChartCard>
  );
}

/** Months that expand to ISO weeks and days, with zero rows for days without sales. */
export async function SalesCalendar({ filters }: { filters: Filters }) {
  const result = await load(() => salesDaily(filters));
  return (
    <ChartCard
      title="Sales by month, week and day"
      description="Expand a month for its weeks and a week for its days; select a period to list its documents. Selling days have at least one invoice."
    >
      {!result.ok ? (
        <ErrorCard message={result.message} />
      ) : (
        <CalendarTable months={buildCalendar(filters.start, filters.end, result.data)} />
      )}
    </ChartCard>
  );
}
