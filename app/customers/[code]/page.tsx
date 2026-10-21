import type { Metadata } from "next";
import { Suspense } from "react";

import { ErrorCard } from "@/components/dashboard/error-card";
import { PageHeader } from "@/components/dashboard/page-header";
import { ChartCardSkeleton, KPI_GRID, KpiRowSkeleton } from "@/components/dashboard/skeletons";
import { filtersToSearch, parseFilters, todayIso } from "@/lib/filters";
import { formatDate } from "@/lib/format";
import { load } from "@/lib/server/errors";
import { customer as loadCustomer, type Customer } from "@/lib/server/queries/customers";

import { CustomerNotFound } from "./customer-not-found";
import {
  CustomerArAging,
  CustomerArDocuments,
  CustomerArKpis,
  CustomerOpenOrders,
  CustomerProfile,
  CustomerReturns,
  CustomerSalesKpis,
  CustomerTopItems,
  CustomerTrend,
} from "./sections";

export async function generateMetadata({ params }: PageProps<"/customers/[code]">): Promise<Metadata> {
  const { code } = await params;
  const result = await load(() => loadCustomer(code));
  return { title: !result.ok ? "Customer" : result.data ? result.data.name : "Customer not found" };
}

/** Code, type, category, place and parent: whatever the master knows, in one line. */
function masterLine(customer: Customer): string {
  const place = [customer.city, customer.country].filter(Boolean).join(", ");
  return [
    `Customer ${customer.code}`,
    customer.type,
    customer.category,
    place || null,
    customer.parent ? `Part of ${customer.parent}` : null,
    customer.frozen ? "Frozen in Orion" : null,
  ]
    .filter(Boolean)
    .join(" · ");
}

/**
 * One customer: sales, margin and returns for the period; AR and open orders as of today. A detail
 * page, reached from the header search and the customer names in the dashboards' tables.
 */
export default async function CustomerPage({ params, searchParams }: PageProps<"/customers/[code]">) {
  const [{ code }, search] = await Promise.all([params, searchParams]);
  const today = todayIso();
  const filters = parseFilters(search, today);
  const result = await load(() => loadCustomer(code));
  if (!result.ok) {
    return (
      <>
        <h1 className="mb-6 text-2xl font-semibold tracking-tight md:text-3xl">Customer {code}</h1>
        <ErrorCard message={result.message} />
      </>
    );
  }
  if (!result.data) return <CustomerNotFound />;
  const customer = result.data;
  const props = { code: customer.code, filters, today };
  // A new key per filter set, so each section shows its skeleton while new figures stream in.
  // Balances and the open book only depend on the companies.
  const key = `${customer.code}${filtersToSearch(filters) || "default"}`;
  const asOfKey = `${customer.code}|${today}|${filters.companies.join(",") || "all"}`;

  return (
    <>
      <PageHeader
        title={customer.name}
        description={masterLine(customer)}
        filters={filters}
        note={`AR and open orders are as of today, ${formatDate(today)}: AR follows only the company filter, open orders follow the company, salesperson and brand filters; sales and returns follow the period.`}
      />
      <Suspense key={`profile${asOfKey}`} fallback={null}>
        <CustomerProfile {...props} />
      </Suspense>
      <div className="flex flex-col gap-6" data-testid="customer-page">
        {/* AR is the slowest view, so its cards stream in on their own. */}
        <div className={KPI_GRID} data-testid="customer-kpis">
          <Suspense key={`kpis${key}`} fallback={<KpiRowSkeleton count={3} grid="contents" />}>
            <CustomerSalesKpis {...props} />
          </Suspense>
          <Suspense key={`ar-kpis${asOfKey}`} fallback={<KpiRowSkeleton count={2} grid="contents" />}>
            <CustomerArKpis {...props} />
          </Suspense>
        </div>

        <div className="grid gap-6 lg:grid-cols-2">
          <Suspense key={`trend${key}`} fallback={<ChartCardSkeleton />}>
            <CustomerTrend {...props} />
          </Suspense>
          <Suspense key={`ar-aging${asOfKey}`} fallback={<ChartCardSkeleton />}>
            <CustomerArAging {...props} />
          </Suspense>
        </div>

        <Suspense key={`items${key}`} fallback={<ChartCardSkeleton height={420} />}>
          <CustomerTopItems {...props} />
        </Suspense>

        <Suspense key={`ar-documents${asOfKey}`} fallback={<ChartCardSkeleton height={420} />}>
          <CustomerArDocuments {...props} />
        </Suspense>

        <Suspense key={`orders${asOfKey}`} fallback={<ChartCardSkeleton height={420} />}>
          <CustomerOpenOrders {...props} />
        </Suspense>

        <Suspense key={`returns${key}`} fallback={<ChartCardSkeleton height={300} />}>
          <CustomerReturns {...props} />
        </Suspense>
      </div>
    </>
  );
}
