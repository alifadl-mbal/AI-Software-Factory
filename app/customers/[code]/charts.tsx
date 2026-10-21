"use client";

import { useState } from "react";

import {
  HoverBreakdown,
  HoverSheet,
  hoverUrl,
  neighbours,
  type HoverSelection,
} from "@/components/dashboard/hover-breakdown";
import { TrendChart, type TrendPoint } from "@/components/dashboard/trend-chart";
import { useShell } from "@/components/shell/shell-context";
import { useIsMobile } from "@/hooks/use-mobile";
import { filtersToSearch } from "@/lib/filters";
import { bucketTitle, periodBuckets } from "@/lib/periods";
import { SALES_HOVER_TEXT, salesView } from "@/app/sales/charts";

/**
 * The customer's monthly net revenue, as on Sales: partial months hatched, the change on last year
 * under each bar, and a hover card (a bottom sheet on phones) with the month by company and item
 * group. The card is the Sales one, narrowed to this customer.
 */
export function CustomerTrendChart({
  code,
  data,
  start,
  end,
}: {
  code: string;
  data: TrendPoint[];
  start: string;
  end: string;
}) {
  const { filters } = useShell();
  const search = filtersToSearch(filters);
  const isMobile = useIsMobile();
  const [selected, setSelected] = useState<HoverSelection | null>(null);
  const urlFor = (period: string) => hoverUrl("/api/sales/breakdown", search, { period, customer: code });
  const keys = periodBuckets(start, end).map((bucket) => bucket.key);

  return (
    <>
      <TrendChart
        data={data}
        period={{ start, end }}
        ariaLabel="Monthly net revenue of this customer, this year compared with last year"
        renderTooltip={
          isMobile
            ? undefined
            : (bar) => (
                <HoverBreakdown
                  url={urlFor(bar.month)}
                  title={bucketTitle(bar.bucket)}
                  toView={salesView}
                  text={SALES_HOVER_TEXT}
                  current={bar.thisYear}
                  lastYear={bar.lastYear}
                  prefetch={neighbours(keys, bar.month).map(urlFor)}
                />
              )
        }
        onSelect={
          isMobile
            ? (bar) =>
                setSelected({
                  url: urlFor(bar.month),
                  title: bucketTitle(bar.bucket),
                  description: "This customer's net revenue by company and item group",
                  current: bar.thisYear,
                  lastYear: bar.lastYear,
                })
            : undefined
        }
      />
      <HoverSheet
        selected={selected}
        onClose={() => setSelected(null)}
        toView={salesView}
        text={SALES_HOVER_TEXT}
      />
    </>
  );
}
