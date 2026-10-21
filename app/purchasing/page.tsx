import type { Metadata } from "next";
import { Suspense } from "react";

import { PageHeader } from "@/components/dashboard/page-header";
import { ChartCardSkeleton, KpiRowSkeleton } from "@/components/dashboard/skeletons";
import { DASHBOARDS } from "@/lib/dashboards";
import { filtersToSearch, parseFilters, todayIso } from "@/lib/filters";
import { formatDate } from "@/lib/format";
import { orderAgeScope, parseOrderAge } from "@/lib/order-age";

import { ReceiptsDrillDialog } from "./charts";
import {
  OrderAgeBar,
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
  const params = await searchParams;
  const filters = parseFilters(params, today);
  const age = parseOrderAge(params);
  // A new key per filter set, so each section shows its skeleton while the new figures stream in.
  // Pending POs only depend on the companies, the brands and the order age.
  const key = filtersToSearch(filters) || "default";
  const pendingKey = `${filters.companies.join(",") || "all"}|${filters.brands.join(",") || "all"}|${age}`;
  const scope = { filters, today, age };

  return (
    <>
      <PageHeader
        title={dashboard.title}
        description={dashboard.description}
        filters={filters}
        note={`Pending POs are as of today, ${formatDate(today)}, whatever the period, on ${orderAgeScope(age)}; receipts follow the period. Both follow the company and brand filters.`}
      />
      <div className="flex flex-col gap-6">
        <Suspense key={`kpis${key}|${age}`} fallback={<KpiRowSkeleton count={5} />}>
          <PurchasingKpis {...scope} />
        </Suspense>

        <OrderAgeBar {...scope} pendingKey={pendingKey} />

        <Suspense key={`zero-rate${key}`} fallback={null}>
          <ZeroRateCallout filters={filters} />
        </Suspense>

        <div className="grid gap-6 lg:grid-cols-2">
          <Suspense key={`bucket${pendingKey}`} fallback={<ChartCardSkeleton />}>
            <PendingByBucket {...scope} />
          </Suspense>
          <Suspense key={`company${pendingKey}`} fallback={<ChartCardSkeleton />}>
            <PendingByCompany {...scope} />
          </Suspense>
        </div>

        <Suspense key={`supplier${pendingKey}`} fallback={<ChartCardSkeleton height={520} />}>
          <PendingBySupplier {...scope} />
        </Suspense>

        <Suspense key={`overdue${pendingKey}`} fallback={<ChartCardSkeleton height={420} />}>
          <OverdueLinesTable {...scope} />
        </Suspense>

        <Suspense key={`trend${key}`} fallback={<ChartCardSkeleton height={300} />}>
          <ReceiptsTrend filters={filters} />
        </Suspense>

        <Suspense key={`receipt-suppliers${key}`} fallback={<ChartCardSkeleton height={420} />}>
          <ReceiptsTopSuppliers filters={filters} />
        </Suspense>
      </div>
      <ReceiptsDrillDialog />
    </>
  );
}
