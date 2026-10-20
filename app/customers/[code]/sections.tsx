import "server-only";

import { AgingChart } from "@/components/dashboard/aging-chart";
import { ChartCard } from "@/components/dashboard/chart-card";
import { DataTable, type ColumnSpec } from "@/components/dashboard/data-table";
import { EmptyState } from "@/components/dashboard/empty-state";
import { ErrorCard } from "@/components/dashboard/error-card";
import { KpiCard } from "@/components/dashboard/kpi-card";
import { TrendChart } from "@/components/dashboard/trend-chart";
import { ReportAsOf } from "@/components/shell/shell-context";
import { AGING_BUCKETS } from "@/lib/aging";
import { previousYear, type Filters } from "@/lib/filters";
import { formatAed, formatInt, formatPct } from "@/lib/format";
import { itemHref } from "@/lib/items";
import { salesOrderCurrencyNote } from "@/lib/notes";
import { dataAsOf } from "@/lib/server/db";
import { load } from "@/lib/server/errors";
import {
  arBalances,
  arDocuments,
  arProfile,
  DOCUMENT_ROW_LIMIT,
  summarize,
} from "@/lib/server/queries/ar-ap";
import { companies as loadCompanies } from "@/lib/server/queries/common";
import { itemCodesByName } from "@/lib/server/queries/items";
import { openBookKpis, openByCurrency, openLines, OPEN_ROW_LIMIT } from "@/lib/server/queries/sales-orders";
import {
  RETURN_ROW_LIMIT,
  salesBreakdown,
  salesKpis,
  salesMonthly,
  salesReturns,
} from "@/lib/server/queries/sales";

/**
 * The customer page's sections. Period figures follow the filters; AR and the open order book are
 * as of `today` and follow only the companies, as on their dashboards. Every figure comes from the
 * dashboards' own queries narrowed to one customer code, so they agree with the dashboards' rows.
 */
export interface CustomerProps {
  code: string;
  filters: Filters;
  today: string;
}

/** Items in the top-items table; the rest are one "All other" row. */
export const TOP_ITEMS = 15;

const AS_OF_TODAY = "As of today; the company filter applies, the period doesn't";

function Total({ value }: { value: number }) {
  return <span className="tabular text-sm font-medium">{formatAed(value)}</span>;
}

/** An error in a KPI row spans the whole row rather than one card's cell. */
function RowError({ message }: { message: string }) {
  return (
    <div className="col-span-full">
      <ErrorCard message={message} />
    </div>
  );
}

async function companyNames(): Promise<Map<string, string>> {
  const list = await loadCompanies().catch(() => []);
  return new Map(list.map((company) => [company.code, company.name]));
}

/** Salesperson and credit limit, kept by Orion on the customer's AR lines. Nothing when unknown. */
export async function CustomerProfile({ code, filters, today }: CustomerProps) {
  const result = await load(() => arProfile(today, filters.companies, code));
  if (!result.ok) return null;
  const { salesperson, creditLimit } = result.data;
  const parts = [
    salesperson ? `Salesperson: ${salesperson}` : null,
    creditLimit
      ? `Credit limit: ${formatAed(creditLimit)}`
      : creditLimit === 0
        ? "No credit limit set"
        : null,
  ].filter(Boolean);
  if (parts.length === 0) return null;
  return (
    <p className="-mt-4 mb-6 text-xs text-muted-foreground md:-mt-6 md:mb-8" data-testid="customer-profile">
      {parts.join(" · ")}
    </p>
  );
}

/** Three cards: net revenue and margin % for the period, and the open order value as of today. */
export async function CustomerSalesKpis({ code, filters, today }: CustomerProps) {
  const result = await load(() =>
    Promise.all([
      salesKpis(filters, code),
      salesKpis(previousYear(filters), code),
      salesMonthly(filters, code),
      openBookKpis(filters.companies, today, code),
    ]),
  );
  if (!result.ok) return <RowError message={result.message} />;
  const [current, previous, months, book] = result.data;
  return (
    <>
      <ReportAsOf iso={dataAsOf().toISOString()} />
      <KpiCard
        label="Net revenue"
        value={current.netRevenue}
        previous={previous.netRevenue}
        spark={months.map((month) => month.netRevenue)}
        hint={current.returnsValue ? `After ${formatAed(current.returnsValue)} of returns` : undefined}
      />
      <KpiCard
        label="Gross margin %"
        value={current.marginPct}
        previous={previous.marginPct}
        format="pct"
        delta="pp"
        spark={months.map((month) => month.marginPct ?? 0)}
        hint={`${formatAed(current.grossMargin)} gross margin`}
      />
      <KpiCard
        label="Open order value"
        value={book.openValue}
        hint={`${formatInt(book.openAedLines)} open AED lines, as of today`}
      />
    </>
  );
}

/** Two cards: AR outstanding and the part over 90 days, as of today. AR is the slow view. */
export async function CustomerArKpis({ code, filters, today }: CustomerProps) {
  const result = await load(() => arBalances(today, filters.companies, "customer", code));
  if (!result.ok) return <RowError message={result.message} />;
  const ar = summarize(result.data);
  const lines = result.data.reduce((sum, row) => sum + row.lines, 0);
  return (
    <>
      <KpiCard
        label="AR outstanding"
        value={ar.balance}
        hint={
          lines === 0
            ? "Nothing open, as of today"
            : `${formatInt(lines)} open documents; net of ${formatAed(ar.pdc)} PDCs`
        }
      />
      <KpiCard
        label="AR over 90 days"
        value={ar.over90}
        hint={ar.over90Pct === null ? "No AR outstanding" : `${formatPct(ar.over90Pct)} of AR outstanding`}
      />
    </>
  );
}

export async function CustomerTrend({ code, filters }: CustomerProps) {
  const result = await load(() => salesMonthly(filters, code));
  const total = result.ok ? result.data.reduce((sum, month) => sum + month.netRevenue, 0) : 0;
  return (
    <ChartCard
      title="Monthly net revenue"
      description="This customer, this year against the same months last year"
      action={result.ok ? <Total value={total} /> : undefined}
    >
      {!result.ok ? (
        <ErrorCard message={result.message} />
      ) : result.data.every((month) => month.netRevenue === 0 && month.lastYearNetRevenue === 0) ? (
        <EmptyState
          title="No sales"
          message="This customer bought nothing in this period or the same period last year."
        />
      ) : (
        <TrendChart
          ariaLabel="Monthly net revenue of this customer, this year compared with last year"
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

const ITEM_COLUMNS: ColumnSpec[] = [
  { key: "label", header: "Item", linkKey: "href" },
  { key: "netRevenue", header: "Net revenue", format: "aed", sum: true },
  { key: "grossMargin", header: "Gross margin", format: "aed", sum: true },
  { key: "marginPct", header: "Margin %", format: "pct" },
];

export async function CustomerTopItems({ code, filters }: CustomerProps) {
  const title = "Top items bought";
  const result = await load(() => salesBreakdown(filters, "item", TOP_ITEMS, code));
  const total = result.ok ? result.data.reduce((sum, row) => sum + row.netRevenue, 0) : 0;
  // Grouped by name, as on the Sales page; a name links when one item code carries it.
  const codes = result.ok
    ? await itemCodesByName(result.data.map((row) => row.label)).catch(() => new Map<string, string>())
    : new Map<string, string>();
  return (
    <ChartCard
      title={title}
      description={`Top ${TOP_ITEMS} by net revenue in the period; the rest are grouped as “All other”`}
      action={result.ok && result.data.length > 0 ? <Total value={total} /> : undefined}
    >
      {!result.ok ? (
        <ErrorCard message={result.message} />
      ) : result.data.length === 0 ? (
        <EmptyState title="No sales" message="This customer bought nothing in this period." />
      ) : (
        <DataTable
          title={title}
          columns={ITEM_COLUMNS}
          rows={result.data.map((row) => ({
            label: row.label,
            href: codes.has(row.label) ? itemHref(codes.get(row.label)!, filters) : null,
            netRevenue: row.netRevenue,
            grossMargin: row.grossMargin,
            marginPct: row.marginPct,
          }))}
          showTotals
        />
      )}
    </ChartCard>
  );
}

const NO_AR = "This customer owes nothing for these companies.";

export async function CustomerArAging({ code, filters, today }: CustomerProps) {
  const title = "AR aging";
  const result = await load(() => arBalances(today, filters.companies, "customer", code));
  const summary = result.ok ? summarize(result.data) : null;
  return (
    <ChartCard
      title={title}
      description={`${AS_OF_TODAY}. Outstanding net of PDCs by document age; orange columns are 3 months old or more.`}
      action={summary && result.ok && result.data.length > 0 ? <Total value={summary.balance} /> : undefined}
    >
      {!result.ok ? (
        <ErrorCard message={result.message} />
      ) : result.data.length === 0 ? (
        <EmptyState title="Nothing outstanding" message={NO_AR} />
      ) : (
        <AgingChart
          values={summary!.buckets}
          label="Outstanding"
          ariaLabel={`${title}: ${AGING_BUCKETS.map((bucket, index) => `${bucket} ${formatAed(summary!.buckets[index])}`).join(", ")}`}
        />
      )}
    </ChartCard>
  );
}

const DOCUMENT_COLUMNS: ColumnSpec[] = [
  { key: "company", header: "Company" },
  { key: "document", header: "Document" },
  { key: "date", header: "Date", format: "date" },
  { key: "bucket", header: "Age" },
  { key: "currency", header: "Currency" },
  { key: "amount", header: "Amount (AED)", format: "aed" },
  { key: "pdc", header: "PDCs", format: "aed", sum: true },
  { key: "balance", header: "Outstanding", format: "aed", sum: true },
];

export async function CustomerArDocuments({ code, filters, today }: CustomerProps) {
  const title = "Open AR documents";
  const result = await load(() =>
    Promise.all([
      arDocuments(today, filters.companies, code),
      arBalances(today, filters.companies, "customer", code),
      companyNames(),
    ]),
  );
  let description = `${AS_OF_TODAY}. Largest outstanding first.`;
  if (result.ok) {
    const [documents, balances] = result.data;
    const open = balances.reduce((sum, row) => sum + row.lines, 0);
    description =
      open > documents.length
        ? `As of today: the ${formatInt(documents.length)} largest of ${formatInt(open)} open documents by outstanding amount (at most ${formatInt(DOCUMENT_ROW_LIMIT)} are listed).`
        : `As of today: ${formatInt(documents.length)} open documents, largest outstanding first. Credits are negative.`;
  }
  return (
    <ChartCard title={title} description={description}>
      <div data-testid="customer-ar-documents">
        {!result.ok ? (
          <ErrorCard message={result.message} />
        ) : result.data[0].length === 0 ? (
          <EmptyState title="Nothing outstanding" message={NO_AR} />
        ) : (
          <DataTable
            title={title}
            columns={DOCUMENT_COLUMNS}
            rows={result.data[0].map((document) => ({
              company: result.data[2].get(document.companyCode) ?? document.companyCode,
              document: document.document,
              date: document.date,
              bucket: AGING_BUCKETS[document.bucket] ?? null,
              currency: document.currency,
              amount: document.amount,
              pdc: document.pdc,
              balance: document.balance,
            }))}
            initialSort={[{ id: "balance", desc: true }]}
            showTotals
          />
        )}
      </div>
    </ChartCard>
  );
}

const ORDER_LINE_COLUMNS: ColumnSpec[] = [
  { key: "company", header: "Company" },
  { key: "orderNumber", header: "Order no" },
  { key: "orderDate", header: "Order date", format: "date" },
  { key: "item", header: "Item", linkKey: "itemHref" },
  { key: "orderedQty", header: "Ordered", format: "qty" },
  { key: "deliveredQty", header: "Delivered", format: "qty" },
  { key: "invoicedQty", header: "Invoiced", format: "qty" },
  { key: "pendingValue", header: "Pending value", format: "aed", sum: true },
  { key: "expectedDate", header: "Expected delivery", format: "date" },
  { key: "daysOverdue", header: "Days overdue", format: "int" },
];

export async function CustomerOpenOrders({ code, filters, today }: CustomerProps) {
  const title = "Open sales-order lines";
  const result = await load(() =>
    Promise.all([
      openLines(filters.companies, today, OPEN_ROW_LIMIT, code),
      openBookKpis(filters.companies, today, code),
      openByCurrency(filters.companies, today, code),
      companyNames(),
    ]),
  );
  let description = `${AS_OF_TODAY}. AED orders, as on the Sales orders page.`;
  if (result.ok) {
    const [lines, kpis] = result.data;
    description =
      kpis.openAedLines > lines.length
        ? `As of today: the ${formatInt(lines.length)} largest of ${formatInt(kpis.openAedLines)} open AED lines by pending value.`
        : `As of today: ${formatInt(lines.length)} open AED lines still to deliver, largest first.`;
  }
  const currencyNote = result.ok ? salesOrderCurrencyNote(result.data[2]) : null;
  return (
    <ChartCard
      title={title}
      description={description}
      action={result.ok && result.data[0].length > 0 ? <Total value={result.data[1].openValue} /> : undefined}
    >
      <div className="flex flex-col gap-3" data-testid="customer-open-orders">
        {!result.ok ? (
          <ErrorCard message={result.message} />
        ) : result.data[0].length === 0 ? (
          <EmptyState
            title="Nothing on order"
            message="This customer has no open AED order lines for these companies."
          />
        ) : (
          <DataTable
            title={title}
            columns={ORDER_LINE_COLUMNS}
            rows={result.data[0].map((line) => ({
              company: result.data[3].get(line.companyCode) ?? line.companyCode,
              orderNumber: line.orderNumber,
              orderDate: line.orderDate,
              item: line.item,
              itemHref: line.itemCode ? itemHref(line.itemCode, filters) : null,
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
        {currencyNote && <p className="text-xs text-muted-foreground">{currencyNote}</p>}
      </div>
    </ChartCard>
  );
}

const RETURN_COLUMNS: ColumnSpec[] = [
  { key: "date", header: "Date", format: "date" },
  { key: "company", header: "Company" },
  { key: "document", header: "Credit note" },
  { key: "item", header: "Item" },
  { key: "quantity", header: "Quantity", format: "qty", sum: true },
  { key: "value", header: "Value", format: "aed", sum: true },
];

export async function CustomerReturns({ code, filters }: CustomerProps) {
  const title = "Returns in the period";
  const result = await load(() =>
    Promise.all([salesReturns(filters, code), salesKpis(filters, code), companyNames()]),
  );
  let description = "Credit notes per item; already netted out of net revenue.";
  if (result.ok && result.data[0].length >= RETURN_ROW_LIMIT) {
    description = `The ${formatInt(RETURN_ROW_LIMIT)} largest return lines (at most ${formatInt(RETURN_ROW_LIMIT)} are listed); the total is all returns. Already netted out of net revenue.`;
  }
  return (
    <ChartCard
      title={title}
      description={description}
      action={
        result.ok && result.data[1].returnsValue ? <Total value={result.data[1].returnsValue} /> : undefined
      }
    >
      <div data-testid="customer-returns">
        {!result.ok ? (
          <ErrorCard message={result.message} />
        ) : result.data[0].length === 0 ? (
          <EmptyState title="No returns" message="This customer returned nothing in this period." />
        ) : (
          <DataTable
            title={title}
            columns={RETURN_COLUMNS}
            rows={result.data[0].map((line) => ({
              date: line.date,
              company: result.data[2].get(line.companyCode) ?? line.companyCode,
              document: line.document,
              item: line.item,
              quantity: line.quantity,
              value: line.value,
            }))}
            showTotals
          />
        )}
      </div>
    </ChartCard>
  );
}
