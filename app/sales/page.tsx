import type { Metadata } from "next";
import { Suspense } from "react";

import { PageHeader } from "@/components/dashboard/page-header";
import { ChartCardSkeleton, KpiRowSkeleton } from "@/components/dashboard/skeletons";
import { DASHBOARDS } from "@/lib/dashboards";
import { filtersToSearch, parseFilters, todayIso } from "@/lib/filters";

import { SalesDrillDialog } from "./sales-drill";
import {
  SALES_KPI_GRID,
  SalesBreakdownChart,
  SalesCalendar,
  SalesKpis,
  SalesTopTable,
  SalesTrend,
} from "./sections";

const dashboard = DASHBOARDS.find((entry) => entry.slug === "sales")!;

export const metadata: Metadata = { title: dashboard.title };

export default async function SalesPage({ searchParams }: PageProps<"/sales">) {
  const filters = parseFilters(await searchParams, todayIso());
  // A new key per filter set, so each section shows its skeleton while the new figures stream in.
  const key = filtersToSearch(filters) || "default";

  return (
    <>
      <PageHeader title={dashboard.title} description={dashboard.description} filters={filters} />
      <div className="flex flex-col gap-6">
        <Suspense key={`kpis${key}`} fallback={<KpiRowSkeleton count={8} className={SALES_KPI_GRID} />}>
          <SalesKpis filters={filters} />
        </Suspense>

        <Suspense key={`trend${key}`} fallback={<ChartCardSkeleton height={300} />}>
          <SalesTrend filters={filters} />
        </Suspense>

        <Suspense key={`calendar${key}`} fallback={<ChartCardSkeleton height={320} />}>
          <SalesCalendar filters={filters} />
        </Suspense>

        <div className="grid gap-6 lg:grid-cols-2">
          <Suspense key={`company${key}`} fallback={<ChartCardSkeleton />}>
            <SalesBreakdownChart
              filters={filters}
              dimension="company"
              title="Revenue by company"
              description="Net revenue per trading company"
            />
          </Suspense>
          <Suspense key={`group${key}`} fallback={<ChartCardSkeleton />}>
            <SalesBreakdownChart
              filters={filters}
              dimension="itemGroup"
              title="Revenue by item group"
              description="Top 12 item groups; the rest are grouped as “All other”"
              topN={12}
            />
          </Suspense>
        </div>

        <div className="grid gap-6 lg:grid-cols-2">
          <Suspense key={`salesperson${key}`} fallback={<ChartCardSkeleton />}>
            <SalesBreakdownChart
              filters={filters}
              dimension="salesperson"
              title="Revenue by salesperson"
              description="Top 12 salespeople; the rest are grouped as “All other”"
              topN={12}
            />
          </Suspense>
          <Suspense key={`brand${key}`} fallback={<ChartCardSkeleton />}>
            <SalesBreakdownChart
              filters={filters}
              dimension="brand"
              title="Revenue by brand"
              description="Top 12 brands; the rest are grouped as “All other”. Items without a brand are Unassigned"
              topN={12}
            />
          </Suspense>
        </div>

        <div className="grid gap-6 2xl:grid-cols-2">
          <Suspense key={`customers${key}`} fallback={<ChartCardSkeleton height={420} />}>
            <SalesTopTable
              filters={filters}
              dimension="customer"
              title="Top customers"
              labelHeader="Customer"
            />
          </Suspense>
          <Suspense key={`items${key}`} fallback={<ChartCardSkeleton height={420} />}>
            <SalesTopTable filters={filters} dimension="item" title="Top items" labelHeader="Item" />
          </Suspense>
        </div>
      </div>
      <SalesDrillDialog />
    </>
  );
}
