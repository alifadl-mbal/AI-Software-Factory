"use client";

import { useState } from "react";

import { BarBreakdown, type BreakdownPoint } from "@/components/dashboard/bar-breakdown";
import {
  HoverBreakdown,
  HoverSheet,
  hoverUrl,
  neighbours,
  type HoverSelection,
  type HoverText,
  type HoverView,
} from "@/components/dashboard/hover-breakdown";
import { barPeriod, TrendChart, type TrendBar, type TrendPoint } from "@/components/dashboard/trend-chart";
import { useShell } from "@/components/shell/shell-context";
import { useIsMobile } from "@/hooks/use-mobile";
import { filtersToSearch } from "@/lib/filters";
import { bucketTitle, periodBuckets } from "@/lib/periods";
import type { Dimension, HoverBreakdown as SalesHover } from "@/lib/server/queries/sales";

import { useSalesDrill } from "./sales-drill";

/**
 * The Sales charts with the hover breakdown. On wider screens the card is the tooltip (hover, or
 * focus the chart and use the arrow keys); on phones a tap opens it as a bottom sheet. Neither
 * touches the URL. Selecting a month bar (a click, Enter or Space; on phones, the sheet's button)
 * opens the drill-down to its documents.
 */

const BREAKDOWN_PATH = "/api/sales/breakdown";

const DIMENSION_TITLES: Record<Dimension, string> = {
  company: "By company",
  customer: "By customer",
  item: "By item",
  salesperson: "By salesperson",
  brand: "By brand",
  itemGroup: "By item group",
};

const TEXT: HoverText = { totalLabel: "Net revenue", emptyText: "No sales in this period." };

/** `/api/sales/breakdown` as the card shows it: net revenue by each dimension, with shares. */
function salesView(data: SalesHover): HoverView {
  return {
    total: data.netRevenue,
    lastYear: data.lastYearNetRevenue,
    sections: data.breakdowns.map((breakdown) => ({
      id: breakdown.dimension,
      title: DIMENSION_TITLES[breakdown.dimension],
      rows: breakdown.rows.map((row) => ({ label: row.label, value: row.netRevenue })),
      share: true,
    })),
  };
}

/** Monthly net revenue with partial months, the change under each bar and the hover breakdown. */
export function SalesTrendChart({ data, start, end }: { data: TrendPoint[]; start: string; end: string }) {
  const { filters } = useShell();
  const search = filtersToSearch(filters);
  const isMobile = useIsMobile();
  const { open } = useSalesDrill();
  const [selected, setSelected] = useState<HoverSelection | null>(null);
  const urlFor = (period: string) => hoverUrl(BREAKDOWN_PATH, search, { period });
  const keys = periodBuckets(start, end).map((bucket) => bucket.key);

  return (
    <>
      <TrendChart
        data={data}
        period={{ start, end }}
        ariaLabel="Monthly net revenue, this year compared with last year. Select a month's bar to list its documents."
        renderTooltip={
          isMobile
            ? undefined
            : (bar) => (
                <HoverBreakdown
                  url={urlFor(bar.month)}
                  title={bucketTitle(bar.bucket)}
                  toView={salesView}
                  text={TEXT}
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
                  description: "Net revenue by company, salesperson and item group",
                  current: bar.thisYear,
                  lastYear: bar.lastYear,
                  drill: bar.thisYear ? barPeriod(bar) : undefined,
                })
            : undefined
        }
        // On phones a tap opens the sheet, and the sheet's button opens the drill-down.
        onSelectMonth={isMobile ? undefined : open}
      />
      <HoverSheet
        selected={selected}
        onClose={() => setSelected(null)}
        toView={salesView}
        text={TEXT}
        onDrill={open}
        drillLabel="List its documents"
      />
    </>
  );
}

/** "Revenue by company" with each company's top salespeople and item groups on hover or tap. */
export function CompanyBreakdownChart({ data, ariaLabel }: { data: BreakdownPoint[]; ariaLabel: string }) {
  const { filters } = useShell();
  const search = filtersToSearch(filters);
  const isMobile = useIsMobile();
  const [selected, setSelected] = useState<HoverSelection | null>(null);
  const urlFor = (label: string) => hoverUrl(BREAKDOWN_PATH, search, { by: "company", label });

  return (
    <>
      <BarBreakdown
        data={data}
        ariaLabel={ariaLabel}
        renderTooltip={
          isMobile
            ? undefined
            : (point) => (
                <HoverBreakdown
                  url={urlFor(point.label)}
                  title={point.label}
                  toView={salesView}
                  text={TEXT}
                  current={point.value}
                  prefetch={neighbours(
                    data.map((entry) => entry.label),
                    point.label,
                  ).map(urlFor)}
                />
              )
        }
        onSelect={
          isMobile
            ? (point) =>
                setSelected({
                  url: urlFor(point.label),
                  title: point.label,
                  description: "Net revenue by salesperson and item group",
                  current: point.value,
                })
            : undefined
        }
      />
      <HoverSheet selected={selected} onClose={() => setSelected(null)} toView={salesView} text={TEXT} />
    </>
  );
}
