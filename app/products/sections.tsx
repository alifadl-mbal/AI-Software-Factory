import "server-only";

import Link from "next/link";

import { ChartCard } from "@/components/dashboard/chart-card";
import { EmptyState } from "@/components/dashboard/empty-state";
import { ErrorCard } from "@/components/dashboard/error-card";
import { KpiCard } from "@/components/dashboard/kpi-card";
import { KPI_GRID } from "@/components/dashboard/skeletons";
import { ReportAsOf } from "@/components/shell/shell-context";
import { filtersToSearch, type Filters } from "@/lib/filters";
import { formatAed, formatPct } from "@/lib/format";
import { itemHref } from "@/lib/items";
import type { Watchlist, WatchRow } from "@/lib/product-mix";
import { cn } from "@/lib/utils";
import { dataAsOf } from "@/lib/server/db";
import { load } from "@/lib/server/errors";
import { productMix, TREEMAP_BRANDS, TREEMAP_ITEMS } from "@/lib/server/product-mix";

import { MixTreemap } from "./mix-treemap";

/** Four cards: one row of four on wide screens. */
export const MIX_KPI_GRID = cn(KPI_GRID, "xl:grid-cols-4");

/** An error in a KPI row spans the whole row rather than one card's cell. */
function RowError({ message }: { message: string }) {
  return (
    <div className="col-span-full">
      <ErrorCard message={message} />
    </div>
  );
}

export async function MixKpis({ filters }: { filters: Filters }) {
  const result = await load(() => productMix(filters));
  return (
    <div className={MIX_KPI_GRID} data-testid="mix-kpis">
      {!result.ok ? (
        <RowError message={result.message} />
      ) : (
        <>
          <ReportAsOf iso={dataAsOf().toISOString()} />
          <KpiCard
            label="Net revenue"
            value={result.data.netRevenue}
            previous={result.data.lastYearNetRevenue}
          />
          <KpiCard
            label="Gross margin"
            value={result.data.grossMargin}
            previous={result.data.lastYearGrossMargin}
          />
          <KpiCard
            label="Items sold"
            value={result.data.itemCount}
            previous={result.data.lastYearItemCount}
            format="int"
            hint="Item codes with net revenue in the period"
          />
          <KpiCard
            label="Brands sold"
            value={result.data.brandCount}
            previous={result.data.lastYearBrandCount}
            format="int"
            hint="Unassigned counts as one"
          />
        </>
      )}
    </div>
  );
}

export async function MixTreemapSection({ filters }: { filters: Filters }) {
  const result = await load(() => productMix(filters));
  return (
    <ChartCard
      title="Revenue by brand and item"
      description={`Area is net revenue, colour the change vs the same days last year. The top ${TREEMAP_BRANDS} brands and each brand's top ${TREEMAP_ITEMS} items have their own tile; the rest are “All other”. Items are grouped by code, and items without a brand are Unassigned.`}
      action={
        result.ok && result.data.brands.length > 0 ? (
          <span className="tabular text-sm font-medium" data-testid="treemap-total">
            {formatAed(result.data.netRevenue)}
          </span>
        ) : undefined
      }
    >
      {!result.ok ? (
        <ErrorCard message={result.message} />
      ) : result.data.brands.length === 0 ? (
        <EmptyState />
      ) : (
        <MixTreemap brands={result.data.brands} search={filtersToSearch(filters)} />
      )}
    </ChartCard>
  );
}

function figure(list: Watchlist, row: WatchRow): string {
  if (list.metric === "change") return `${row.change > 0 ? "+" : ""}${formatAed(row.change)}`;
  return formatPct(list.metric === "discountPct" ? row.discountPct : row.returnsPct);
}

function WatchlistCard({ list, filters }: { list: Watchlist; filters: Filters }) {
  return (
    <ChartCard title={list.title} description={list.rule}>
      {list.rows.length === 0 ? (
        <EmptyState title="No items meet this rule" message="Try a wider date range or more companies." />
      ) : (
        <ol className="flex flex-col divide-y text-sm" data-testid={`watchlist-${list.id}`}>
          {list.rows.map((row, index) => (
            <li key={`${row.code ?? ""}-${index}`} className="flex items-baseline gap-3 py-2">
              <span className="tabular w-5 shrink-0 text-right text-xs text-muted-foreground">
                {index + 1}
              </span>
              <span className="flex min-w-0 flex-1 flex-col">
                {row.code !== null ? (
                  <Link
                    href={itemHref(row.code, filters)}
                    className="truncate font-medium text-primary underline-offset-4 hover:underline focus-visible:underline"
                  >
                    {row.label}
                  </Link>
                ) : (
                  <span className="truncate font-medium">{row.label}</span>
                )}
                <span className="tabular truncate text-xs text-muted-foreground">
                  {formatAed(row.netRevenue)} · last year {formatAed(row.lastYearNetRevenue)}
                </span>
              </span>
              <span
                className={cn(
                  "tabular shrink-0 font-medium",
                  list.id === "growers" && "text-positive",
                  list.id === "decliners" && "text-negative",
                )}
              >
                {figure(list, row)}
              </span>
            </li>
          ))}
        </ol>
      )}
    </ChartCard>
  );
}

/** Growers, decliners, highest discount % and highest returns %, top 10 each. */
export async function MixWatchlists({ filters }: { filters: Filters }) {
  const result = await load(() => productMix(filters));
  if (!result.ok) return <ErrorCard message={result.message} />;
  return (
    <div className="grid gap-6 lg:grid-cols-2" data-testid="watchlists">
      {result.data.watchlists.map((list) => (
        <WatchlistCard key={list.id} list={list} filters={filters} />
      ))}
    </div>
  );
}
