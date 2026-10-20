import type { Metadata } from "next";
import { Suspense } from "react";

import { PageHeader } from "@/components/dashboard/page-header";
import { ChartCardSkeleton, KpiRowSkeleton } from "@/components/dashboard/skeletons";
import { DASHBOARDS } from "@/lib/dashboards";
import { filtersToSearch, parseFilters, todayIso } from "@/lib/filters";
import { parseDeadStockMonths } from "@/lib/server/queries/inventory";

import {
  DeadStockSection,
  InventoryKpis,
  MonthEndTrend,
  ReorderAlertsSection,
  StockBreakdownChart,
} from "./sections";

const dashboard = DASHBOARDS.find((entry) => entry.slug === "inventory")!;

export const metadata: Metadata = { title: dashboard.title };

export default async function InventoryPage({ searchParams }: PageProps<"/inventory">) {
  const params = await searchParams;
  const today = todayIso();
  const filters = parseFilters(params, today);
  const deadMonths = parseDeadStockMonths(params.dead);
  // Only the company filter applies here: stock is as of today whatever the date range says.
  const { companies } = filters;
  const key = companies.join(",") || "all";
  // Item names link to the item page with the filters kept.
  const search = filtersToSearch(filters);

  return (
    <>
      <PageHeader
        title={dashboard.title}
        description={dashboard.description}
        filters={filters}
        asOf={today}
      />
      <div className="flex flex-col gap-6">
        <Suspense key={`kpis${key}`} fallback={<KpiRowSkeleton count={5} />}>
          <InventoryKpis companies={companies} />
        </Suspense>

        <Suspense key={`trend${key}`} fallback={<ChartCardSkeleton height={300} />}>
          <MonthEndTrend companies={companies} />
        </Suspense>

        <div className="grid gap-6 lg:grid-cols-2">
          <Suspense key={`company${key}`} fallback={<ChartCardSkeleton />}>
            <StockBreakdownChart
              companies={companies}
              dimension="company"
              title="Stock value by company"
              description="Live stock value per company"
            />
          </Suspense>
          <Suspense key={`group${key}`} fallback={<ChartCardSkeleton />}>
            <StockBreakdownChart
              companies={companies}
              dimension="itemGroup"
              title="Stock value by item group"
              description="Top 12 item groups; the rest are grouped as “All other”"
              topN={12}
            />
          </Suspense>
          <Suspense key={`location${key}`} fallback={<ChartCardSkeleton />}>
            <StockBreakdownChart
              companies={companies}
              dimension="location"
              title="Stock value by location"
              description="Top 12 locations; the rest are grouped as “All other”"
              topN={12}
            />
          </Suspense>
          <Suspense key={`grade${key}`} fallback={<ChartCardSkeleton />}>
            <StockBreakdownChart
              companies={companies}
              dimension="grade"
              title="Stock value by grade"
              description="Top 12 grades; the rest are grouped as “All other”"
              topN={12}
            />
          </Suspense>
        </div>

        <Suspense key={`dead${key}-${deadMonths}`} fallback={<ChartCardSkeleton height={420} />}>
          <DeadStockSection companies={companies} months={deadMonths} search={search} />
        </Suspense>

        <Suspense key={`reorder${key}`} fallback={<ChartCardSkeleton height={420} />}>
          <ReorderAlertsSection companies={companies} search={search} />
        </Suspense>
      </div>
    </>
  );
}
