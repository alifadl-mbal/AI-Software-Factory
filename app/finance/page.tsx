import type { Metadata } from "next";
import { Suspense } from "react";

import { PageHeader } from "@/components/dashboard/page-header";
import { ChartCardSkeleton, KpiRowSkeleton } from "@/components/dashboard/skeletons";
import { DASHBOARDS } from "@/lib/dashboards";
import { filtersToSearch, parseFilters, todayIso } from "@/lib/filters";

import { FINANCE_KPI_GRID, FinanceKpis, FinanceStatement, FinanceTrend, FinanceUnmapped } from "./sections";

const dashboard = DASHBOARDS.find((entry) => entry.slug === "finance")!;

export const metadata: Metadata = { title: dashboard.title };

export default async function FinancePage({ searchParams }: PageProps<"/finance">) {
  const filters = parseFilters(await searchParams, todayIso());
  // A new key per filter set, so each section shows its skeleton while the new figures stream in.
  const key = filtersToSearch(filters) || "default";

  return (
    <>
      <PageHeader title={dashboard.title} description={dashboard.description} filters={filters} />
      <div className="flex flex-col gap-6">
        <Suspense key={`unmapped${key}`} fallback={null}>
          <FinanceUnmapped filters={filters} />
        </Suspense>

        <Suspense key={`kpis${key}`} fallback={<KpiRowSkeleton count={7} className={FINANCE_KPI_GRID} />}>
          <FinanceKpis filters={filters} />
        </Suspense>

        <Suspense key={`trend${key}`} fallback={<ChartCardSkeleton height={300} />}>
          <FinanceTrend filters={filters} />
        </Suspense>

        <Suspense key={`statement${key}`} fallback={<ChartCardSkeleton height={320} />}>
          <FinanceStatement filters={filters} />
        </Suspense>
      </div>
    </>
  );
}
