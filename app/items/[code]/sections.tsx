import "server-only";

import { AlertTriangle } from "lucide-react";

import { ChartCard } from "@/components/dashboard/chart-card";
import { DataTable, type ColumnSpec } from "@/components/dashboard/data-table";
import { EmptyState } from "@/components/dashboard/empty-state";
import { ErrorCard } from "@/components/dashboard/error-card";
import { KpiCard } from "@/components/dashboard/kpi-card";
import { MonthEndChart } from "@/components/dashboard/month-end-chart";
import { TrendChart } from "@/components/dashboard/trend-chart";
import { ReportAsOf } from "@/components/shell/shell-context";
import { Badge } from "@/components/ui/badge";
import { customerHref } from "@/lib/customers";
import { previousYear, type Filters } from "@/lib/filters";
import { formatAed, formatInt, formatMonth, formatQty } from "@/lib/format";
import { COVER_MONTHS } from "@/lib/items";
import { orderAgeScope, type OrderAge } from "@/lib/order-age";
import { dataAsOf } from "@/lib/server/db";
import { load } from "@/lib/server/errors";
import { companies as loadCompanies } from "@/lib/server/queries/common";
import { customerCodesByName } from "@/lib/server/queries/customers";
import { monthEndTrend, reorderAlerts, stockByLocation, TREND_PERIODS } from "@/lib/server/queries/inventory";
import { itemCover, planningDiffers, type Item, type ItemCompany } from "@/lib/server/queries/items";
import { lastClosed } from "@/lib/server/overview";
import { itemPending, PO_LEAD_DAYS } from "@/lib/server/queries/purchasing";
import { itemOpenBook } from "@/lib/server/queries/sales-orders";
import { salesBreakdown, salesKpis, salesMonthly } from "@/lib/server/queries/sales";

/**
 * The item page's sections. Sales follow the filters; stock, POs and open orders are as of `today`
 * and follow only the companies, as on their dashboards. Every figure comes from the dashboards'
 * own queries narrowed to one item code, so they agree with the dashboards' rows. Pending POs and
 * open orders follow the order-age choice (`?since=`), as on Purchasing and Sales orders.
 */
export interface ItemProps {
  code: string;
  filters: Filters;
  today: string;
  age: OrderAge;
}

/** Customers in the top-customers table; the rest are one "All other" row. */
export const TOP_CUSTOMERS = 15;

const AS_OF_TODAY = "As of today; the company filter applies, the period doesn't";

function Total({ children }: { children: React.ReactNode }) {
  return <span className="tabular text-sm font-medium">{children}</span>;
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

// ---------------------------------------------------------------------------------------------
// Header

function planningText(company: ItemCompany): string {
  const parts = [
    company.minStock !== null ? `Min ${formatQty(company.minStock)}` : null,
    company.maxStock !== null ? `max ${formatQty(company.maxStock)}` : null,
    company.reorderLevel !== null ? `reorder at ${formatQty(company.reorderLevel)}` : null,
    company.reorderQty !== null ? `reorder qty ${formatQty(company.reorderQty)}` : null,
    company.leadTimeDays !== null ? `lead time ${formatInt(company.leadTimeDays)} days` : null,
  ].filter(Boolean);
  return parts.length > 0 ? parts.join(" · ") : "No reorder planning set";
}

/**
 * Reorder planning from the item master (min, max, reorder level and quantity, lead time), once if
 * every company's row agrees or per company if not, and the frozen flag where it differs.
 */
export async function ItemPlanning({ item }: { item: Item }) {
  const names = await companyNames();
  const perCompany = item.companies.length > 1 && planningDiffers(item.companies);
  return (
    <div className="flex flex-col gap-1 text-xs text-muted-foreground" data-testid="item-planning">
      {perCompany ? (
        <ul className="flex flex-col gap-0.5">
          {item.companies.map((company) => (
            <li key={company.companyCode}>
              <span className="font-medium text-foreground">
                {names.get(company.companyCode) ?? company.companyCode}:
              </span>{" "}
              {planningText(company)}
              {company.frozen ? " · frozen" : ""}
            </li>
          ))}
        </ul>
      ) : (
        <p>Reorder planning: {planningText(item.companies[0])}</p>
      )}
    </div>
  );
}

/**
 * "At or below reorder level" when available stock at any company × location is at or below the
 * item's reorder level: exactly the rows the item has among Inventory's reorder alerts.
 */
export async function ReorderBadge({ code, filters }: ItemProps) {
  const result = await load(() => reorderAlerts(filters.companies, code));
  if (!result.ok || result.data.length === 0) return null;
  const where = result.data.map((alert) => `${alert.location} (${alert.company})`).join(", ");
  return (
    <Badge
      variant="outline"
      className="h-auto max-w-full gap-1 border-negative/40 bg-negative/10 py-1 whitespace-normal text-foreground"
      data-testid="reorder-badge"
      title={`Available at or below the reorder level at ${where}`}
    >
      <AlertTriangle className="text-negative" aria-hidden />
      At or below reorder level at {formatInt(result.data.length)}{" "}
      {result.data.length === 1 ? "location" : "locations"}
    </Badge>
  );
}

// ---------------------------------------------------------------------------------------------
// KPIs

/** Five cards for the period: units, revenue, margin, average monthly units and months of cover. */
export async function ItemSalesKpis(props: ItemProps) {
  const { code, filters } = props;
  const scope = { item: code };
  const result = await load(() =>
    Promise.all([
      salesKpis(filters, scope),
      salesKpis(previousYear(filters), scope),
      salesMonthly(filters, scope),
      itemCover(filters.companies, props.today, code),
    ]),
  );
  if (!result.ok) return <RowError message={result.message} />;
  const [current, previous, months, coverage] = result.data;
  return (
    <>
      <ReportAsOf iso={dataAsOf().toISOString()} />
      <KpiCard
        label="Units sold"
        value={current.quantity}
        previous={previous.quantity}
        format="qty"
        spark={months.map((month) => month.quantity)}
        hint="Net of returns, in the period"
      />
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
        label="Avg monthly units"
        value={coverage.averageMonthly}
        format="qty"
        hint={`Units sold in the last ${COVER_MONTHS} months ÷ ${COVER_MONTHS}`}
      />
      <KpiCard
        label="Months of cover"
        value={coverage.months === null ? null : Math.round(coverage.months * 10) / 10}
        format="qty"
        valueText={coverage.months === null ? "No recent sales" : undefined}
        hint={
          coverage.months === null
            ? `Nothing sold in the last ${COVER_MONTHS} months; ${formatQty(coverage.available)} available`
            : `${formatQty(coverage.available)} available ÷ ${formatQty(coverage.averageMonthly)} a month`
        }
      />
    </>
  );
}

/** Five cards as of today: stock on hand, available, reserved, on order, still to deliver. */
export async function ItemStockKpis({ code, filters, today, age }: ItemProps) {
  const result = await load(() =>
    Promise.all([
      stockByLocation(filters.companies, code),
      itemPending(filters.companies, today, age, code),
      itemOpenBook(filters.companies, today, age, code),
    ]),
  );
  if (!result.ok) return <RowError message={result.message} />;
  const [stock, pending, book] = result.data;
  const sum = (key: "qty" | "availableQty" | "reservedQty" | "value" | "availableValue" | "reservedValue") =>
    stock.reduce((total, row) => total + row[key], 0);
  return (
    <>
      <KpiCard
        label="Stock on hand"
        value={sum("qty")}
        format="qty"
        hint={`${formatAed(sum("value"))} at WAC`}
      />
      <KpiCard
        label="Available"
        value={sum("availableQty")}
        format="qty"
        hint={`${formatAed(sum("availableValue"))}; on hand less reserved`}
      />
      <KpiCard
        label="Reserved"
        value={sum("reservedQty")}
        format="qty"
        hint={formatAed(sum("reservedValue"))}
      />
      <KpiCard
        label="On order (POs)"
        value={pending.pendingQty}
        format="qty"
        hint={
          pending.lines === 0
            ? `No pending PO lines, ${orderAgeScope(age)}`
            : `${formatInt(pending.lines)} pending ${pending.lines === 1 ? "line" : "lines"}, ${formatAed(pending.pendingValue)}`
        }
      />
      <KpiCard
        label="Customer orders to deliver"
        value={book.pendingQty}
        format="qty"
        hint={
          book.lines === 0
            ? "No open order lines"
            : `${formatInt(book.lines)} open ${book.lines === 1 ? "line" : "lines"}, any currency`
        }
      />
    </>
  );
}

// ---------------------------------------------------------------------------------------------
// Sections

const NO_SALES = "This item sold nothing in this period or the same period last year.";

export async function ItemTrend({ code, filters }: ItemProps) {
  const result = await load(() => salesMonthly(filters, { item: code }));
  const empty =
    result.ok &&
    result.data.every(
      (month) =>
        month.quantity === 0 &&
        month.lastYearQuantity === 0 &&
        month.netRevenue === 0 &&
        month.lastYearNetRevenue === 0,
    );
  const totalQty = result.ok ? result.data.reduce((sum, month) => sum + month.quantity, 0) : 0;
  const totalRevenue = result.ok ? result.data.reduce((sum, month) => sum + month.netRevenue, 0) : 0;
  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <ChartCard
        title="Monthly units sold"
        description="This item, net of returns, this year against the same months last year"
        action={result.ok ? <Total>{formatQty(totalQty)}</Total> : undefined}
      >
        {!result.ok ? (
          <ErrorCard message={result.message} />
        ) : empty ? (
          <EmptyState title="No sales" message={NO_SALES} />
        ) : (
          <TrendChart
            format="qty"
            ariaLabel="Monthly units sold of this item, this year compared with last year"
            data={result.data.map((month) => ({
              month: month.month,
              thisYear: month.quantity,
              lastYear: month.lastYearQuantity,
            }))}
          />
        )}
      </ChartCard>
      <ChartCard
        title="Monthly net revenue"
        description="This item, this year against the same months last year"
        action={result.ok ? <Total>{formatAed(totalRevenue)}</Total> : undefined}
      >
        {!result.ok ? (
          <ErrorCard message={result.message} />
        ) : empty ? (
          <EmptyState title="No sales" message={NO_SALES} />
        ) : (
          <TrendChart
            ariaLabel="Monthly net revenue of this item, this year compared with last year"
            data={result.data.map((month) => ({
              month: month.month,
              thisYear: month.netRevenue,
              lastYear: month.lastYearNetRevenue,
            }))}
          />
        )}
      </ChartCard>
    </div>
  );
}

const STOCK_COLUMNS: ColumnSpec[] = [
  { key: "company", header: "Company" },
  { key: "location", header: "Location" },
  { key: "qty", header: "On hand", format: "qty", sum: true },
  { key: "availableQty", header: "Available", format: "qty", sum: true },
  { key: "reservedQty", header: "Reserved", format: "qty", sum: true },
  { key: "value", header: "Value", format: "aed", sum: true },
];

export async function ItemStock({ code, filters }: ItemProps) {
  const title = "Stock by company and location";
  const result = await load(() => stockByLocation(filters.companies, code));
  const total = result.ok ? result.data.reduce((sum, row) => sum + row.value, 0) : 0;
  return (
    <ChartCard
      title={title}
      description={`${AS_OF_TODAY}. Grades added together; value at WAC.`}
      action={result.ok && result.data.length > 0 ? <Total>{formatAed(total)}</Total> : undefined}
    >
      <div data-testid="item-stock">
        {!result.ok ? (
          <ErrorCard message={result.message} />
        ) : result.data.length === 0 ? (
          <EmptyState title="No stock" message="This item isn't held at any location of these companies." />
        ) : (
          <DataTable
            title={title}
            columns={STOCK_COLUMNS}
            rows={result.data.map((row) => ({
              company: row.company,
              location: row.location,
              qty: row.qty,
              availableQty: row.availableQty,
              reservedQty: row.reservedQty,
              value: row.value,
            }))}
            showTotals
          />
        )}
      </div>
    </ChartCard>
  );
}

export async function ItemMonthEnd({ code, filters, today }: ItemProps) {
  const result = await load(() => monthEndTrend(filters.companies, today, TREND_PERIODS, code));
  const current = today.slice(0, 7);
  const closed = result.ok ? lastClosed(result.data, today) : undefined;
  return (
    <ChartCard
      title="Month-end stock"
      description={`Closing value of this item for the last ${TREND_PERIODS} month-ends; ${formatMonth(current)} is provisional and still changing`}
      action={
        closed ? (
          <span
            className="tabular text-sm font-medium"
            title={`${formatMonth(closed.month)} close: ${formatQty(closed.closeQty)} units`}
          >
            {formatAed(closed.closeValue)}
          </span>
        ) : undefined
      }
    >
      {!result.ok ? (
        <ErrorCard message={result.message} />
      ) : result.data.every((month) => month.closeValue === 0 && month.closeQty === 0) ? (
        <EmptyState title="No month-end stock" message="This item held no stock at these month-ends." />
      ) : (
        <MonthEndChart
          data={result.data.map((month) => ({
            month: month.month,
            value: month.closeValue,
            provisional: month.month >= current,
          }))}
          ariaLabel={`Month-end stock value of this item from ${formatMonth(result.data[0].month)} to ${formatMonth(
            result.data[result.data.length - 1].month,
          )}`}
        />
      )}
    </ChartCard>
  );
}

const PO_COLUMNS: ColumnSpec[] = [
  { key: "company", header: "Company" },
  { key: "poNumber", header: "PO number" },
  { key: "supplier", header: "Supplier" },
  { key: "poDate", header: "PO date", format: "date" },
  { key: "expectedDate", header: "Expected", format: "date" },
  { key: "daysOverdue", header: "Days overdue", format: "int" },
  { key: "pendingQty", header: "Pending qty", format: "qty", sum: true },
  { key: "pendingValue", header: "Pending value", format: "aed", sum: true },
];

export async function ItemPurchaseOrders({ code, filters, today, age }: ItemProps) {
  const title = "Pending PO lines";
  const result = await load(() =>
    Promise.all([itemPending(filters.companies, today, age, code), companyNames()]),
  );
  let description = `${AS_OF_TODAY}; ${orderAgeScope(age)}. Expected = PO date + ${PO_LEAD_DAYS} days, as on Purchasing.`;
  if (result.ok && result.data[0].lines > result.data[0].rows.length) {
    description = `As of today, ${orderAgeScope(age)}: the ${formatInt(result.data[0].rows.length)} largest of ${formatInt(result.data[0].lines)} pending lines by quantity. Expected = PO date + ${PO_LEAD_DAYS} days.`;
  }
  return (
    <ChartCard
      title={title}
      description={description}
      action={
        result.ok && result.data[0].lines > 0 ? (
          <Total>{formatQty(result.data[0].pendingQty)} units</Total>
        ) : undefined
      }
    >
      <div data-testid="item-purchase-orders">
        {!result.ok ? (
          <ErrorCard message={result.message} />
        ) : result.data[0].rows.length === 0 ? (
          <EmptyState
            title="Nothing on order"
            message="No pending PO lines for this item in these companies."
          />
        ) : (
          <DataTable
            title={title}
            columns={PO_COLUMNS}
            rows={result.data[0].rows.map((line) => ({
              company: result.data[1].get(line.companyCode) ?? line.companyCode,
              poNumber: line.poNumber,
              supplier: line.supplier,
              poDate: line.poDate,
              expectedDate: line.expectedDate,
              daysOverdue: line.daysOverdue,
              pendingQty: line.pendingQty,
              pendingValue: line.pendingValue,
            }))}
            initialSort={[{ id: "expectedDate", desc: false }]}
            showTotals={result.data[0].lines === result.data[0].rows.length}
          />
        )}
      </div>
    </ChartCard>
  );
}

const ORDER_COLUMNS: ColumnSpec[] = [
  { key: "company", header: "Company" },
  { key: "orderNumber", header: "Order no" },
  { key: "orderDate", header: "Order date", format: "date" },
  { key: "customer", header: "Customer", linkKey: "customerHref" },
  { key: "orderedQty", header: "Ordered", format: "qty" },
  { key: "deliveredQty", header: "Delivered", format: "qty" },
  { key: "pendingQty", header: "To deliver", format: "qty", sum: true },
  { key: "currency", header: "Currency" },
  { key: "pendingValue", header: "Pending value", format: "qty" },
  { key: "expectedDate", header: "Expected delivery", format: "date" },
  { key: "daysOverdue", header: "Days overdue", format: "int" },
];

export async function ItemOpenOrders({ code, filters, today, age }: ItemProps) {
  const title = "Open sales-order lines";
  const result = await load(() =>
    Promise.all([itemOpenBook(filters.companies, today, age, code), companyNames()]),
  );
  let description = `${AS_OF_TODAY}; ${orderAgeScope(age)}. Lines still to deliver in any currency; values are in the order's currency.`;
  if (result.ok && result.data[0].lines > result.data[0].rows.length) {
    description = `As of today, ${orderAgeScope(age)}: the ${formatInt(result.data[0].rows.length)} largest of ${formatInt(result.data[0].lines)} open lines by quantity to deliver. Values are in the order's currency.`;
  }
  return (
    <ChartCard
      title={title}
      description={description}
      action={
        result.ok && result.data[0].lines > 0 ? (
          <Total>{formatQty(result.data[0].pendingQty)} units</Total>
        ) : undefined
      }
    >
      <div data-testid="item-open-orders">
        {!result.ok ? (
          <ErrorCard message={result.message} />
        ) : result.data[0].rows.length === 0 ? (
          <EmptyState
            title="Nothing to deliver"
            message="No open order lines for this item in these companies."
          />
        ) : (
          <DataTable
            title={title}
            columns={ORDER_COLUMNS}
            rows={result.data[0].rows.map((line) => ({
              company: result.data[1].get(line.companyCode) ?? line.companyCode,
              orderNumber: line.orderNumber,
              orderDate: line.orderDate,
              customer: line.customer,
              customerHref: line.customerCode ? customerHref(line.customerCode, filters) : null,
              orderedQty: line.orderedQty,
              deliveredQty: line.deliveredQty,
              pendingQty: line.pendingQty,
              currency: line.currency,
              pendingValue: line.pendingValue,
              expectedDate: line.expectedDate,
              daysOverdue: line.daysOverdue,
            }))}
            showTotals={result.data[0].lines === result.data[0].rows.length}
          />
        )}
      </div>
    </ChartCard>
  );
}

const CUSTOMER_COLUMNS: ColumnSpec[] = [
  { key: "label", header: "Customer", linkKey: "href" },
  { key: "quantity", header: "Units", format: "qty", sum: true },
  { key: "netRevenue", header: "Net revenue", format: "aed", sum: true },
  { key: "grossMargin", header: "Gross margin", format: "aed", sum: true },
  { key: "marginPct", header: "Margin %", format: "pct" },
];

export async function ItemTopCustomers({ code, filters }: ItemProps) {
  const title = "Top customers";
  const result = await load(() => salesBreakdown(filters, "customer", TOP_CUSTOMERS, { item: code }));
  const total = result.ok ? result.data.reduce((sum, row) => sum + row.netRevenue, 0) : 0;
  // Grouped by name, as on the Sales page; a name links when one customer code carries it.
  const codes = result.ok
    ? await customerCodesByName(result.data.map((row) => row.label)).catch(() => new Map<string, string>())
    : new Map<string, string>();
  return (
    <ChartCard
      title={title}
      description={`Who bought this item in the period: top ${TOP_CUSTOMERS} by net revenue; the rest are grouped as “All other”`}
      action={result.ok && result.data.length > 0 ? <Total>{formatAed(total)}</Total> : undefined}
    >
      <div data-testid="item-top-customers">
        {!result.ok ? (
          <ErrorCard message={result.message} />
        ) : result.data.length === 0 ? (
          <EmptyState title="No sales" message="Nobody bought this item in this period." />
        ) : (
          <DataTable
            title={`${title} for this item`}
            columns={CUSTOMER_COLUMNS}
            rows={result.data.map((row) => ({
              label: row.label,
              href: codes.has(row.label) ? customerHref(codes.get(row.label)!, filters) : null,
              quantity: row.quantity,
              netRevenue: row.netRevenue,
              grossMargin: row.grossMargin,
              marginPct: row.marginPct,
            }))}
            showTotals
          />
        )}
      </div>
    </ChartCard>
  );
}
