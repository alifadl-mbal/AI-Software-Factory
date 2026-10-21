import type { Metadata } from "next";
import { Suspense } from "react";

import { PageHeader } from "@/components/dashboard/page-header";
import { ChartCardSkeleton, KpiRowSkeleton } from "@/components/dashboard/skeletons";
import { DASHBOARDS } from "@/lib/dashboards";
import { filtersToSearch, parseFilters, todayIso } from "@/lib/filters";
import { formatDate } from "@/lib/format";
import { orderAgeScope, parseOrderAge } from "@/lib/order-age";

import { SalesOrdersDrillDialogs } from "./charts";
import {
  BookedTrend,
  CurrencyNote,
  OrderAgeBar,
  OpenByAge,
  OpenByCustomer,
  OpenBySalesperson,
  OpenLinesTable,
  SALES_ORDER_KPI_GRID,
  SalesOrderKpis,
} from "./sections";

const dashboard = DASHBOARDS.find((entry) => entry.slug === "sales-orders")!;

export const metadata: Metadata = { title: dashboard.title };

export default async function SalesOrdersPage({ searchParams }: PageProps<"/sales-orders">) {
  const today = todayIso();
  const params = await searchParams;
  const filters = parseFilters(params, today);
  const age = parseOrderAge(params);
  // A new key per filter set, so each section shows its skeleton while the new figures stream in.
  // The open book only depends on the companies and the order age.
  const key = filtersToSearch(filters) || "default";
  const bookKey = `${today}|${filters.companies.join(",") || "all"}|${filters.salespeople.join(",")}|${filters.brands.join(",")}|${age}`;
  const scope = { filters, today, age };

  return (
    <>
      <PageHeader
        title={dashboard.title}
        description={dashboard.description}
        filters={filters}
        note={`The open book is as of today, ${formatDate(today)}, on ${orderAgeScope(age)}, and follows the company, salesperson and brand filters but not the period; orders booked follow the period as well.`}
      />
      <div className="flex flex-col gap-6">
        <Suspense
          key={`kpis${key}|${age}`}
          fallback={<KpiRowSkeleton count={8} grid={SALES_ORDER_KPI_GRID} />}
        >
          <SalesOrderKpis {...scope} />
        </Suspense>

        <OrderAgeBar {...scope} bookKey={bookKey} />

        <Suspense key={`currency${bookKey}`} fallback={null}>
          <CurrencyNote {...scope} />
        </Suspense>

        <div className="grid gap-6 lg:grid-cols-2">
          <Suspense key={`age${bookKey}`} fallback={<ChartCardSkeleton />}>
            <OpenByAge {...scope} />
          </Suspense>
          <Suspense key={`salesperson${bookKey}`} fallback={<ChartCardSkeleton />}>
            <OpenBySalesperson {...scope} />
          </Suspense>
        </div>

        <div className="grid gap-6 2xl:grid-cols-2">
          <Suspense key={`customers${bookKey}`} fallback={<ChartCardSkeleton height={420} />}>
            <OpenByCustomer {...scope} />
          </Suspense>
          <Suspense key={`trend${key}`} fallback={<ChartCardSkeleton height={300} />}>
            <BookedTrend filters={filters} />
          </Suspense>
        </div>

        <Suspense key={`lines${bookKey}`} fallback={<ChartCardSkeleton height={420} />}>
          <OpenLinesTable {...scope} />
        </Suspense>
      </div>
      <SalesOrdersDrillDialogs />
    </>
  );
}
