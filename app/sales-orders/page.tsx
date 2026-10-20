import type { Metadata } from "next";
import { Suspense } from "react";

import { PageHeader } from "@/components/dashboard/page-header";
import { ChartCardSkeleton, KpiRowSkeleton } from "@/components/dashboard/skeletons";
import { DASHBOARDS } from "@/lib/dashboards";
import { filtersToSearch, parseFilters, todayIso } from "@/lib/filters";
import { formatDate } from "@/lib/format";

import {
  BookedTrend,
  CurrencyNote,
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
  const filters = parseFilters(await searchParams, today);
  // A new key per filter set, so each section shows its skeleton while the new figures stream in.
  // The open book only depends on the companies.
  const key = filtersToSearch(filters) || "default";
  const bookKey = `${today}|${filters.companies.join(",") || "all"}`;

  return (
    <>
      <PageHeader
        title={dashboard.title}
        description={dashboard.description}
        filters={filters}
        note={`The open book is as of today, ${formatDate(today)}, and follows only the company filter; orders booked follow the period.`}
      />
      <div className="flex flex-col gap-6">
        <Suspense key={`kpis${key}`} fallback={<KpiRowSkeleton count={6} grid={SALES_ORDER_KPI_GRID} />}>
          <SalesOrderKpis filters={filters} today={today} />
        </Suspense>

        <Suspense key={`currency${bookKey}`} fallback={null}>
          <CurrencyNote filters={filters} today={today} />
        </Suspense>

        <div className="grid gap-6 lg:grid-cols-2">
          <Suspense key={`age${bookKey}`} fallback={<ChartCardSkeleton />}>
            <OpenByAge filters={filters} today={today} />
          </Suspense>
          <Suspense key={`salesperson${bookKey}`} fallback={<ChartCardSkeleton />}>
            <OpenBySalesperson filters={filters} today={today} />
          </Suspense>
        </div>

        <div className="grid gap-6 2xl:grid-cols-2">
          <Suspense key={`customers${bookKey}`} fallback={<ChartCardSkeleton height={420} />}>
            <OpenByCustomer filters={filters} today={today} />
          </Suspense>
          <Suspense key={`trend${key}`} fallback={<ChartCardSkeleton height={300} />}>
            <BookedTrend filters={filters} />
          </Suspense>
        </div>

        <Suspense key={`lines${bookKey}`} fallback={<ChartCardSkeleton height={420} />}>
          <OpenLinesTable filters={filters} today={today} />
        </Suspense>
      </div>
    </>
  );
}
