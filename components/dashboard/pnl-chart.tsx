"use client";

import { useId } from "react";
import { Bar, CartesianGrid, Cell, ComposedChart, Line, ReferenceLine, XAxis, YAxis } from "recharts";

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

export interface PnlPoint {
  /** `YYYY-MM`. */
  month: string;
  revenue: number;
  grossProfit: number;
  netProfit: number;
  /** Revenue of the same days a year earlier; needed with `period` for the change under each bar. */
  lastYearRevenue?: number;
}

interface PnlBar extends Required<PnlPoint> {
  bucket: PeriodBucket;
  yoy: number | null;
}

const CONFIG = {
  revenue: { label: "Revenue", color: "var(--chart-1)" },
  grossProfit: { label: "Gross profit", color: "var(--chart-2)" },
  netProfit: { label: "Net profit", color: "var(--chart-3)" },
} satisfies ChartConfig;

const SUMMED = ["revenue", "grossProfit", "netProfit", "lastYearRevenue"] as const;

/**
 * Monthly revenue (bars) with gross and net profit (lines). Losses dip below the zero line.
 *
 * With `period` (the range the data covers) partial months get a hatched bar, the revenue change on
 * last year shows under each bar, and ranges over 24 months show one bar per year.
 */
export function PnlChart({
  data,
  height = 300,
  showGrossProfit = true,
  period,
}: {
  data: PnlPoint[];
  height?: number;
  /** False for a lighter chart of revenue and net profit only. */
  showGrossProfit?: boolean;
  period?: { start: string; end: string };
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
  const hasLoss = points.some((point) => point.netProfit < 0 || (showGrossProfit && point.grossProfit < 0));
  return (
    <div className="flex flex-col">
      <ChartContainer
        config={CONFIG}
        className="aspect-auto w-full"
        style={{ height }}
        role="img"
        aria-label={`Monthly revenue${showGrossProfit ? ", gross profit" : ""} and net profit`}
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
            content={
              <ChartTooltipContent
                valueFormatter={(value) => formatAed(value)}
                labelFormatter={(_, payload) => {
                  const point = payload?.[0]?.payload as Partial<PnlBar> | undefined;
                  return point?.bucket ? bucketTitle(point.bucket) : formatMonth(String(point?.month ?? ""));
                }}
              />
            }
          />
          <ChartLegend content={<ChartLegendContent />} />
          {hasLoss && <ReferenceLine y={0} stroke="var(--muted-foreground)" strokeOpacity={0.6} />}
          <Bar dataKey="revenue" fill="var(--color-revenue)" radius={[4, 4, 0, 0]} maxBarSize={36}>
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
