import "server-only";

import { BarBreakdown } from "@/components/dashboard/bar-breakdown";
import { ChartCard } from "@/components/dashboard/chart-card";
import { DataTable, type ColumnSpec } from "@/components/dashboard/data-table";
import { EmptyState } from "@/components/dashboard/empty-state";
import { ErrorCard } from "@/components/dashboard/error-card";
import { KpiCard } from "@/components/dashboard/kpi-card";
import { MonthEndChart } from "@/components/dashboard/month-end-chart";
import { KPI_GRID } from "@/components/dashboard/skeletons";
import { ReportAsOf } from "@/components/shell/shell-context";
import { Badge } from "@/components/ui/badge";
import { todayIso } from "@/lib/filters";
import { formatAed, formatAedCompact, formatDeltaPct, formatInt, formatMonth, pctChange } from "@/lib/format";
import { dataAsOf } from "@/lib/server/db";
import { load } from "@/lib/server/errors";
import {
  DEAD_STOCK_MONTHS,
  DEAD_STOCK_TOP_N,
  DEFAULT_DEAD_STOCK_MONTHS,
  deadStock,
  inventoryKpis,
  monthEndTrend,
  reorderAlerts,
  stockBreakdown,
  TREND_PERIODS,
  type DeadStockMonths,
  type InventoryDimension,
  type MonthEnd,
} from "@/lib/server/queries/inventory";

import { DeadStockToggle } from "./dead-stock-toggle";

/** The current month, `YYYY-MM`: its month-end is provisional. */
function currentMonth(): string {
  return todayIso().slice(0, 7);
}

/** The newest month-end before the current month. */
function lastClosed(months: MonthEnd[]): MonthEnd | undefined {
  const current = currentMonth();
  return months.filter((month) => month.month < current).at(-1);
}

/** The five headline cards: live stock as of today, and the change since the last month-end. */
export async function InventoryKpis({ companies }: { companies: string[] }) {
  const result = await load(() => Promise.all([inventoryKpis(companies), monthEndTrend(companies)]));
  if (!result.ok) return <ErrorCard message={result.message} />;
  const [kpis, months] = result.data;
  const closed = lastClosed(months);
  const change = closed ? kpis.stockValue - closed.closeValue : null;
  const spark = months.map((month) => month.closeValue);

  return (
    <div className={KPI_GRID} data-testid="inventory-kpis">
      <ReportAsOf iso={dataAsOf().toISOString()} />
      <KpiCard
        label="Stock value"
        value={kpis.stockValue}
        spark={spark}
        hint={kpis.frozenValue ? `${formatAedCompact(kpis.frozenValue)} in frozen items` : undefined}
      />
      <KpiCard
        label="Available value"
        value={kpis.availableValue}
        hint={
          kpis.stockValue
            ? `${formatPctOf(kpis.availableValue, kpis.stockValue)} of stock, free to sell`
            : undefined
        }
      />
      <KpiCard label="Reserved value" value={kpis.reservedValue} hint="Held for customers or transfers" />
      <KpiCard
        label="Stocked items"
        value={kpis.stockedItems}
        format="int"
        hint="Items with stock on hand, per company"
      />
      <KpiCard
        label="Change vs last month-end"
        value={change}
        hint={
          closed
            ? `vs ${formatMonth(closed.month)} close of ${formatAedCompact(closed.closeValue)} (${formatDeltaPct(
                pctChange(kpis.stockValue, closed.closeValue),
              )})`
            : "No closed month-end yet"
        }
      />
    </div>
  );
}

function formatPctOf(part: number, whole: number): string {
  return `${Math.round((part / whole) * 100)}%`;
}

/** Live stock value by one dimension as ranked bars. */
export async function StockBreakdownChart({
  companies,
  dimension,
  title,
  description,
  topN,
}: {
  companies: string[];
  dimension: InventoryDimension;
  title: string;
  description: string;
  topN?: number;
}) {
  const result = await load(() => stockBreakdown(companies, dimension, topN));
  const total = result.ok ? result.data.reduce((sum, row) => sum + row.value, 0) : 0;
  return (
    <ChartCard
      title={title}
      description={description}
      action={
        result.ok && result.data.length > 0 ? (
          <span className="tabular text-sm font-medium">{formatAed(total)}</span>
        ) : undefined
      }
    >
      {!result.ok ? (
        <ErrorCard message={result.message} />
      ) : result.data.length === 0 || total === 0 ? (
        <EmptyState title="No stock for these companies" message="Try more companies." />
      ) : (
        <BarBreakdown
          data={result.data.map((row) => ({ label: row.label, value: row.value }))}
          label="Stock value"
          ariaLabel={`${title}: ${result.data
            .slice(0, 5)
            .map((row) => `${row.label} ${formatAed(row.value)}`)
            .join(", ")}`}
        />
      )}
    </ChartCard>
  );
}

/** Closing stock value for the last 24 month-ends; the current month is provisional. */
export async function MonthEndTrend({ companies }: { companies: string[] }) {
  const result = await load(() => monthEndTrend(companies));
  const current = currentMonth();
  const closed = result.ok ? lastClosed(result.data) : undefined;
  return (
    <ChartCard
      title="Month-end stock value"
      description={`Closing stock value for the last ${TREND_PERIODS} month-ends; ${formatMonth(current)} is provisional and still changing`}
      action={
        closed ? (
          <span className="tabular text-sm font-medium" title={`${formatMonth(closed.month)} close`}>
            {formatAed(closed.closeValue)}
          </span>
        ) : undefined
      }
    >
      {!result.ok ? (
        <ErrorCard message={result.message} />
      ) : result.data.every((month) => month.closeValue === 0) ? (
        <EmptyState title="No month-end stock for these companies" message="Try more companies." />
      ) : (
        <MonthEndChart
          data={result.data.map((month) => ({
            month: month.month,
            value: month.closeValue,
            provisional: month.month >= current,
          }))}
          ariaLabel={`Month-end stock value from ${formatMonth(result.data[0].month)} to ${formatMonth(
            result.data.at(-1)!.month,
          )}${closed ? `; ${formatMonth(closed.month)} closed at ${formatAed(closed.closeValue)}` : ""}`}
        />
      )}
    </ChartCard>
  );
}

const DEAD_STOCK_COLUMNS: ColumnSpec[] = [
  { key: "item", header: "Item" },
  { key: "itemCode", header: "Code" },
  { key: "company", header: "Company" },
  { key: "location", header: "Location" },
  { key: "closeQty", header: "Closing qty", format: "qty" },
  { key: "closeValue", header: "Closing value", format: "aed", sum: true },
];

/** Stock with no movement for N months, ranked by value, with the total value at risk. */
export async function DeadStockSection({
  companies,
  months,
}: {
  companies: string[];
  months: DeadStockMonths;
}) {
  const result = await load(() => deadStock(companies, months));
  const asOf = result.ok && result.data.asOfMonth ? formatMonth(result.data.asOfMonth) : null;
  return (
    <ChartCard
      title="Dead and slow stock"
      description={`Items holding stock whose closing quantity hasn't moved for ${months} months or more${
        asOf ? `, up to ${asOf}` : ""
      }, by closing value`}
      action={
        <DeadStockToggle
          options={DEAD_STOCK_MONTHS}
          value={months}
          defaultValue={DEFAULT_DEAD_STOCK_MONTHS}
        />
      }
    >
      {!result.ok ? (
        <ErrorCard message={result.message} />
      ) : result.data.count === 0 ? (
        <EmptyState
          title={`No stock has been still for ${months} months`}
          message="Every item on hand moved in that time."
        />
      ) : (
        <div className="flex flex-col gap-4">
          <p className="text-sm" data-testid="dead-stock-total">
            <span className="text-muted-foreground">Value at risk: </span>
            <span className="tabular font-semibold">{formatAed(result.data.value)}</span>
            <span className="text-muted-foreground">
              {" "}
              across {formatInt(result.data.count)} {result.data.count === 1 ? "item" : "items"}
              {result.data.count > result.data.rows.length ? ` (top ${DEAD_STOCK_TOP_N} listed)` : ""}
            </span>
          </p>
          <DataTable
            title={`Dead stock ${months} months`}
            columns={DEAD_STOCK_COLUMNS}
            rows={result.data.rows.map((row) => ({ ...row }))}
            showTotals={result.data.count === result.data.rows.length}
          />
        </div>
      )}
    </ChartCard>
  );
}

const REORDER_COLUMNS: ColumnSpec[] = [
  { key: "item", header: "Item" },
  { key: "itemCode", header: "Code" },
  { key: "company", header: "Company" },
  { key: "location", header: "Location" },
  { key: "available", header: "Available", format: "qty" },
  { key: "reorderLevel", header: "Reorder level", format: "qty" },
  { key: "reorderQty", header: "Reorder qty", format: "qty" },
];

/** Active items at or below their reorder level. */
export async function ReorderAlertsSection({ companies }: { companies: string[] }) {
  const result = await load(() => reorderAlerts(companies));
  return (
    <ChartCard
      title="Reorder alerts"
      description="Active items whose available stock at a location is at or below the item's reorder level"
      action={
        result.ok ? (
          <Badge variant="secondary" className="tabular" data-testid="reorder-count">
            {formatInt(result.data.length)} {result.data.length === 1 ? "alert" : "alerts"}
          </Badge>
        ) : undefined
      }
    >
      {!result.ok ? (
        <ErrorCard message={result.message} />
      ) : result.data.length === 0 ? (
        <EmptyState title="Nothing to reorder" message="No active item is at or below its reorder level." />
      ) : (
        <DataTable
          title="Reorder alerts"
          columns={REORDER_COLUMNS}
          rows={result.data.map((alert) => ({
            item: alert.item,
            itemCode: alert.itemCode,
            company: alert.company,
            location: alert.location,
            available: alert.available,
            reorderLevel: alert.reorderLevel,
            reorderQty: alert.reorderQty,
          }))}
        />
      )}
    </ChartCard>
  );
}
