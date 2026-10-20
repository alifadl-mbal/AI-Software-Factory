import "server-only";

import { Suspense } from "react";

import { AgingChart } from "@/components/dashboard/aging-chart";
import { BarBreakdown } from "@/components/dashboard/bar-breakdown";
import { ChartCard } from "@/components/dashboard/chart-card";
import { DataQualityNote } from "@/components/dashboard/data-quality-note";
import { DataTable, type ColumnSpec } from "@/components/dashboard/data-table";
import { EmptyState } from "@/components/dashboard/empty-state";
import { ErrorCard } from "@/components/dashboard/error-card";
import { KpiCard } from "@/components/dashboard/kpi-card";
import { OrderAgeNote } from "@/components/dashboard/order-age-note";
import { OrderAgeToggle } from "@/components/dashboard/order-age-toggle";
import { TrendChart } from "@/components/dashboard/trend-chart";
import { ReportAsOf } from "@/components/shell/shell-context";
import { AGING_BUCKETS } from "@/lib/aging";
import { customerHref } from "@/lib/customers";
import { filtersToSearch, previousYear, type Filters } from "@/lib/filters";
import { formatAed, formatAedCompact, formatInt, formatPct } from "@/lib/format";
import { salesOrderCurrencyNote } from "@/lib/notes";
import { orderAgeCutoff, orderAgeScope, withOrderAge, type OrderAge } from "@/lib/order-age";
import { dataAsOf } from "@/lib/server/db";
import { load } from "@/lib/server/errors";
import { companies } from "@/lib/server/queries/common";
import { customerCodesByName } from "@/lib/server/queries/customers";
import {
  bookedKpis,
  bookedMonthly,
  openBookKpis,
  openByAge,
  openByCurrency,
  openByCustomer,
  openBySalesperson,
  openLines,
  TOP_CUSTOMERS,
  TOP_SALESPEOPLE,
  type LabelValue,
} from "@/lib/server/queries/sales-orders";

/**
 * The open book is as of `today` and follows the companies and the order-age choice; "booked"
 * follows both filters and ignores order age.
 */
interface SectionProps {
  filters: Filters;
  today: string;
  age: OrderAge;
}

/** Six cards: three per row on wide screens, two on phones. */
export const SALES_ORDER_KPI_GRID = "grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-3";

/** "As of today, AED orders from the last 2 years; …" */
function asOfToday(age: OrderAge): string {
  return `As of today, AED ${orderAgeScope(age)}; the company filter applies, the period doesn't`;
}

function totalOf(rows: LabelValue[]): number {
  return rows.reduce((sum, row) => sum + row.value, 0);
}

function Total({ value }: { value: number }) {
  return <span className="tabular text-sm font-medium">{formatAed(value)}</span>;
}

const NOTHING_OPEN = "No open sales orders for these companies.";

export async function SalesOrderKpis({ filters, today, age }: SectionProps) {
  const result = await load(() =>
    Promise.all([
      openBookKpis(filters.companies, today, age),
      bookedKpis(filters),
      bookedKpis(previousYear(filters)),
      bookedMonthly(filters),
    ]),
  );
  if (!result.ok) return <ErrorCard message={result.message} />;
  const [book, booked, lastYear, months] = result.data;
  const overduePct = book.openValue ? book.overdueValue / book.openValue : null;

  return (
    <div className={SALES_ORDER_KPI_GRID} data-testid="sales-order-kpis">
      <ReportAsOf iso={dataAsOf().toISOString()} />
      <KpiCard
        label="Open order value"
        value={book.openValue}
        hint={`Still to deliver, on ${orderAgeScope(age)}`}
      />
      <KpiCard label="Open orders" value={book.openOrders} format="int" hint="With a line still to deliver" />
      <KpiCard
        label="Open lines"
        value={book.openLines}
        format="int"
        hint={`${formatInt(book.overdueLines)} past their expected delivery`}
      />
      <KpiCard
        label="Delivered, not invoiced"
        value={book.uninvoicedValue}
        hint={`${formatInt(book.uninvoicedLines)} lines, as of today`}
      />
      <KpiCard
        label="Overdue open value"
        value={book.overdueValue}
        hint={
          overduePct === null
            ? "Nothing open"
            : `${formatPct(overduePct)} of open value; past expected delivery`
        }
      />
      <KpiCard
        label="Orders booked"
        value={booked.orders}
        previous={lastYear.orders}
        format="int"
        spark={months.map((month) => month.orders)}
        hint={`${formatAedCompact(booked.value)} in the period (vs ${formatAedCompact(lastYear.value)})`}
      />
    </div>
  );
}

/**
 * The order-age toggle for the open book, and what it leaves out. The toggle shows at once; the note
 * streams in with the KPI query (same loader and arguments, so the same cache entry).
 */
export function OrderAgeBar({ bookKey, ...props }: SectionProps & { bookKey: string }) {
  return (
    <div className="flex scroll-mt-20 flex-wrap items-center gap-x-4 gap-y-2" id="order-age">
      <OrderAgeToggle value={props.age} />
      <Suspense key={`hidden${bookKey}`} fallback={null}>
        <HiddenBookNote {...props} />
      </Suspense>
    </div>
  );
}

async function HiddenBookNote({ filters, today, age }: SectionProps) {
  const cutoff = orderAgeCutoff(age, today);
  if (cutoff === null) return null;
  const result = await load(() => openBookKpis(filters.companies, today, age));
  if (!result.ok) return null;
  return (
    <OrderAgeNote
      hiddenLines={result.data.hiddenLines}
      hiddenValue={result.data.hiddenValue}
      cutoff={cutoff}
      showAllHref={`/sales-orders${withOrderAge(filtersToSearch(filters), "all")}`}
    />
  );
}

/** Non-AED orders, which the AED figures leave out. Renders nothing when there are none. */
export async function CurrencyNote({ filters, today, age }: SectionProps) {
  const result = await load(() => openByCurrency(filters.companies, today, age));
  if (!result.ok) return <ErrorCard message={result.message} />;
  const note = salesOrderCurrencyNote(result.data);
  if (note === null) return null;
  return (
    <p className="text-xs text-muted-foreground" data-testid="so-currency-note">
      {note}
    </p>
  );
}

export async function OpenByAge({ filters, today, age }: SectionProps) {
  const title = "Open value by order age";
  const result = await load(() => openByAge(filters.companies, today, age));
  const total = result.ok ? result.data.reduce((sum, value) => sum + value, 0) : 0;
  return (
    <ChartCard
      title={title}
      description={`${asOfToday(age)}. Age from the order date; orange columns are 3 months old or more.`}
      action={result.ok && total !== 0 ? <Total value={total} /> : undefined}
    >
      {!result.ok ? (
        <ErrorCard message={result.message} />
      ) : total === 0 ? (
        <EmptyState title="Nothing open" message={NOTHING_OPEN} />
      ) : (
        <div className="flex flex-col gap-4">
          <AgingChart
            values={result.data}
            label="Open value"
            ariaLabel={`${title}: ${AGING_BUCKETS.map((bucket, index) => `${bucket} ${formatAed(result.data[index])}`).join(", ")}`}
          />
          <StaleOrderNote oldest={result.data.at(-1) ?? 0} total={total} age={age} />
        </div>
      )}
    </ChartCard>
  );
}

/** Share of open value above which orders over two years old get a data-quality note. */
const STALE_SHARE = 0.25;

/**
 * Orders over two years old with something "still to deliver" are rarely live: they were usually
 * delivered, invoiced directly or cancelled without the order being closed in Orion. On live Orion
 * they are most of the open value, so the note says so.
 */
function StaleOrderNote({ oldest, total, age }: { oldest: number; total: number; age: OrderAge }) {
  if (total <= 0 || oldest / total < STALE_SHARE) return null;
  return (
    <DataQualityNote
      testId="stale-order-note"
      title={`${formatPct(oldest / total)} of open value is on orders more than two years old`}
    >
      (<span className="tabular">{formatAed(oldest)}</span>). Orders this old are usually delivered, invoiced
      directly or cancelled without being closed in Orion, so open order value and overdue value above include
      them. {age === "all" ? "“Orders placed: last 2 years” above leaves them out. " : ""}Closing them in
      Orion makes these figures mean what they say.
    </DataQualityNote>
  );
}

export async function OpenBySalesperson({ filters, today, age }: SectionProps) {
  const title = "Open value by salesperson";
  const result = await load(() => openBySalesperson(filters.companies, today, age));
  return (
    <ChartCard
      title={title}
      description={`${asOfToday(age)}. Top ${TOP_SALESPEOPLE}; the rest are grouped as “All other”.`}
      action={result.ok && result.data.length > 0 ? <Total value={totalOf(result.data)} /> : undefined}
    >
      {!result.ok ? (
        <ErrorCard message={result.message} />
      ) : result.data.length === 0 ? (
        <EmptyState title="Nothing open" message={NOTHING_OPEN} />
      ) : (
        <BarBreakdown
          data={result.data}
          label="Open value"
          ariaLabel={`${title}: ${result.data
            .slice(0, 5)
            .map((row) => `${row.label} ${formatAed(row.value)}`)
            .join(", ")}`}
        />
      )}
    </ChartCard>
  );
}

const CUSTOMER_COLUMNS: ColumnSpec[] = [
  { key: "label", header: "Customer", linkKey: "href" },
  { key: "value", header: "Open value", format: "aed", sum: true },
  { key: "share", header: "Share", format: "pct" },
];

export async function OpenByCustomer({ filters, today, age }: SectionProps) {
  const title = "Top customers by open value";
  const result = await load(() => openByCustomer(filters.companies, today, age));
  const total = result.ok ? totalOf(result.data) : 0;
  // Grouped by name (codes sharing a name add up); a name links when only one code carries it.
  const codes = result.ok
    ? await customerCodesByName(result.data.map((row) => row.label)).catch(() => new Map<string, string>())
    : new Map<string, string>();
  return (
    <ChartCard
      title={title}
      description={`${asOfToday(age)}. Top ${TOP_CUSTOMERS}; the rest are grouped as “All other”.`}
    >
      {!result.ok ? (
        <ErrorCard message={result.message} />
      ) : (
        <DataTable
          title={title}
          columns={CUSTOMER_COLUMNS}
          rows={result.data.map((row) => ({
            label: row.label,
            href: codes.has(row.label) ? customerHref(codes.get(row.label)!, filters) : null,
            value: row.value,
            share: total ? row.value / total : null,
          }))}
          showTotals
        />
      )}
    </ChartCard>
  );
}

export async function BookedTrend({ filters }: { filters: Filters }) {
  const result = await load(() => bookedMonthly(filters));
  const total = result.ok ? result.data.reduce((sum, month) => sum + month.value, 0) : 0;
  return (
    <ChartCard
      title="Monthly orders booked"
      description="Value of AED orders by order date, against the same months last year. Follows the period. Cancelled quantities are left out."
      action={result.ok ? <Total value={total} /> : undefined}
    >
      {!result.ok ? (
        <ErrorCard message={result.message} />
      ) : result.data.every((month) => month.value === 0 && month.lastYearValue === 0) ? (
        <EmptyState />
      ) : (
        <TrendChart
          ariaLabel="Monthly orders booked, this year compared with last year"
          data={result.data.map((month) => ({
            month: month.month,
            thisYear: month.value,
            lastYear: month.lastYearValue,
          }))}
        />
      )}
    </ChartCard>
  );
}

const LINE_COLUMNS: ColumnSpec[] = [
  { key: "company", header: "Company" },
  { key: "orderNumber", header: "Order no" },
  { key: "orderDate", header: "Order date", format: "date" },
  { key: "customer", header: "Customer", linkKey: "customerHref" },
  { key: "salesperson", header: "Salesperson" },
  { key: "item", header: "Item" },
  { key: "orderedQty", header: "Ordered", format: "qty" },
  { key: "deliveredQty", header: "Delivered", format: "qty" },
  { key: "invoicedQty", header: "Invoiced", format: "qty" },
  { key: "pendingValue", header: "Pending value", format: "aed", sum: true },
  { key: "expectedDate", header: "Expected delivery", format: "date" },
  { key: "daysOverdue", header: "Days overdue", format: "int" },
];

/** Open AED order lines, largest pending value first, capped at OPEN_ROW_LIMIT. */
export async function OpenLinesTable({ filters, today, age }: SectionProps) {
  const title = "Open order lines";
  const result = await load(() =>
    Promise.all([
      openLines(filters.companies, today, age),
      openBookKpis(filters.companies, today, age),
      companies().then((list) => new Map(list.map((company) => [company.code, company.name]))),
    ]),
  );
  let description = `${asOfToday(age)}.`;
  if (result.ok) {
    const [lines, kpis] = result.data;
    description =
      kpis.openAedLines > lines.length
        ? `As of today, ${orderAgeScope(age)}: the ${formatInt(lines.length)} largest of ${formatInt(kpis.openAedLines)} open AED lines by pending value. Export has the same ${formatInt(lines.length)}.`
        : `As of today, ${orderAgeScope(age)}: ${formatInt(lines.length)} open AED lines, largest first.`;
  }
  return (
    <ChartCard title={title} description={description}>
      <div data-testid="open-lines-table">
        {!result.ok ? (
          <ErrorCard message={result.message} />
        ) : (
          <DataTable
            title={title}
            columns={LINE_COLUMNS}
            rows={result.data[0].map((line) => ({
              company: result.data[2].get(line.companyCode) ?? line.companyCode,
              orderNumber: line.orderNumber,
              orderDate: line.orderDate,
              customer: line.customer,
              customerHref: line.customerCode ? customerHref(line.customerCode, filters) : null,
              salesperson: line.salesperson,
              item: line.item,
              orderedQty: line.orderedQty,
              deliveredQty: line.deliveredQty,
              invoicedQty: line.invoicedQty,
              pendingValue: line.pendingValue,
              expectedDate: line.expectedDate,
              daysOverdue: line.daysOverdue,
            }))}
            initialSort={[{ id: "pendingValue", desc: true }]}
            showTotals
          />
        )}
      </div>
    </ChartCard>
  );
}
