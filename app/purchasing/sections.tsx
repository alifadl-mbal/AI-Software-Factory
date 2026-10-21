import "server-only";

import { Suspense } from "react";
import { AlertTriangle } from "lucide-react";

import { BarBreakdown } from "@/components/dashboard/bar-breakdown";
import { ChartCard, HOVER_CARD_FRAME } from "@/components/dashboard/chart-card";
import { DataQualityNote } from "@/components/dashboard/data-quality-note";
import { DataTable, type ColumnSpec } from "@/components/dashboard/data-table";
import { EmptyState } from "@/components/dashboard/empty-state";
import { ErrorCard } from "@/components/dashboard/error-card";
import { KpiCard } from "@/components/dashboard/kpi-card";
import { OrderAgeNote } from "@/components/dashboard/order-age-note";
import { OrderAgeToggle } from "@/components/dashboard/order-age-toggle";
import { KPI_GRID } from "@/components/dashboard/skeletons";
import { ReportAsOf } from "@/components/shell/shell-context";
import { filtersToSearch, previousYear, type Filters } from "@/lib/filters";
import { formatAed, formatInt, formatNumber, formatPct } from "@/lib/format";
import { orderAgeCutoff, orderAgeScope, withOrderAge, type OrderAge } from "@/lib/order-age";
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

import { ReceiptsTrendChart } from "./charts";

/**
 * Pending POs are as of `today` and follow the order-age choice; receipts follow the date filter.
 * Both follow the company and brand filters.
 */
interface SectionProps {
  filters: Filters;
  today: string;
  age: OrderAge;
}

/** "As of today, orders from the last 2 years" */
function asOfToday(age: OrderAge): string {
  return `As of today, ${orderAgeScope(age)}`;
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
export async function PurchasingKpis({ filters, today, age }: SectionProps) {
  const result = await load(() =>
    Promise.all([
      pendingKpis(filters, today, age),
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
      <KpiCard
        label="Pending PO value"
        value={pending.pendingValue}
        hint={`Open PO lines on ${orderAgeScope(age)}`}
      />
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

/**
 * The order-age toggle for pending POs, and what it leaves out. The toggle shows at once; the note
 * streams in with the KPI query (same loader and arguments, so the same cache entry).
 */
export function OrderAgeBar({ pendingKey, ...props }: SectionProps & { pendingKey: string }) {
  return (
    <div className="flex scroll-mt-20 flex-wrap items-center gap-x-4 gap-y-2" id="order-age">
      <OrderAgeToggle value={props.age} />
      <Suspense key={`hidden${pendingKey}`} fallback={null}>
        <HiddenPendingNote {...props} />
      </Suspense>
    </div>
  );
}

async function HiddenPendingNote({ filters, today, age }: SectionProps) {
  const cutoff = orderAgeCutoff(age, today);
  if (cutoff === null) return null;
  const result = await load(() => pendingKpis(filters, today, age));
  if (!result.ok) return null;
  return (
    <OrderAgeNote
      hiddenLines={result.data.hiddenLines}
      hiddenValue={result.data.hiddenValue}
      cutoff={cutoff}
      showAllHref={`/purchasing${withOrderAge(filtersToSearch(filters), "all")}`}
    />
  );
}

export async function PendingByBucket({ filters, today, age }: SectionProps) {
  const title = "Pending value by aging";
  const result = await load(() => pendingByBucket(filters, today, age));
  const total = result.ok ? totalOf(result.data) : 0;
  return (
    <ChartCard
      title={title}
      description={`${asOfToday(age)}. Expected date = PO date + 84 days.`}
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
          <StalePoNote buckets={result.data} total={total} age={age} />
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
function StalePoNote({ buckets, total, age }: { buckets: LabelValue[]; total: number; age: OrderAge }) {
  const stale = buckets.find((bucket) => bucket.label === AGING_BUCKETS.at(-1)!.label)?.value ?? 0;
  if (total <= 0 || stale / total < STALE_SHARE) return null;
  return (
    <DataQualityNote
      testId="stale-po-note"
      title={`${formatPct(stale / total)} of pending value is more than a year overdue`}
    >
      (<span className="tabular">{formatAed(stale)}</span>). Lines this old are usually received or cancelled
      without the PO line being closed in Orion, so pending value and overdue % above include them.{" "}
      {age === "all"
        ? "“Orders placed: last 2 years” above leaves the oldest out."
        : "“Orders placed: 12 months” above leaves more of them out."}{" "}
      Closing them in Orion makes these figures mean what they say.
    </DataQualityNote>
  );
}

export async function PendingBySupplier({ filters, today, age }: SectionProps) {
  const title = "Pending value by supplier";
  const result = await load(() => pendingBySupplier(filters, today, age));
  return (
    <ChartCard
      title={title}
      description={`${asOfToday(age)}. Top ${TOP_N} suppliers; the rest are grouped as “All other”`}
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

export async function PendingByCompany({ filters, today, age }: SectionProps) {
  const title = "Pending value by company";
  const result = await load(() => Promise.all([pendingByCompany(filters, today, age), companyNames()]));
  const rows = result.ok
    ? result.data[0].map((row) => ({ label: result.data[1].get(row.label) ?? row.label, value: row.value }))
    : [];
  return (
    <ChartCard
      title={title}
      description={asOfToday(age)}
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
export async function OverdueLinesTable({ filters, today, age }: SectionProps) {
  const title = "Overdue PO lines";
  const result = await load(() =>
    Promise.all([overdueLines(filters, today, age), pendingKpis(filters, today, age), companyNames()]),
  );
  let description = `${asOfToday(age)}: open lines past PO date + 84 days`;
  if (result.ok) {
    const [lines, kpis] = result.data;
    description =
      kpis.overdueLines > lines.length
        ? `Showing the ${formatInt(lines.length)} largest of ${formatInt(kpis.overdueLines)} overdue lines by pending value. Export has the same ${formatInt(lines.length)}.`
        : `${formatInt(lines.length)} open lines past PO date + 84 days. ${asOfToday(age)}.`;
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
              itemHref: line.itemCode
                ? itemHref(line.itemCode, withOrderAge(filtersToSearch(filters), age))
                : null,
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
      className={HOVER_CARD_FRAME}
      description="Landed value of goods received, net of returns to suppliers, against the same months last year; hover or tap a bar for its breakdown, select it to list its receipts"
      action={result.ok ? <Total value={total} /> : undefined}
    >
      {!result.ok ? (
        <ErrorCard message={result.message} />
      ) : result.data.every((month) => month.spend === 0 && month.lastYearSpend === 0) ? (
        <EmptyState />
      ) : (
        <ReceiptsTrendChart
          data={result.data.map((month) => ({
            month: month.month,
            thisYear: month.spend,
            lastYear: month.lastYearSpend,
          }))}
          start={filters.start}
          end={filters.end}
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
        <p className="text-foreground/75">
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
