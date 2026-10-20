import Link from "next/link";
import { Suspense } from "react";
import { ArrowRight } from "lucide-react";

import { PageHeader } from "@/components/dashboard/page-header";
import { ChartCardSkeleton, KpiRowSkeleton } from "@/components/dashboard/skeletons";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { DASHBOARDS, dashboardHref } from "@/lib/dashboards";
import { filtersToSearch, parseFilters, todayIso } from "@/lib/filters";

import { SalesKpis, SalesTrend } from "./sales/sections";

export default async function OverviewPage({ searchParams }: PageProps<"/">) {
  const filters = parseFilters(await searchParams, todayIso());
  const search = filtersToSearch(filters);
  const key = search || "default";

  return (
    <>
      <PageHeader
        title="Overview"
        description="MBAL's headline figures from Orion, and a way into each dashboard."
        filters={filters}
      />
      <div className="flex flex-col gap-8">
        <section aria-labelledby="dashboards-heading" className="flex flex-col gap-3">
          <h2 id="dashboards-heading" className="text-sm font-medium text-muted-foreground">
            Dashboards
          </h2>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {DASHBOARDS.map((dashboard) => {
              const Icon = dashboard.icon;
              return (
                <Link
                  key={dashboard.slug}
                  href={`${dashboardHref(dashboard)}${search}`}
                  className="group rounded-xl outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
                  data-testid={`dashboard-link-${dashboard.slug}`}
                >
                  <Card className="h-full transition-colors group-hover:border-primary/40 group-hover:shadow-md">
                    <CardHeader>
                      <div className="flex items-center gap-3">
                        <span className="flex size-9 items-center justify-center rounded-lg bg-primary/10 text-primary">
                          <Icon className="size-4.5" aria-hidden />
                        </span>
                        <CardTitle className="text-base">{dashboard.title}</CardTitle>
                        <ArrowRight
                          className="ml-auto size-4 text-muted-foreground transition-transform group-hover:translate-x-0.5 group-hover:text-foreground"
                          aria-hidden
                        />
                      </div>
                      <CardDescription className="pt-1">{dashboard.description}</CardDescription>
                      <p className="pt-1 text-xs text-muted-foreground">Source: {dashboard.source}</p>
                    </CardHeader>
                  </Card>
                </Link>
              );
            })}
          </div>
        </section>

        <section aria-labelledby="sales-heading" className="flex flex-col gap-3">
          <h2 id="sales-heading" className="text-sm font-medium text-muted-foreground">
            Sales at a glance
          </h2>
          <Suspense key={`kpis${key}`} fallback={<KpiRowSkeleton count={5} />}>
            <SalesKpis filters={filters} />
          </Suspense>
          <Suspense key={`trend${key}`} fallback={<ChartCardSkeleton height={300} />}>
            <SalesTrend filters={filters} />
          </Suspense>
        </section>
      </div>
    </>
  );
}
