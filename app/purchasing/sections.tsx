import "server-only";

import { AlertTriangle } from "lucide-react";

import { BarBreakdown } from "@/components/dashboard/bar-breakdown";
import { ChartCard } from "@/components/dashboard/chart-card";
import { DataQualityNote } from "@/components/dashboard/data-quality-note";
import { DataTable, type ColumnSpec } from "@/components/dashboard/data-table";
import { EmptyState } from "@/components/dashboard/empty-state";
import { ErrorCard } from "@/components/dashboard/error-card";
import { KpiCard } from "@/components/dashboard/kpi-card";
import { KPI_GRID } from "@/components/dashboard/skeletons";
import { TrendChart } from "@/components/dashboard/trend-chart";
import { ReportAsOf } from "@/components/shell/shell-context";
import { previousYear, type Filters } from "@/lib/filters";
import { formatAed, formatInt, formatNumber, formatPct } from "@/lib/format";
import { itemHref } from "@/lib/items";
import { dataAsOf } from "@/lib/server/db";
import { load } from "@/lib/server/errors";
import { companies } from "@/lib/server/queries/common";
import {
  AGING_BUCKETS,
  overdueLines,
  pendingByBucket,
  pendingByCompany,
  pendingBySupplier,
  pendingKpis,
  receiptsBySupplier,
  receiptsKpis,
  receiptsMonthly,
  TOP_N,
  zeroRateReceipts,
  type LabelValue,
} from "@/lib/server/queries/purchasing";

/** Pending POs are as of `today`; receipts follow the date filter. Both follow the company filter. */
interface SectionProps {
  filters: Filters;
  today: string;
}

/** Company code → name, from the company list; unknown codes show as the code. */
async function companyNames(): Promise<Map<string, string>> {
  return new Map((await companies()).map((company) => [company.code, company.name]));
}

function totalOf(rows: LabelValue[]): number {
  return rows.reduce((sum, row) => sum + row.value, 0);
}

function Total({ value }: { value: number }) {
  return <span className="tabular text-sm font-medium">{formatAed(value)}</span>;
}

function bars(title: string, rows: LabelValue[]) {
  return (
    <BarBreakdown
      data={rows}
      label="Pending value"
      ariaLabel={`${title}: ${rows
        .slice(0, 5)
        .map((row) => `${row.label} ${formatAed(row.value)}`)
        .join(", ")}`}
    />
  );
}

/** Four pending-PO cards (as of today) and receipts spend for the period vs last year. */
export async function PurchasingKpis({ filters, today }: SectionProps) {
  const result = await load(() =>
    Promise.all([
      pendingKpis(filters.companies, today),
      receiptsKpis(filters),
      receiptsKpis(previousYear(filters)),
      receiptsMonthly(filters),
    ]),
  );
  if (!result.ok) return <ErrorCard message={result.message} />;
  const [pending, receipts, lastYear, months] = result.data;

  return (
    <div className={KPI_GRID} data-testid="purchasing-kpis">
      <ReportAsOf iso={dataAsOf().toISOString()} />
      <KpiCard label="Pending PO value" value={pending.pendingValue} hint="Open PO lines, as of today" />
      <KpiCard
        label="Open PO lines"
        value={pending.openLines}
        format="int"
        hint="With quantity still to receive"
      />
      <KpiCard
        label="Overdue value"
        value={pending.overdueValue}
        hint={`${formatInt(pending.overdueLines)} lines past PO date + 84 days`}
      />
      <KpiCard label="Overdue %" value={pending.overduePct} format="pct" hint="Share of pending value" />
      <KpiCard
        label="Receipts spend"
        value={receipts.spend}
        previous={lastYear.spend}
        spark={months.map((month) => month.spend)}
        hint="Landed value, net of returns"
      />
    </div>
  );
}

export async function PendingByBucket({ filters, today }: SectionProps) {
  const title = "Pending value by aging";
  const result = await load(() => pendingByBucket(filters.companies, today));
  const total = result.ok ? totalOf(result.data) : 0;
  return (
    <ChartCard
      title={title}
      description="As of today. Expected date = PO date + 84 days."
      action={result.ok && total !== 0 ? <Total value={total} /> : undefined}
    >
      {!result.ok ? (
        <ErrorCard message={result.message} />
      ) : total === 0 ? (
        <EmptyState
          title="No pending PO lines"
          message="Nothing is waiting to be received for these companies."
        />
      ) : (
        <div className="flex flex-col gap-4">
          {bars(title, result.data)}
          <StalePoNote buckets={result.data} total={total} />
        </div>
      )}
    </ChartCard>
  );
}

/** Share of pending value above which the year-plus-overdue lines get a data-quality note. */
const STALE_SHARE = 0.25;

/**
 * Lines more than a year past their expected date are rarely still coming: they were usually
 * received or cancelled without the PO line being closed in Orion. On live Orion they are most of
 * the pending value, so the note says so.
 */
function StalePoNote({ buckets, total }: { buckets: LabelValue[]; total: number }) {
  const stale = buckets.find((bucket) => bucket.label === AGING_BUCKETS.at(-1)!.label)?.value ?? 0;
  if (total <= 0 || stale / total < STALE_SHARE) return null;
  return (
    <DataQualityNote
      testId="stale-po-note"
      title={`${formatPct(stale / total)} of pending value is more than a year overdue`}
    >
      (<span className="tabular">{formatAed(stale)}</span>). Lines this old are usually received or cancelled
      without the PO line being closed in Orion, so pending value and overdue % above include them. Closing
      them in Orion makes these figures mean what they say.
    </DataQualityNote>
  );
}

export async function PendingBySupplier({ filters, today }: SectionProps) {
  const title = "Pending value by supplier";
  const result = await load(() => pendingBySupplier(filters.companies, today));
  return (
    <ChartCard
      title={title}
      description={`As of today. Top ${TOP_N} suppliers; the rest are grouped as “All other”`}
      action={result.ok && result.data.length > 0 ? <Total value={totalOf(result.data)} /> : undefined}
    >
      {!result.ok ? (
        <ErrorCard message={result.message} />
      ) : result.data.length === 0 ? (
        <EmptyState
          title="No pending PO lines"
          message="Nothing is waiting to be received for these companies."
        />
      ) : (
        bars(title, result.data)
      )}
    </ChartCard>
  );
}

export async function PendingByCompany({ filters, today }: SectionProps) {
  const title = "Pending value by company";
  const result = await load(() => Promise.all([pendingByCompany(filters.companies, today), companyNames()]));
  const rows = result.ok
    ? result.data[0].map((row) => ({ label: result.data[1].get(row.label) ?? row.label, value: row.value }))
    : [];
  return (
    <ChartCard
      title={title}
      description="As of today"
      action={rows.length > 0 ? <Total value={totalOf(rows)} /> : undefined}
    >
      {!result.ok ? (
        <ErrorCard message={result.message} />
      ) : rows.length === 0 ? (
        <EmptyState
          title="No pending PO lines"
          message="Nothing is waiting to be received for these companies."
        />
      ) : (
        bars(title, rows)
      )}
    </ChartCard>
  );
}

const OVERDUE_COLUMNS: ColumnSpec[] = [
  { key: "company", header: "Company" },
  { key: "poNumber", header: "PO number" },
  { key: "supplier", header: "Supplier" },
  { key: "item", header: "Item", linkKey: "itemHref" },
  { key: "poDate", header: "PO date", format: "date" },
  { key: "daysOpen", header: "Days open", format: "int" },
  { key: "pendingQty", header: "Pending qty", format: "qty" },
  { key: "pendingValue", header: "Pending value", format: "aed", sum: true },
];

/** Overdue PO lines, largest first, capped at OVERDUE_ROW_LIMIT. */
export async function OverdueLinesTable({ filters, today }: SectionProps) {
  const title = "Overdue PO lines";
  const result = await load(() =>
    Promise.all([
      overdueLines(filters.companies, today),
      pendingKpis(filters.companies, today),
      companyNames(),
    ]),
  );
  let description = "As of today: open lines past PO date + 84 days";
  if (result.ok) {
    const [lines, kpis] = result.data;
    description =
      kpis.overdueLines > lines.length
        ? `Showing the ${formatInt(lines.length)} largest of ${formatInt(kpis.overdueLines)} overdue lines by pending value. Export has the same ${formatInt(lines.length)}.`
        : `${formatInt(lines.length)} open lines past PO date + 84 days, as of today`;
  }
  return (
    <ChartCard title={title} description={description}>
      <div data-testid="overdue-table">
        {!result.ok ? (
          <ErrorCard message={result.message} />
        ) : (
          <DataTable
            title={title}
            columns={OVERDUE_COLUMNS}
            rows={result.data[0].map((line) => ({
              company: result.data[2].get(line.companyCode) ?? line.companyCode,
              poNumber: line.poNumber,
              supplier: line.supplier,
              item: line.item,
              itemHref: line.itemCode ? itemHref(line.itemCode, filters) : null,
              poDate: line.poDate,
              daysOpen: line.daysOpen,
              pendingQty: line.pendingQty,
              pendingValue: line.pendingValue,
            }))}
            initialSort={[{ id: "pendingValue", desc: true }]}
            showTotals
          />
        )}
      </div>
    </ChartCard>
  );
}

export async function ReceiptsTrend({ filters }: { filters: Filters }) {
  const result = await load(() => receiptsMonthly(filters));
  const total = result.ok ? result.data.reduce((sum, month) => sum + month.spend, 0) : 0;
  return (
    <ChartCard
      title="Monthly receipts spend"
      description="Landed value of goods received, net of returns to suppliers, against the same months last year"
      action={result.ok ? <Total value={total} /> : undefined}
    >
      {!result.ok ? (
        <ErrorCard message={result.message} />
      ) : result.data.every((month) => month.spend === 0 && month.lastYearSpend === 0) ? (
        <EmptyState />
      ) : (
        <TrendChart
          ariaLabel="Monthly receipts spend, this year compared with last year"
          data={result.data.map((month) => ({
            month: month.month,
            thisYear: month.spend,
            lastYear: month.lastYearSpend,
          }))}
        />
      )}
    </ChartCard>
  );
}

const SUPPLIER_COLUMNS: ColumnSpec[] = [
  { key: "label", header: "Supplier" },
  { key: "spend", header: "Spend", format: "aed", sum: true },
  { key: "share", header: "Share", format: "pct" },
];

export async function ReceiptsTopSuppliers({ filters }: { filters: Filters }) {
  const title = "Top suppliers by spend";
  const result = await load(() => receiptsBySupplier(filters));
  const total = result.ok ? totalOf(result.data) : 0;
  return (
    <ChartCard
      title={title}
      description={`Top ${TOP_N} by receipts spend; the rest are grouped as “All other”`}
    >
      {!result.ok ? (
        <ErrorCard message={result.message} />
      ) : (
        <DataTable
          title={title}
          columns={SUPPLIER_COLUMNS}
          rows={result.data.map((row) => ({
            label: row.label,
            spend: row.value,
            share: total ? row.value / total : null,
          }))}
          showTotals
        />
      )}
    </ChartCard>
  );
}

/** Non-AED receipt lines with a zero exchange rate. Renders nothing when there are none. */
export async function ZeroRateCallout({ filters }: { filters: Filters }) {
  const result = await load(() => zeroRateReceipts(filters));
  if (!result.ok) return <ErrorCard message={result.message} />;
  if (result.data.length === 0) return null;
  const lineCount = result.data.reduce((sum, row) => sum + row.lineCount, 0);
  const recorded = result.data.reduce((sum, row) => sum + row.landedValue, 0);
  return (
    <section
      aria-labelledby="zero-rate-heading"
      className="flex flex-col gap-3 rounded-xl border border-amber-500/40 bg-amber-500/10 p-5 sm:flex-row sm:items-start"
      data-testid="zero-rate-callout"
    >
      <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-amber-500/15 text-amber-700 dark:text-amber-400">
        <AlertTriangle className="size-4.5" aria-hidden />
      </span>
      <div className="min-w-0 flex-1 space-y-1 text-sm">
        <h2 id="zero-rate-heading" className="font-semibold">
          Data quality: {formatInt(lineCount)} receipt {lineCount === 1 ? "line" : "lines"} in foreign
          currency with an exchange rate of 0
        </h2>
        <p className="text-muted-foreground">
          Their AED value is recorded as {formatAed(recorded)}, so receipts spend above is understated.
          Foreign-currency value:{" "}
          {result.data
            .map((row) => `${row.currency} ${formatNumber(row.fcValue)} (${formatInt(row.lineCount)})`)
            .join(", ")}
          . Fix the rate on the receipt in Orion.
        </p>
      </div>
    </section>
  );
}
