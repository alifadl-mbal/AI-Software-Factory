import type { Metadata } from "next";
import { Suspense } from "react";

import { PageHeader } from "@/components/dashboard/page-header";
import { ChartCardSkeleton, KpiRowSkeleton } from "@/components/dashboard/skeletons";
import { DASHBOARDS } from "@/lib/dashboards";
import { filtersToSearch, parseFilters, todayIso } from "@/lib/filters";

import { MIX_KPI_GRID, MixKpis, MixTreemapSection, MixWatchlists } from "./sections";

const dashboard = DASHBOARDS.find((entry) => entry.slug === "products")!;

export const metadata: Metadata = { title: dashboard.title };

export default async function ProductsPage({ searchParams }: PageProps<"/products">) {
  const filters = parseFilters(await searchParams, todayIso());
  // A new key per filter set, so each section shows its skeleton while the new figures stream in.
  const key = filtersToSearch(filters) || "default";

  return (
    <>
      <PageHeader title={dashboard.title} description={dashboard.description} filters={filters} />
      <div className="flex flex-col gap-6">
        <Suspense key={`kpis${key}`} fallback={<KpiRowSkeleton count={4} className={MIX_KPI_GRID} />}>
          <MixKpis filters={filters} />
        </Suspense>

        <Suspense key={`treemap${key}`} fallback={<ChartCardSkeleton height={440} />}>
          <MixTreemapSection filters={filters} />
        </Suspense>

        <Suspense
          key={`watchlists${key}`}
          fallback={
            <div className="grid gap-6 lg:grid-cols-2">
              {Array.from({ length: 4 }, (_, index) => (
                <ChartCardSkeleton key={index} height={360} />
              ))}
            </div>
          }
        >
          <MixWatchlists filters={filters} />
        </Suspense>
      </div>
    </>
  );
}
