import Link from "next/link";
import { Suspense } from "react";
import { ArrowRight } from "lucide-react";

import { PageHeader } from "@/components/dashboard/page-header";
import { ChartCardSkeleton, KpiRowSkeleton } from "@/components/dashboard/skeletons";
import { Card } from "@/components/ui/card";
import { DASHBOARDS, dashboardHref, type Dashboard } from "@/lib/dashboards";
import { filtersToSearch, parseFilters, todayIso } from "@/lib/filters";
import { formatDate } from "@/lib/format";
import { DEFAULT_DEAD_STOCK_MONTHS } from "@/lib/server/queries/inventory";

import {
  AreaGroup,
  ArOver90Attention,
  OVERVIEW_ORDER_SCOPE,
  AttentionSkeleton,
  CompanyRanking,
  DeadStockAttention,
  FinanceTiles,
  InventoryTiles,
  OverduePoAttention,
  OverviewPnl,
  OverviewSummary,
  PayablesTiles,
  PurchasingTiles,
  ReceivablesTiles,
  ReorderAttention,
  SalesTiles,
  SummarySkeleton,
  TILE_GRID,
} from "./_overview/sections";
import { PnlDrillDialog } from "./finance/pnl-drill";
import { SalesDrillDialog } from "./sales/sales-drill";
import { SalesTrend } from "./sales/sections";

function registryEntry(slug: string): Dashboard {
  return DASHBOARDS.find((entry) => entry.slug === slug)!;
}

export default async function OverviewPage({ searchParams }: PageProps<"/">) {
  const today = todayIso();
  const filters = parseFilters(await searchParams, today);
  const search = filtersToSearch(filters);
  // Period figures get a new key per filter set; as-of-today ones only per company selection, so
  // changing the period doesn't reload them.
  const key = search || "default";
  const asOfKey = filters.companies.join(",") || "all";
  const asOf = { companies: filters.companies, today };
  const periodCaption = "For the period, vs the same period last year";
  const asOfCaption = `As of today, ${formatDate(today)} · company filter only`;

  const sales = registryEntry("sales");
  const finance = registryEntry("finance");
  const inventory = registryEntry("inventory");
  const purchasing = registryEntry("purchasing");
  const arAp = registryEntry("receivables-payables");
  const href = (dashboard: Dashboard, hash = "", extra = "") =>
    `${dashboardHref(dashboard)}${search}${extra ? `${search ? "&" : "?"}${extra}` : ""}${hash}`;

  return (
    <>
      <PageHeader
        title="Overview"
        description="MBAL's headline figures from Orion, with a way into each dashboard."
        filters={filters}
        note={`Stock, pending POs and AR/AP are as of today, ${formatDate(today)}, and follow only the company filter. Pending POs count ${OVERVIEW_ORDER_SCOPE}, as on Purchasing.`}
      />
      <div className="flex flex-col gap-8">
        <section aria-labelledby="summary-heading" className="flex flex-col gap-2">
          <h2 id="summary-heading" className="sr-only">
            Summary
          </h2>
          <Suspense key={`summary${key}`} fallback={<SummarySkeleton />}>
            <OverviewSummary filters={filters} />
          </Suspense>
        </section>

        <section aria-labelledby="headline-heading" className="flex flex-col gap-4">
          <h2 id="headline-heading" className="text-sm font-medium text-muted-foreground">
            Headline figures
          </h2>
          <div className="grid gap-x-6 gap-y-8 lg:grid-cols-2 2xl:grid-cols-3">
            <AreaGroup
              id="sales"
              title={sales.title}
              icon={sales.icon}
              href={href(sales)}
              caption={periodCaption}
            >
              <Suspense key={`sales${key}`} fallback={<KpiRowSkeleton count={2} grid={TILE_GRID} />}>
                <SalesTiles filters={filters} />
              </Suspense>
            </AreaGroup>
            <AreaGroup
              id="finance"
              title={finance.title}
              icon={finance.icon}
              href={href(finance)}
              caption={periodCaption}
            >
              <Suspense key={`finance${key}`} fallback={<KpiRowSkeleton count={2} grid={TILE_GRID} />}>
                <FinanceTiles filters={filters} />
              </Suspense>
            </AreaGroup>
            <AreaGroup
              id="inventory"
              title={inventory.title}
              icon={inventory.icon}
              href={href(inventory)}
              caption={asOfCaption}
            >
              <Suspense key={`inventory${asOfKey}`} fallback={<KpiRowSkeleton count={2} grid={TILE_GRID} />}>
                <InventoryTiles {...asOf} />
              </Suspense>
            </AreaGroup>
            <AreaGroup
              id="purchasing"
              title={purchasing.title}
              icon={purchasing.icon}
              href={href(purchasing)}
              caption={`${asOfCaption} · ${OVERVIEW_ORDER_SCOPE}`}
            >
              <Suspense key={`purchasing${asOfKey}`} fallback={<KpiRowSkeleton count={2} grid={TILE_GRID} />}>
                <PurchasingTiles {...asOf} />
              </Suspense>
            </AreaGroup>
            <AreaGroup
              id="receivables"
              title="Receivables"
              icon={arAp.icon}
              href={href(arAp)}
              caption={asOfCaption}
            >
              <Suspense
                key={`receivables${asOfKey}`}
                fallback={<KpiRowSkeleton count={2} grid={TILE_GRID} />}
              >
                <ReceivablesTiles {...asOf} />
              </Suspense>
            </AreaGroup>
            <AreaGroup
              id="payables"
              title="Payables"
              icon={arAp.icon}
              href={href(arAp)}
              caption={asOfCaption}
            >
              <Suspense key={`payables${asOfKey}`} fallback={<KpiRowSkeleton count={2} grid={TILE_GRID} />}>
                <PayablesTiles {...asOf} />
              </Suspense>
            </AreaGroup>
          </div>
        </section>

        <section aria-labelledby="companies-heading" className="flex flex-col gap-3">
          <div className="flex flex-wrap items-end justify-between gap-x-3 gap-y-1">
            <h2 id="companies-heading" className="text-sm font-medium text-muted-foreground">
              Companies
            </h2>
            <p className="text-xs text-muted-foreground">{periodCaption}</p>
          </div>
          <Suspense key={`ranking${key}`} fallback={<ChartCardSkeleton height={240} />}>
            <CompanyRanking filters={filters} />
          </Suspense>
        </section>

        <section aria-labelledby="attention-heading" className="flex flex-col gap-3">
          <div className="flex flex-wrap items-end justify-between gap-x-3 gap-y-1">
            <h2 id="attention-heading" className="text-sm font-medium text-muted-foreground">
              Needs attention
            </h2>
            <p className="text-xs text-muted-foreground">{asOfCaption}</p>
          </div>
          <ul className="grid gap-3 sm:grid-cols-2 2xl:grid-cols-4" data-testid="attention">
            <li>
              <Suspense key={`overdue${asOfKey}`} fallback={<AttentionSkeleton />}>
                <OverduePoAttention {...asOf} href={href(purchasing, "#overdue-po-lines")} />
              </Suspense>
            </li>
            <li>
              <Suspense key={`ar90${asOfKey}`} fallback={<AttentionSkeleton />}>
                <ArOver90Attention {...asOf} href={href(arAp, "#ar-aging")} />
              </Suspense>
            </li>
            <li>
              <Suspense key={`dead${asOfKey}`} fallback={<AttentionSkeleton />}>
                <DeadStockAttention
                  companies={filters.companies}
                  href={href(inventory, "#dead-and-slow-stock", `dead=${DEFAULT_DEAD_STOCK_MONTHS}`)}
                />
              </Suspense>
            </li>
            <li>
              <Suspense key={`reorder${asOfKey}`} fallback={<AttentionSkeleton />}>
                <ReorderAttention companies={filters.companies} href={href(inventory, "#reorder-alerts")} />
              </Suspense>
            </li>
          </ul>
        </section>

        <section aria-labelledby="trends-heading" className="flex flex-col gap-3">
          <h2 id="trends-heading" className="text-sm font-medium text-muted-foreground">
            Trends
          </h2>
          <div className="grid gap-6 xl:grid-cols-2">
            <Suspense key={`sales-trend${key}`} fallback={<ChartCardSkeleton height={300} />}>
              <SalesTrend filters={filters} />
            </Suspense>
            <Suspense key={`pnl-trend${key}`} fallback={<ChartCardSkeleton height={300} />}>
              <OverviewPnl filters={filters} />
            </Suspense>
          </div>
        </section>

        <section aria-labelledby="dashboards-heading" className="flex flex-col gap-3">
          <h2 id="dashboards-heading" className="text-sm font-medium text-muted-foreground">
            Dashboards
          </h2>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-5">
            {DASHBOARDS.map((dashboard) => {
              const Icon = dashboard.icon;
              return (
                <Link
                  key={dashboard.slug}
                  href={`${dashboardHref(dashboard)}${search}`}
                  className="group min-w-0 rounded-xl outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
                  data-testid={`dashboard-link-${dashboard.slug}`}
                  title={dashboard.description}
                >
                  <Card className="h-full flex-row items-center gap-3 px-4 py-3 transition-colors group-hover:border-primary/40 group-hover:shadow-md">
                    <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                      <Icon className="size-4" aria-hidden />
                    </span>
                    <span className="flex min-w-0 flex-1 flex-col">
                      <span className="text-sm font-medium">{dashboard.title}</span>
                      <span className="truncate text-xs text-muted-foreground">{dashboard.source}</span>
                    </span>
                    <ArrowRight
                      className="size-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5 group-hover:text-foreground"
                      aria-hidden
                    />
                  </Card>
                </Link>
              );
            })}
          </div>
        </section>
      </div>
      <SalesDrillDialog />
      <PnlDrillDialog />
    </>
  );
}
