import type { Metadata } from "next";
import { Suspense } from "react";

import { PageHeader } from "@/components/dashboard/page-header";
import { ChartCardSkeleton, KpiRowSkeleton } from "@/components/dashboard/skeletons";
import { DASHBOARDS } from "@/lib/dashboards";
import { filtersToSearch, parseFilters, todayIso } from "@/lib/filters";

import { PnlDrillDialog } from "./pnl-drill";
import {
  FINANCE_KPI_GRID,
  FinanceExpenseChart,
  FinanceKpis,
  FinanceStatement,
  FinanceTrend,
  FinanceUnmapped,
} from "./sections";

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

        <Suspense key={`expense-account${key}`} fallback={<ChartCardSkeleton />}>
          <FinanceExpenseChart
            filters={filters}
            dimension="account"
            title="Costs by GL account"
            description="Cost of sales and G&A by main account; top 12, the rest grouped as “All other”"
            topN={12}
          />
        </Suspense>

        <div className="grid gap-6 lg:grid-cols-2">
          <Suspense key={`expense-division${key}`} fallback={<ChartCardSkeleton />}>
            <FinanceExpenseChart
              filters={filters}
              dimension="division"
              title="Costs by division"
              description="Cost of sales and G&A per division"
              topN={12}
            />
          </Suspense>
          <Suspense key={`expense-department${key}`} fallback={<ChartCardSkeleton />}>
            <FinanceExpenseChart
              filters={filters}
              dimension="department"
              title="Costs by department"
              description="Cost of sales and G&A per department"
              topN={12}
            />
          </Suspense>
        </div>
      </div>
      <PnlDrillDialog />
    </>
  );
}
