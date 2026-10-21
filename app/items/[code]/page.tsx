import type { Metadata } from "next";
import { Suspense } from "react";

import { ErrorCard } from "@/components/dashboard/error-card";
import { PageHeader } from "@/components/dashboard/page-header";
import { ChartCardSkeleton, KPI_GRID, KpiRowSkeleton } from "@/components/dashboard/skeletons";
import { filtersToSearch, parseFilters, todayIso } from "@/lib/filters";
import { OrderAgeToggle } from "@/components/dashboard/order-age-toggle";
import { formatDate } from "@/lib/format";
import { orderAgeScope, parseOrderAge } from "@/lib/order-age";
import { load } from "@/lib/server/errors";
import { itemByRouteParam as loadItem, type Item } from "@/lib/server/queries/items";

import { ItemNotFound } from "./item-not-found";
import {
  ItemMonthEnd,
  ItemOpenOrders,
  ItemPlanning,
  ItemPurchaseOrders,
  ItemSalesKpis,
  ItemStock,
  ItemStockKpis,
  ItemTopCustomers,
  ItemTrend,
  ReorderBadge,
} from "./sections";

export async function generateMetadata({ params }: PageProps<"/items/[code]">): Promise<Metadata> {
  const { code } = await params;
  const result = await load(() => loadItem(code));
  return { title: !result.ok ? "Item" : result.data ? result.data.name : "Item not found" };
}

/** Code, group, stock flag and frozen flag: whatever the master knows, in one line. */
function masterLine(item: Item): string {
  const frozen = item.companies.filter((company) => company.frozen).length;
  const stockItem = item.companies.some((company) => company.stockItem);
  return [
    `Item ${item.code}`,
    item.group,
    stockItem ? "Stock item" : "Non-stock item",
    frozen === 0
      ? "Active"
      : frozen === item.companies.length
        ? "Frozen in Orion"
        : `Frozen in ${frozen} of ${item.companies.length} companies`,
  ]
    .filter(Boolean)
    .join(" · ");
}

/**
 * One item: sales, margin and months of cover for the period; stock, POs and open orders as of
 * today. A detail page, reached from the header search and the item names in the dashboards' tables.
 */
export default async function ItemPage({ params, searchParams }: PageProps<"/items/[code]">) {
  const [{ code }, search] = await Promise.all([params, searchParams]);
  const today = todayIso();
  const filters = parseFilters(search, today);
  const age = parseOrderAge(search);
  const result = await load(() => loadItem(code));
  if (!result.ok) {
    return (
      <>
        <h1 className="mb-6 text-2xl font-semibold tracking-tight md:text-3xl">Item {code}</h1>
        <ErrorCard message={result.message} />
      </>
    );
  }
  if (!result.data) return <ItemNotFound />;
  const item = result.data;
  const props = { code: item.code, filters, today, age };
  // A new key per filter set, so each section shows its skeleton while new figures stream in.
  // Stock, POs and the open book only depend on the companies.
  const key = `${item.code}${filtersToSearch(filters) || "default"}`;
  const asOfKey = `${item.code}|${today}|${filters.companies.join(",") || "all"}`;
  // Pending POs and open orders also follow the order age.
  const bookKey = `${asOfKey}|${age}`;

  return (
    <>
      <PageHeader
        title={item.name}
        description={masterLine(item)}
        filters={filters}
        note={`Stock, POs and open orders are as of today, ${formatDate(today)} (POs and orders: ${orderAgeScope(age)}): stock and POs follow only the company filter, open orders follow the company, salesperson and brand filters; sales follow the period. Months of cover uses the last 12 months of sales.`}
      />
      <div className="-mt-4 mb-6 flex flex-col items-start gap-2 md:-mt-6 md:mb-8">
        <Suspense fallback={null}>
          <ItemPlanning item={item} />
        </Suspense>
        <Suspense key={`reorder${asOfKey}`} fallback={null}>
          <ReorderBadge {...props} />
        </Suspense>
      </div>
      <div className="flex flex-col gap-6" data-testid="item-page">
        <div className="flex flex-col gap-3 sm:gap-4" data-testid="item-kpis">
          <div className={KPI_GRID}>
            <Suspense key={`kpis${key}`} fallback={<KpiRowSkeleton count={5} grid="contents" />}>
              <ItemSalesKpis {...props} />
            </Suspense>
          </div>
          <div className={KPI_GRID}>
            <Suspense key={`stock-kpis${bookKey}`} fallback={<KpiRowSkeleton count={5} grid="contents" />}>
              <ItemStockKpis {...props} />
            </Suspense>
          </div>
        </div>

        <Suspense key={`trend${key}`} fallback={<ChartCardSkeleton />}>
          <ItemTrend {...props} />
        </Suspense>

        <div className="grid gap-6 lg:grid-cols-2">
          <Suspense key={`stock${asOfKey}`} fallback={<ChartCardSkeleton />}>
            <ItemStock {...props} />
          </Suspense>
          <Suspense key={`month-end${asOfKey}`} fallback={<ChartCardSkeleton />}>
            <ItemMonthEnd {...props} />
          </Suspense>
        </div>

        <div className="flex scroll-mt-20 flex-wrap items-center gap-x-4 gap-y-2" id="order-age">
          <OrderAgeToggle value={age} />
        </div>

        <Suspense key={`pos${bookKey}`} fallback={<ChartCardSkeleton height={300} />}>
          <ItemPurchaseOrders {...props} />
        </Suspense>

        <Suspense key={`orders${bookKey}`} fallback={<ChartCardSkeleton height={300} />}>
          <ItemOpenOrders {...props} />
        </Suspense>

        <Suspense key={`customers${key}`} fallback={<ChartCardSkeleton height={300} />}>
          <ItemTopCustomers {...props} />
        </Suspense>
      </div>
    </>
  );
}
