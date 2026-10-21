"use client";

import { useState } from "react";

import { BarBreakdown, type BreakdownPoint } from "@/components/dashboard/bar-breakdown";
import { BreakdownCard, breakdownUrl } from "@/components/dashboard/breakdown-card";
import { barPeriod, TrendChart, type TrendBar, type TrendPoint } from "@/components/dashboard/trend-chart";
import { useShell } from "@/components/shell/shell-context";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { useIsMobile } from "@/hooks/use-mobile";
import { filtersToSearch } from "@/lib/filters";
import { bucketTitle, periodBuckets } from "@/lib/periods";

import { useSalesDrill } from "./sales-drill";

/**
 * The Sales charts with the hover breakdown. On wider screens the card is the tooltip (hover, or
 * focus the chart and use the arrow keys); on phones a tap opens it as a bottom sheet. Neither
 * touches the URL. Selecting a month bar (a click, Enter or Space; on phones, the sheet's button)
 * opens the drill-down to its documents.
 */

interface Selected {
  url: string;
  title: string;
  description: string;
  current?: number;
  lastYear?: number;
  /** The drill-down period, for a month or year bar. */
  drill?: string;
}

function BreakdownSheet({
  selected,
  onClose,
  onDrill,
}: {
  selected: Selected | null;
  onClose: () => void;
  onDrill?: (drill: string) => void;
}) {
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
              {selected.drill && onDrill && (
                <Button
                  variant="outline"
                  className="mt-4 w-full"
                  onClick={() => {
                    const drill = selected.drill!;
                    onClose();
                    onDrill(drill);
                  }}
                >
                  List its documents
                </Button>
              )}
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
  const { open } = useSalesDrill();
  const [selected, setSelected] = useState<Selected | null>(null);
  const urlFor = (bar: TrendBar) => breakdownUrl(search, { period: bar.month });
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
                  drill: bar.thisYear ? barPeriod(bar) : undefined,
                })
            : undefined
        }
        // On phones a tap opens the sheet, and the sheet's button opens the drill-down.
        onSelectMonth={isMobile ? undefined : open}
      />
      <BreakdownSheet selected={selected} onClose={() => setSelected(null)} onDrill={open} />
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
