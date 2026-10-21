"use client";

import { useState } from "react";

import { BarBreakdown, type BreakdownPoint } from "@/components/dashboard/bar-breakdown";
import { BreakdownCard, breakdownUrl } from "@/components/dashboard/breakdown-card";
import { TrendChart, type TrendBar, type TrendPoint } from "@/components/dashboard/trend-chart";
import { useShell } from "@/components/shell/shell-context";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { useIsMobile } from "@/hooks/use-mobile";
import { filtersToSearch } from "@/lib/filters";
import { bucketTitle, periodBuckets } from "@/lib/periods";

/**
 * The Sales charts with the hover breakdown. On wider screens the card is the tooltip (hover, or
 * focus the chart and use the arrow keys); on phones a tap opens it as a bottom sheet. Neither
 * touches the URL.
 */

interface Selected {
  url: string;
  title: string;
  description: string;
  current?: number;
  lastYear?: number;
}

function BreakdownSheet({ selected, onClose }: { selected: Selected | null; onClose: () => void }) {
  return (
    <Sheet open={selected !== null} onOpenChange={(open) => !open && onClose()}>
      <SheetContent side="bottom" className="max-h-[85vh] overflow-y-auto" data-testid="breakdown-sheet">
        {selected && (
          <>
            <SheetHeader className="pr-12 pb-0">
              <SheetTitle>{selected.title}</SheetTitle>
              <SheetDescription>{selected.description}</SheetDescription>
            </SheetHeader>
            <div className="px-4 pb-6">
              <BreakdownCard
                url={selected.url}
                title={selected.title}
                current={selected.current}
                lastYear={selected.lastYear}
                variant="sheet"
              />
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}

/** Monthly net revenue with partial months, the change under each bar and the hover breakdown. */
export function SalesTrendChart({ data, start, end }: { data: TrendPoint[]; start: string; end: string }) {
  const { filters } = useShell();
  const search = filtersToSearch(filters);
  const isMobile = useIsMobile();
  const [selected, setSelected] = useState<Selected | null>(null);
  const urlFor = (bar: TrendBar) => breakdownUrl(search, { period: bar.month });
  const keys = periodBuckets(start, end).map((bucket) => bucket.key);

  return (
    <>
      <TrendChart
        data={data}
        period={{ start, end }}
        renderTooltip={
          isMobile
            ? undefined
            : (bar) => (
                <BreakdownCard
                  url={urlFor(bar)}
                  title={bucketTitle(bar.bucket)}
                  current={bar.thisYear}
                  lastYear={bar.lastYear}
                  prefetch={neighbours(keys, bar.month).map((month) =>
                    breakdownUrl(search, { period: month }),
                  )}
                />
              )
        }
        onSelect={
          isMobile
            ? (bar) =>
                setSelected({
                  url: urlFor(bar),
                  title: bucketTitle(bar.bucket),
                  description: "Net revenue by company, salesperson and item group",
                  current: bar.thisYear,
                  lastYear: bar.lastYear,
                })
            : undefined
        }
      />
      <BreakdownSheet selected={selected} onClose={() => setSelected(null)} />
    </>
  );
}

function neighbours(keys: string[], key: string): string[] {
  const index = keys.indexOf(key);
  return index < 0 ? [] : [keys[index - 1], keys[index + 1]].filter((value): value is string => !!value);
}

/** "Revenue by company" with each company's top salespeople and item groups on hover or tap. */
export function CompanyBreakdownChart({ data, ariaLabel }: { data: BreakdownPoint[]; ariaLabel: string }) {
  const { filters } = useShell();
  const search = filtersToSearch(filters);
  const isMobile = useIsMobile();
  const [selected, setSelected] = useState<Selected | null>(null);
  const urlFor = (point: BreakdownPoint) => breakdownUrl(search, { by: "company", label: point.label });

  return (
    <>
      <BarBreakdown
        data={data}
        ariaLabel={ariaLabel}
        renderTooltip={
          isMobile
            ? undefined
            : (point) => (
                <BreakdownCard
                  url={urlFor(point)}
                  title={point.label}
                  current={point.value}
                  prefetch={neighbours(
                    data.map((entry) => entry.label),
                    point.label,
                  ).map((label) => breakdownUrl(search, { by: "company", label }))}
                />
              )
        }
        onSelect={
          isMobile
            ? (point) =>
                setSelected({
                  url: urlFor(point),
                  title: point.label,
                  description: "Net revenue by salesperson and item group",
                  current: point.value,
                })
            : undefined
        }
      />
      <BreakdownSheet selected={selected} onClose={() => setSelected(null)} />
    </>
  );
}
