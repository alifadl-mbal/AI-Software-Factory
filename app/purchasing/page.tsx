import type { Metadata } from "next";
import { Suspense } from "react";

import { PageHeader } from "@/components/dashboard/page-header";
import { ChartCardSkeleton, KpiRowSkeleton } from "@/components/dashboard/skeletons";
import { DASHBOARDS } from "@/lib/dashboards";
import { filtersToSearch, parseFilters, todayIso } from "@/lib/filters";
import { formatDate } from "@/lib/format";

import {
  OverdueLinesTable,
  PendingByBucket,
  PendingByCompany,
  PendingBySupplier,
  PurchasingKpis,
  ReceiptsTopSuppliers,
  ReceiptsTrend,
  ZeroRateCallout,
} from "./sections";

const dashboard = DASHBOARDS.find((entry) => entry.slug === "purchasing")!;

export const metadata: Metadata = { title: dashboard.title };

export default async function PurchasingPage({ searchParams }: PageProps<"/purchasing">) {
  const today = todayIso();
  const filters = parseFilters(await searchParams, today);
  // A new key per filter set, so each section shows its skeleton while the new figures stream in.
  const key = filtersToSearch(filters) || "default";
  const pendingKey = filters.companies.join(",") || "all";

  return (
    <>
      <PageHeader
        title={dashboard.title}
        description={dashboard.description}
        filters={filters}
        note={`Pending POs are as of today, ${formatDate(today)}, whatever the period; receipts follow the period.`}
      />
      <div className="flex flex-col gap-6">
        <Suspense key={`kpis${key}`} fallback={<KpiRowSkeleton count={5} />}>
          <PurchasingKpis filters={filters} today={today} />
        </Suspense>

        <Suspense key={`zero-rate${key}`} fallback={null}>
          <ZeroRateCallout filters={filters} />
        </Suspense>

        <div className="grid gap-6 lg:grid-cols-2">
          <Suspense key={`bucket${pendingKey}`} fallback={<ChartCardSkeleton />}>
            <PendingByBucket filters={filters} today={today} />
          </Suspense>
          <Suspense key={`company${pendingKey}`} fallback={<ChartCardSkeleton />}>
            <PendingByCompany filters={filters} today={today} />
          </Suspense>
        </div>

        <Suspense key={`supplier${pendingKey}`} fallback={<ChartCardSkeleton height={520} />}>
          <PendingBySupplier filters={filters} today={today} />
        </Suspense>

        <Suspense key={`overdue${pendingKey}`} fallback={<ChartCardSkeleton height={420} />}>
          <OverdueLinesTable filters={filters} today={today} />
        </Suspense>

        <Suspense key={`trend${key}`} fallback={<ChartCardSkeleton height={300} />}>
          <ReceiptsTrend filters={filters} />
        </Suspense>

        <Suspense key={`receipt-suppliers${key}`} fallback={<ChartCardSkeleton height={420} />}>
          <ReceiptsTopSuppliers filters={filters} />
        </Suspense>
      </div>
    </>
  );
}
