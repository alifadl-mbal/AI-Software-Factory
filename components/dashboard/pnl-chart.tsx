"use client";

import { useId, type ReactNode } from "react";
import {
  Bar,
  CartesianGrid,
  Cell,
  ComposedChart,
  Line,
  ReferenceLine,
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
import { formatAed, formatAedCompact, formatMonth } from "@/lib/format";
import { bucketTick, bucketTitle, rollUp, yoyChange, type PeriodBucket } from "@/lib/periods";

import { HatchPattern, PartialNote, PeriodTick, type TickPoint } from "./period-axis";
import { SelectableBar } from "./selectable-bar";

export interface PnlPoint {
  /** `YYYY-MM`. */
  month: string;
  revenue: number;
  grossProfit: number;
  netProfit: number;
  /** Revenue of the same days a year earlier; needed with `period` for the change under each bar. */
  lastYearRevenue?: number;
}

/** One bar of a chart with a `period`: a month, or a year for ranges over 24 months. */
export interface PnlBar extends Required<PnlPoint> {
  bucket: PeriodBucket;
  yoy: number | null;
}

const CONFIG = {
  revenue: { label: "Revenue", color: "var(--chart-1)" },
  grossProfit: { label: "Gross profit", color: "var(--chart-2)" },
  netProfit: { label: "Net profit", color: "var(--chart-3)" },
} satisfies ChartConfig;

/** A bar worth opening: anything posted to revenue or profit. */
function hasFigures(bar: PnlBar): boolean {
  return bar.revenue !== 0 || bar.netProfit !== 0 || bar.grossProfit !== 0;
}

const SUMMED = ["revenue", "grossProfit", "netProfit", "lastYearRevenue"] as const;

/**
 * Monthly revenue (bars) with gross and net profit (lines). Losses dip below the zero line.
 *
 * With `period` (the range the data covers) partial months get a hatched bar, the revenue change on
 * last year shows under each bar, and ranges over 24 months show one bar per year. As on
 * `TrendChart`, `renderTooltip` replaces the tooltip on hover or keyboard focus, `onSelect` is
 * called when a bar is tapped or clicked (the bottom sheet on phones), and with `onSelectBar` each
 * bar is a button that passes its bucket key (`YYYY-MM`, or `YYYY` for a year). All three need
 * `period`.
 */
export function PnlChart({
  data,
  height = 300,
  showGrossProfit = true,
  period,
  renderTooltip,
  onSelect,
  onSelectBar,
}: {
  data: PnlPoint[];
  height?: number;
  /** False for a lighter chart of revenue and net profit only. */
  showGrossProfit?: boolean;
  period?: { start: string; end: string };
  renderTooltip?: (bar: PnlBar) => ReactNode;
  onSelect?: (bar: PnlBar) => void;
  onSelectBar?: (key: string) => void;
}) {
  const hatchId = `pnl-hatch-${useId().replace(/\W/g, "")}`;
  const bars: PnlBar[] | undefined = period
    ? rollUp(
        data.map((point) => ({ ...point, lastYearRevenue: point.lastYearRevenue ?? 0 })),
        SUMMED,
        period.start,
        period.end,
      ).map((point) => ({ ...point, yoy: yoyChange(point.revenue, point.lastYearRevenue) }))
    : undefined;
  const points: PnlPoint[] = bars ?? data;
  const ticks = new Map<string, TickPoint>(bars?.map((bar) => [bar.month, bar]));
  const byKey = new Map(bars?.map((bar) => [bar.month, bar]));
  const selectable = onSelectBar && bars ? onSelectBar : undefined;
  const hasLoss = points.some((point) => point.netProfit < 0 || (showGrossProfit && point.grossProfit < 0));
  return (
    <div className="flex flex-col">
      <ChartContainer
        config={CONFIG}
        className="aspect-auto w-full"
        style={{ height }}
        // Buttons can't sit inside an image: a chart with selectable bars is a group.
        role={selectable ? "group" : "img"}
        aria-label={`Monthly revenue${showGrossProfit ? ", gross profit" : ""} and net profit${
          selectable ? ". Select a month's bar to open its P&L" : ""
        }`}
      >
        <ComposedChart data={points} margin={{ top: 8, right: 8, left: 4, bottom: 0 }}>
          {bars && (
            <defs>
              <HatchPattern id={hatchId} color="var(--color-revenue)" />
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
              const bar = ticks.get(month);
              return bar ? bucketTick(bar.bucket) : formatMonth(month, true);
            }}
          />
          <YAxis
            tickLine={false}
            axisLine={false}
            width={84}
            tickFormatter={(value: number) => formatAedCompact(value)}
          />
          <ChartTooltip
            cursor={{ fill: "var(--muted)", opacity: 0.6 }}
            allowEscapeViewBox={renderTooltip ? { x: false, y: true } : undefined}
            wrapperStyle={renderTooltip ? { zIndex: 40 } : undefined}
            content={
              renderTooltip && bars ? (
                (props) => {
                  const bar = props.active
                    ? byKey.get(String(props.payload?.[0]?.payload?.month ?? ""))
                    : undefined;
                  return bar ? renderTooltip(bar) : null;
                }
              ) : (
                <ChartTooltipContent
                  valueFormatter={(value) => formatAed(value)}
                  labelFormatter={(_, payload) => {
                    const point = payload?.[0]?.payload as Partial<PnlBar> | undefined;
                    return point?.bucket
                      ? bucketTitle(point.bucket)
                      : formatMonth(String(point?.month ?? ""));
                  }}
                />
              )
            }
          />
          <ChartLegend content={<ChartLegendContent />} />
          {hasLoss && <ReferenceLine y={0} stroke="var(--muted-foreground)" strokeOpacity={0.6} />}
          <Bar
            dataKey="revenue"
            fill="var(--color-revenue)"
            radius={[4, 4, 0, 0]}
            maxBarSize={36}
            className={onSelect ? "cursor-pointer" : undefined}
            // The tapped bar comes from the click itself: the chart's activeLabel still holds the
            // previously active bar on a touch tap.
            onClick={
              onSelect && bars
                ? (item) => {
                    const bar = byKey.get(String((item.payload as PnlBar | undefined)?.month ?? ""));
                    if (bar) onSelect(bar);
                  }
                : undefined
            }
            shape={
              selectable
                ? (props: BarShapeProps) => {
                    const bar = byKey.get(String((props.payload as PnlBar | undefined)?.month ?? ""));
                    return (
                      <SelectableBar
                        {...props}
                        select={selectable}
                        period={bar && hasFigures(bar) ? bar.month : null}
                        label={
                          bar
                            ? `${bucketTitle(bar.bucket)}: revenue ${formatAed(bar.revenue)}, net profit ${formatAed(bar.netProfit)}. Open its P&L`
                            : ""
                        }
                      />
                    );
                  }
                : undefined
            }
          >
            {bars?.map((bar) => (
              <Cell
                key={bar.month}
                fill={bar.bucket.partial ? `url(#${hatchId})` : "var(--color-revenue)"}
                stroke={bar.bucket.partial ? "var(--color-revenue)" : undefined}
                data-partial={bar.bucket.partial || undefined}
              />
            ))}
          </Bar>
          {showGrossProfit && (
            <Line
              dataKey="grossProfit"
              type="monotone"
              stroke="var(--color-grossProfit)"
              strokeWidth={2}
              dot={{ r: 3, fill: "var(--color-grossProfit)", strokeWidth: 0 }}
              activeDot={{ r: 5 }}
            />
          )}
          <Line
            dataKey="netProfit"
            type="monotone"
            stroke="var(--color-netProfit)"
            strokeWidth={2}
            strokeDasharray="5 3"
            dot={{ r: 3, fill: "var(--color-netProfit)", strokeWidth: 0 }}
            activeDot={{ r: 5 }}
          />
        </ComposedChart>
      </ChartContainer>
      {bars && (
        <PartialNote
          buckets={bars.map((bar) => bar.bucket)}
          color="var(--chart-1)"
          measure="revenue change on last year"
        />
      )}
    </div>
  );
}
