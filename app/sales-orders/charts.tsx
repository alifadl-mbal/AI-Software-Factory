"use client";

import { useSearchParams } from "next/navigation";
import { useState } from "react";

import { AgingChart, type AgingPoint } from "@/components/dashboard/aging-chart";
import { DataTable, type ColumnSpec, type TableRowData } from "@/components/dashboard/data-table";
import { DocumentDrill, useDocumentDrill } from "@/components/dashboard/document-drill";
import { drillApiUrl, DrillTotals } from "@/components/dashboard/drill-dialog";
import {
  HoverBreakdown,
  HoverSheet,
  hoverUrl,
  neighbours,
  type HoverSelection,
  type HoverText,
  type HoverView,
} from "@/components/dashboard/hover-breakdown";
import { barPeriod, TrendChart, type TrendBar, type TrendPoint } from "@/components/dashboard/trend-chart";
import { useShell } from "@/components/shell/shell-context";
import { useIsMobile } from "@/hooks/use-mobile";
import { customerHref } from "@/lib/customers";
import { filtersToSearch, type Filters } from "@/lib/filters";
import { formatAed, formatInt } from "@/lib/format";
import { itemHref } from "@/lib/items";
import { ORDER_AGE_PARAM, orderAgeScope, parseOrderAge, type OrderAge } from "@/lib/order-age";
import { bucketTitle, periodBuckets } from "@/lib/periods";
import { DOC_PARAM, docParam, DRILL_PARAM, drillRange, drillTitle } from "@/lib/sales-drill";
import { BUCKET_PARAM, bucketLabel, parseBucket } from "@/lib/sales-orders-drill";
import type {
  AgeHover,
  BookedHover,
  OrderDimension,
  OrderLine,
  OrderList,
} from "@/lib/server/queries/sales-orders";

/**
 * The Sales orders charts with the hover breakdown and the drill-downs, as on Sales. The booked
 * trend's card breaks a month down by company, salesperson and brand, and selecting a bar lists
 * the month's orders. The order-age chart's card breaks a column down by company and salesperson,
 * and selecting a column lists its open orders. On phones a tap opens the card as a bottom sheet,
 * whose button opens the list.
 */

const BREAKDOWN_PATH = "/api/sales-orders/breakdown";

const TITLES: Record<OrderDimension, string> = {
  company: "By company",
  salesperson: "By salesperson",
  brand: "By brand",
};

const BOOKED_TEXT: HoverText = { totalLabel: "Booked (AED)", emptyText: "No orders booked in this period." };
const AGE_TEXT: HoverText = { totalLabel: "Open value (AED)", emptyText: "Nothing open.", compare: false };

function sections(breakdowns: BookedHover["breakdowns"]): HoverView["sections"] {
  return breakdowns.map((breakdown) => ({
    id: breakdown.dimension,
    title: TITLES[breakdown.dimension],
    rows: breakdown.rows,
    share: true,
  }));
}

function bookedView(data: BookedHover): HoverView {
  return { total: data.value, lastYear: data.lastYearValue, sections: sections(data.breakdowns) };
}

function ageView(data: AgeHover): HoverView {
  return { total: data.value, sections: sections(data.breakdowns) };
}

/** The order-age choice in the URL (`?since=`), which the open-book routes follow. */
function useOrderAge(): OrderAge {
  return parseOrderAge(useSearchParams());
}

export function BookedTrendChart({ data, start, end }: { data: TrendPoint[]; start: string; end: string }) {
  const { filters } = useShell();
  const search = filtersToSearch(filters);
  const isMobile = useIsMobile();
  const { open } = useDocumentDrill(DRILL_PARAM, DOC_PARAM);
  const [selected, setSelected] = useState<HoverSelection | null>(null);
  const urlFor = (period: string) => hoverUrl(BREAKDOWN_PATH, search, { period });
  const keys = periodBuckets(start, end).map((bucket) => bucket.key);

  return (
    <>
      <TrendChart
        data={data}
        period={{ start, end }}
        ariaLabel="Monthly orders booked, this year compared with last year. Select a month's bar to list its orders."
        selectHint="List its orders"
        renderTooltip={
          isMobile
            ? undefined
            : (bar) => (
                <HoverBreakdown
                  url={urlFor(bar.month)}
                  title={bucketTitle(bar.bucket)}
                  toView={bookedView}
                  text={BOOKED_TEXT}
                  current={bar.thisYear}
                  lastYear={bar.lastYear}
                  prefetch={neighbours(keys, bar.month).map(urlFor)}
                />
              )
        }
        onSelect={
          isMobile
            ? (bar: TrendBar) =>
                setSelected({
                  url: urlFor(bar.month),
                  title: bucketTitle(bar.bucket),
                  description: "Orders booked by company, salesperson and brand",
                  current: bar.thisYear,
                  lastYear: bar.lastYear,
                  drill: bar.thisYear ? barPeriod(bar) : undefined,
                })
            : undefined
        }
        onSelectMonth={isMobile ? undefined : open}
      />
      <HoverSheet
        selected={selected}
        onClose={() => setSelected(null)}
        toView={bookedView}
        text={BOOKED_TEXT}
        onDrill={open}
        drillLabel="List its orders"
      />
    </>
  );
}

export function OpenByAgeChart({ values, ariaLabel }: { values: number[]; ariaLabel: string }) {
  const { filters } = useShell();
  const age = useOrderAge();
  const search = filtersToSearch(filters);
  const isMobile = useIsMobile();
  const { open } = useDocumentDrill(BUCKET_PARAM, DOC_PARAM);
  const [selected, setSelected] = useState<HoverSelection | null>(null);
  const urlFor = (index: number) =>
    hoverUrl(BREAKDOWN_PATH, search, { [BUCKET_PARAM]: String(index), [ORDER_AGE_PARAM]: age });
  const keys = values.map((_, index) => String(index + 1));
  const title = (point: AgingPoint) => `Orders ${point.bucket} old`;

  return (
    <>
      <AgingChart
        values={values}
        label="Open value"
        ariaLabel={`${ariaLabel}. Select a column to list its orders.`}
        renderTooltip={
          isMobile
            ? undefined
            : (point) => (
                <HoverBreakdown
                  url={urlFor(point.index)}
                  title={title(point)}
                  toView={ageView}
                  text={AGE_TEXT}
                  current={point.value}
                  prefetch={neighbours(keys, String(point.index)).map((key) => urlFor(Number(key)))}
                />
              )
        }
        onSelect={
          isMobile
            ? (point) =>
                setSelected({
                  url: urlFor(point.index),
                  title: title(point),
                  description: "Open value by company and salesperson",
                  current: point.value,
                  drill: point.value ? String(point.index) : undefined,
                })
            : undefined
        }
        onSelectBucket={isMobile ? undefined : open}
      />
      <HoverSheet
        selected={selected}
        onClose={() => setSelected(null)}
        toView={ageView}
        text={AGE_TEXT}
        onDrill={open}
        drillLabel="List its orders"
      />
    </>
  );
}

const ORDER_COLUMNS: ColumnSpec[] = [
  { key: "date", header: "Order date", format: "date" },
  { key: "company", header: "Company" },
  { key: "order", header: "Order", action: true },
  { key: "customer", header: "Customer", linkKey: "customerHref" },
  { key: "salesperson", header: "Salesperson" },
  { key: "currency", header: "Currency" },
  { key: "lines", header: "Lines", format: "int", sum: true },
  { key: "value", header: "Value (AED)", format: "aed", sum: true },
];

function lineColumns(valueHeader: string): ColumnSpec[] {
  return [
    { key: "item", header: "Item", linkKey: "itemHref" },
    { key: "itemCode", header: "Code" },
    { key: "orderedQty", header: "Ordered", format: "qty", sum: true },
    { key: "deliveredQty", header: "Delivered", format: "qty", sum: true },
    { key: "invoicedQty", header: "Invoiced", format: "qty", sum: true },
    { key: "currency", header: "Currency" },
    { key: "value", header: valueHeader, format: "aed", sum: true },
  ];
}

function OrdersTable({
  data,
  filters,
  valueLabel,
  open,
}: {
  data: OrderList;
  filters: Filters;
  valueLabel: string;
  open: (doc: string, heading: string) => void;
}) {
  const { orders, total, totals, limit } = data;
  const byId = new Map(orders.map((order) => [docParam(order), order]));
  return (
    <div className="flex flex-col gap-3" data-testid="drill-documents">
      <DrillTotals
        items={[
          { label: valueLabel, value: formatAed(totals.value) },
          { label: "Orders", value: formatInt(totals.orders) },
        ]}
      />
      {total > orders.length && (
        <p
          className="rounded-md bg-muted px-3 py-2 text-xs text-muted-foreground"
          data-testid="drill-cap-note"
        >
          Showing the largest {formatInt(limit)} of {formatInt(total)} orders. The totals cover all of them.
        </p>
      )}
      <DataTable
        title="Orders"
        columns={ORDER_COLUMNS}
        rows={orders.map((order) => ({
          id: docParam(order),
          date: order.date,
          company: order.company,
          order: `${order.txnCode}-${order.no}`,
          customer: order.customer,
          customerHref: order.customerCode ? customerHref(order.customerCode, filters) : null,
          salesperson: order.salesperson,
          currency: order.currency,
          lines: order.lineCount,
          value: order.value,
        }))}
        showTotals
        totals={{ value: totals.value }}
        onAction={(row: TableRowData) => {
          const order = byId.get(String(row.id));
          if (order) {
            open(
              docParam(order),
              `Order ${order.txnCode}-${order.no} · company ${order.company} · ${order.customer}`,
            );
          }
        }}
        pageSize={25}
        maxHeight={9999}
      />
    </div>
  );
}

function LinesTable({
  lines,
  filters,
  valueLabel,
}: {
  lines: OrderLine[];
  filters: Filters;
  valueLabel: string;
}) {
  const value = lines.reduce((sum, line) => sum + line.value, 0);
  return (
    <>
      <DrillTotals
        items={[
          { label: valueLabel, value: formatAed(value) },
          { label: "Lines", value: formatInt(lines.length) },
        ]}
      />
      <DataTable
        title="Order lines"
        columns={lineColumns(`${valueLabel} (AED)`)}
        rows={lines.map((line) => ({
          item: line.item,
          itemHref: line.itemCode ? itemHref(line.itemCode, filters) : null,
          itemCode: line.itemCode,
          orderedQty: line.orderedQty,
          deliveredQty: line.deliveredQty,
          invoicedQty: line.invoicedQty,
          currency: line.currency,
          value: line.value,
        }))}
        showTotals
        pageSize={50}
        maxHeight={9999}
      />
    </>
  );
}

function companiesText(filters: Filters): string {
  return filters.companies.length > 0 ? `company ${filters.companies.join(", ")}` : "all companies";
}

/**
 * The two Sales orders drill-downs: a month of the booked trend (`?drill=`) and a column of the
 * order-age chart (`?bucket=`), each → its orders → one order's lines (`&doc=`).
 */
export function SalesOrdersDrillDialogs() {
  const { filters } = useShell();
  const age = useOrderAge();

  return (
    <>
      <DocumentDrill<OrderList, OrderLine[]>
        param={DRILL_PARAM}
        docParam={DOC_PARAM}
        testId="booked-drill"
        title={(drill) => {
          const range = drillRange(drill, filters);
          return range ? `Orders booked · ${drillTitle(drill, range)}` : null;
        }}
        description={`Orders by order date, ${companiesText(filters)}. AED value, net of cancelled quantities; other currencies show as 0.`}
        documentsUrl={(drill) => drillApiUrl("/api/sales-orders/orders", filters, { [DRILL_PARAM]: drill })}
        linesUrl={(drill, doc) =>
          drillApiUrl("/api/sales-orders/order-lines", filters, { [DRILL_PARAM]: drill, [DOC_PARAM]: doc })
        }
        documentsWhat="orders"
        backLabel="Back to orders"
        renderDocuments={(data, open) => (
          <OrdersTable data={data} filters={filters} valueLabel="Booked" open={open} />
        )}
        renderLines={(lines) => <LinesTable lines={lines} filters={filters} valueLabel="Booked" />}
      />
      <DocumentDrill<OrderList, OrderLine[]>
        param={BUCKET_PARAM}
        docParam={DOC_PARAM}
        testId="order-age-drill"
        title={(value) => {
          const bucket = parseBucket(value);
          return bucket === null ? null : `Open orders · ${bucketLabel(bucket)} old`;
        }}
        description={`As of today, AED ${orderAgeScope(age)}, ${companiesText(filters)}: open value still to deliver.`}
        documentsUrl={(value) =>
          drillApiUrl("/api/sales-orders/orders", filters, { [BUCKET_PARAM]: value, [ORDER_AGE_PARAM]: age })
        }
        linesUrl={(value, doc) =>
          drillApiUrl("/api/sales-orders/order-lines", filters, {
            [BUCKET_PARAM]: value,
            [DOC_PARAM]: doc,
            [ORDER_AGE_PARAM]: age,
          })
        }
        documentsWhat="orders"
        backLabel="Back to orders"
        renderDocuments={(data, open) => (
          <OrdersTable data={data} filters={filters} valueLabel="Open value" open={open} />
        )}
        renderLines={(lines) => <LinesTable lines={lines} filters={filters} valueLabel="Open value" />}
      />
    </>
  );
}
