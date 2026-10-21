"use client";

import { useState } from "react";

import {
  HoverBreakdown,
  HoverSheet,
  hoverUrl,
  neighbours,
  type HoverSelection,
  type HoverText,
  type HoverView,
} from "@/components/dashboard/hover-breakdown";
import { TrendChart, type TrendBar, type TrendPoint } from "@/components/dashboard/trend-chart";
import { useShell } from "@/components/shell/shell-context";
import { useIsMobile } from "@/hooks/use-mobile";
import { filtersToSearch } from "@/lib/filters";
import { bucketTitle, periodBuckets } from "@/lib/periods";
import type { HoverBreakdown as SalesHover } from "@/lib/server/queries/sales";

/**
 * The item page's monthly units and net revenue, with partial months, the change under each bar
 * and a hover card of the month by company (a bottom sheet on phones), as on Sales.
 */

const BREAKDOWN_PATH = "/api/items/breakdown";

type Measure = "qty" | "revenue";

const TEXT: Record<Measure, HoverText> = {
  qty: { totalLabel: "Units sold", emptyText: "No sales in this period.", format: "qty" },
  revenue: { totalLabel: "Net revenue", emptyText: "No sales in this period." },
};

function itemView(measure: Measure) {
  return (data: SalesHover): HoverView => {
    const rows = data.breakdowns[0]?.rows ?? [];
    return {
      total: measure === "qty" ? data.quantity : data.netRevenue,
      lastYear: measure === "qty" ? data.lastYearQuantity : data.lastYearNetRevenue,
      sections: [
        {
          id: "company",
          title: "By company",
          rows: rows.map((row) => ({
            label: row.label,
            value: measure === "qty" ? row.quantity : row.netRevenue,
          })),
          share: true,
        },
      ],
    };
  };
}

export function ItemTrendChart({
  code,
  measure,
  data,
  start,
  end,
  ariaLabel,
}: {
  code: string;
  measure: Measure;
  data: TrendPoint[];
  start: string;
  end: string;
  ariaLabel: string;
}) {
  const { filters } = useShell();
  const search = filtersToSearch(filters);
  const isMobile = useIsMobile();
  const [selected, setSelected] = useState<HoverSelection | null>(null);
  const urlFor = (period: string) => hoverUrl(BREAKDOWN_PATH, search, { code, period });
  const keys = periodBuckets(start, end).map((bucket) => bucket.key);
  const toView = itemView(measure);

  return (
    <>
      <TrendChart
        data={data}
        format={measure === "qty" ? "qty" : "aed"}
        period={{ start, end }}
        ariaLabel={ariaLabel}
        renderTooltip={
          isMobile
            ? undefined
            : (bar) => (
                <HoverBreakdown
                  url={urlFor(bar.month)}
                  title={bucketTitle(bar.bucket)}
                  toView={toView}
                  text={TEXT[measure]}
                  current={bar.thisYear}
                  lastYear={bar.lastYear}
                  prefetch={neighbours(keys, bar.month).map(urlFor)}
                />
              )
        }
        onSelect={
          isMobile
            ? (bar: TrendBar) =>
                setSelected({
                  url: urlFor(bar.month),
                  title: bucketTitle(bar.bucket),
                  description: `${TEXT[measure].totalLabel} by company`,
                  current: bar.thisYear,
                  lastYear: bar.lastYear,
                })
            : undefined
        }
      />
      <HoverSheet
        selected={selected}
        onClose={() => setSelected(null)}
        toView={toView}
        text={TEXT[measure]}
      />
    </>
  );
}
