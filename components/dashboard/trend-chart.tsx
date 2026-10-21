"use client";

import { useId, type ReactNode } from "react";
import {
  Bar,
  CartesianGrid,
  Cell,
  ComposedChart,
  Line,
  Rectangle,
  XAxis,
  YAxis,
  type BarShapeProps,
} from "recharts";

import {
  ChartContainer,
  ChartLegend,
  ChartLegendContent,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart";
import { formatAed, formatAedCompact, formatCompact, formatMonth, formatQty } from "@/lib/format";
import { bucketTick, bucketTitle, rollUp, yoyChange, type PeriodBucket } from "@/lib/periods";

import { HatchPattern, PartialNote, PeriodTick, type TickPoint } from "./period-axis";

export interface TrendPoint {
  /** `YYYY-MM`. */
  month: string;
  thisYear: number;
  lastYear: number;
}

/** One bar of a chart with a `period`: a month, or a year for ranges over 24 months. */
export interface TrendBar extends TrendPoint {
  bucket: PeriodBucket;
  yoy: number | null;
}

const CONFIG = {
  thisYear: { label: "This year", color: "var(--chart-cy)" },
  lastYear: { label: "Last year", color: "var(--chart-py)" },
} satisfies ChartConfig;

/** What a bar selects: its `YYYY-MM` month, or a yearly bar's `from..to` days. */
export function barPeriod(point: TrendPoint | TrendBar): string {
  const bucket = "bucket" in point ? point.bucket : undefined;
  return bucket?.granularity === "year" ? `${bucket.from}..${bucket.to}` : point.month;
}

/** A bar that is also a button: a click, Enter or Space selects its month. */
function SelectableBar({
  selectMonth,
  full,
  ...props
}: BarShapeProps & { selectMonth: (month: string) => void; full: (value: number) => string }) {
  const point = props.payload as TrendPoint | TrendBar;
  if (!point.thisYear) return <Rectangle {...props} />;
  const period = barPeriod(point);
  const title = "bucket" in point ? bucketTitle(point.bucket) : formatMonth(point.month);
  return (
    <g
      role="button"
      tabIndex={0}
      aria-label={`${title}: ${full(point.thisYear)}. List its documents`}
      data-drill={period}
      className="cursor-pointer outline-none [&:focus-visible>path]:stroke-ring [&:focus-visible>path]:stroke-[3px]"
      onClick={(event) => {
        // A mouse click doesn't focus an SVG element; focus it so focus can come back here.
        event.currentTarget.focus();
        selectMonth(period);
      }}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          selectMonth(period);
        }
      }}
    >
      <Rectangle {...props} />
    </g>
  );
}

/**
 * Monthly values for this period (bars) against the same months last year (line).
 *
 * With `period` (the range the data covers) the chart also marks partial months with a hatched
 * bar, prints the change on last year under each bar, and shows one bar per year when the range is
 * longer than 24 months. `renderTooltip` replaces the tooltip on hover or keyboard focus, and
 * `onSelect` is called when a bar is tapped or clicked (the bottom sheet on phones). With
 * `onSelectMonth`, each bar is a button that passes its `YYYY-MM` month (`from..to` for a year).
 */
export function TrendChart({
  data,
  height = 300,
  ariaLabel = "Monthly net revenue, this year compared with last year",
  format = "aed",
  period,
  renderTooltip,
  onSelect,
  onSelectMonth,
}: {
  data: TrendPoint[];
  height?: number;
  ariaLabel?: string;
  /** `aed` for money (the default), `qty` for quantities. */
  format?: "aed" | "qty";
  period?: { start: string; end: string };
  renderTooltip?: (bar: TrendBar) => ReactNode;
  onSelect?: (bar: TrendBar) => void;
  onSelectMonth?: (month: string) => void;
}) {
  const full = format === "qty" ? formatQty : formatAed;
  const compact = format === "qty" ? formatCompact : formatAedCompact;
  const hatchId = `trend-hatch-${useId().replace(/\W/g, "")}`;
  const bars: TrendBar[] | undefined = period
    ? rollUp(data, ["thisYear", "lastYear"] as const, period.start, period.end).map((point) => ({
        ...point,
        yoy: yoyChange(point.thisYear, point.lastYear),
      }))
    : undefined;
  const ticks = new Map<string, TickPoint>(bars?.map((bar) => [bar.month, bar]));
  const byKey = new Map(bars?.map((bar) => [bar.month, bar]));

  return (
    <div className="flex flex-col">
      <ChartContainer
        config={CONFIG}
        className="aspect-auto w-full"
        style={{ height }}
        // Buttons can't sit inside an image: a chart with selectable bars is a group.
        role={onSelectMonth ? "group" : "img"}
        aria-label={ariaLabel}
      >
        <ComposedChart data={bars ?? data} margin={{ top: 8, right: 8, left: 4, bottom: 0 }}>
          {bars && (
            <defs>
              <HatchPattern id={hatchId} color="var(--color-thisYear)" />
            </defs>
          )}
          <CartesianGrid vertical={false} strokeDasharray="3 3" />
          <XAxis
            dataKey="month"
            tickLine={false}
            axisLine={false}
            tickMargin={8}
            minTickGap={16}
            height={bars ? 44 : undefined}
            tick={bars ? <PeriodTick points={ticks} /> : undefined}
            tickFormatter={(month: string) => {
              const bar = byKey.get(month);
              return bar ? bucketTick(bar.bucket) : formatMonth(month, true);
            }}
          />
          <YAxis
            tickLine={false}
            axisLine={false}
            width={84}
            tickFormatter={(value: number) => compact(value)}
          />
          <ChartTooltip
            cursor={{ fill: "var(--muted)", opacity: 0.6 }}
            allowEscapeViewBox={renderTooltip ? { x: false, y: true } : undefined}
            wrapperStyle={renderTooltip ? { zIndex: 40 } : undefined}
            content={
              renderTooltip ? (
                (props) => {
                  const bar = props.active
                    ? (props.payload?.[0]?.payload as TrendBar | undefined)
                    : undefined;
                  return bar ? renderTooltip(bar) : null;
                }
              ) : (
                <ChartTooltipContent
                  valueFormatter={(value) => full(value)}
                  labelFormatter={(_, payload) => {
                    const point = payload?.[0]?.payload as Partial<TrendBar> | undefined;
                    return point?.bucket
                      ? bucketTitle(point.bucket)
                      : formatMonth(String(point?.month ?? ""));
                  }}
                />
              )
            }
          />
          <ChartLegend content={<ChartLegendContent />} />
          <Bar
            dataKey="thisYear"
            fill="var(--color-thisYear)"
            radius={[4, 4, 0, 0]}
            maxBarSize={36}
            className={onSelect ? "cursor-pointer" : undefined}
            // The tapped bar comes from the click itself: the chart's activeLabel still holds the
            // previously active bar on a touch tap.
            onClick={
              onSelect && bars
                ? (item) => {
                    const bar = byKey.get(String((item.payload as TrendBar | undefined)?.month ?? ""));
                    if (bar) onSelect(bar);
                  }
                : undefined
            }
            shape={
              onSelectMonth
                ? (props: BarShapeProps) => (
                    <SelectableBar {...props} selectMonth={onSelectMonth} full={full} />
                  )
                : undefined
            }
          >
            {bars?.map((bar) => (
              <Cell
                key={bar.month}
                fill={bar.bucket.partial ? `url(#${hatchId})` : "var(--color-thisYear)"}
                stroke={bar.bucket.partial ? "var(--color-thisYear)" : undefined}
                data-partial={bar.bucket.partial || undefined}
              />
            ))}
          </Bar>
          <Line
            dataKey="lastYear"
            type="monotone"
            stroke="var(--color-lastYear)"
            strokeWidth={2}
            dot={{ r: 3, fill: "var(--color-lastYear)", strokeWidth: 0 }}
            activeDot={{ r: 5 }}
          />
        </ComposedChart>
      </ChartContainer>
      {bars && <PartialNote buckets={bars.map((bar) => bar.bucket)} color="var(--chart-1)" />}
    </div>
  );
}
