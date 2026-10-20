import type { Metadata } from "next";
import { Suspense } from "react";

import { PageHeader } from "@/components/dashboard/page-header";
import { ChartCardSkeleton, KpiRowSkeleton } from "@/components/dashboard/skeletons";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { DASHBOARDS } from "@/lib/dashboards";
import { filtersToSearch, parseFilters, todayIso } from "@/lib/filters";

import {
  ApAging,
  ApCurrencyNote,
  ApPrepayments,
  ApTopVendors,
  AR_AP_KPI_GRID,
  ArAging,
  ArBySalesperson,
  ArCollection,
  ArTopCustomers,
  ArApKpis,
} from "./sections";

const dashboard = DASHBOARDS.find((entry) => entry.slug === "receivables-payables")!;

export const metadata: Metadata = { title: dashboard.title };

export default async function ReceivablesPayablesPage({ searchParams }: PageProps<"/receivables-payables">) {
  const today = todayIso();
  const filters = parseFilters(await searchParams, today);
  // Balances are as of today: only the company filter applies.
  const scope = { asOf: today, companies: filters.companies, search: filtersToSearch(filters) };
  // A new key per company selection, so each section shows its skeleton while new figures stream in.
  const key = `${today}|${filters.companies.join(",") || "all"}`;

  return (
    <>
      <PageHeader
        title={dashboard.title}
        description={dashboard.description}
        filters={filters}
        asOf={today}
      />
      <div className="flex flex-col gap-6">
        <Suspense key={`kpis${key}`} fallback={<KpiRowSkeleton count={7} grid={AR_AP_KPI_GRID} />}>
          <ArApKpis {...scope} />
        </Suspense>

        <Tabs defaultValue="ar" className="gap-6">
          <TabsList aria-label="Receivables or payables" className="w-full sm:w-fit">
            <TabsTrigger value="ar">Receivables (AR)</TabsTrigger>
            <TabsTrigger value="ap">Payables (AP)</TabsTrigger>
          </TabsList>

          <TabsContent value="ar" className="flex flex-col gap-6" data-testid="ar-tab">
            <div className="grid gap-6 lg:grid-cols-2">
              <Suspense key={`ar-aging${key}`} fallback={<ChartCardSkeleton />}>
                <ArAging {...scope} />
              </Suspense>
              <Suspense key={`ar-salesperson${key}`} fallback={<ChartCardSkeleton />}>
                <ArBySalesperson {...scope} />
              </Suspense>
            </div>
            <Suspense key={`ar-customers${key}`} fallback={<ChartCardSkeleton height={420} />}>
              <ArTopCustomers {...scope} />
            </Suspense>
            <Suspense key={`ar-collection${key}`} fallback={<ChartCardSkeleton height={420} />}>
              <ArCollection {...scope} />
            </Suspense>
          </TabsContent>

          <TabsContent value="ap" className="flex flex-col gap-6" data-testid="ap-tab">
            <ApCurrencyNote />
            <Suspense key={`ap-aging${key}`} fallback={<ChartCardSkeleton />}>
              <ApAging {...scope} />
            </Suspense>
            <div className="grid gap-6 2xl:grid-cols-2">
              <Suspense key={`ap-vendors${key}`} fallback={<ChartCardSkeleton height={420} />}>
                <ApTopVendors {...scope} />
              </Suspense>
              <Suspense key={`ap-prepayments${key}`} fallback={<ChartCardSkeleton height={420} />}>
                <ApPrepayments {...scope} />
              </Suspense>
            </div>
          </TabsContent>
        </Tabs>
      </div>
    </>
  );
}
