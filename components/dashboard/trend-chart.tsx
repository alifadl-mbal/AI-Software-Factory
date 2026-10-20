"use client";

import { Bar, CartesianGrid, ComposedChart, Line, XAxis, YAxis } from "recharts";

import {
  ChartContainer,
  ChartLegend,
  ChartLegendContent,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart";
import { formatAed, formatAedCompact, formatMonth } from "@/lib/format";

export interface TrendPoint {
  /** `YYYY-MM`. */
  month: string;
  thisYear: number;
  lastYear: number;
}

const CONFIG = {
  thisYear: { label: "This year", color: "var(--chart-1)" },
  lastYear: { label: "Last year", color: "var(--chart-2)" },
} satisfies ChartConfig;

/** Monthly values for this period (bars) against the same months last year (line). */
export function TrendChart({ data, height = 300 }: { data: TrendPoint[]; height?: number }) {
  return (
    <ChartContainer
      config={CONFIG}
      className="aspect-auto w-full"
      style={{ height }}
      role="img"
      aria-label="Monthly net revenue, this year compared with last year"
    >
      <ComposedChart data={data} margin={{ top: 8, right: 8, left: 4, bottom: 0 }}>
        <CartesianGrid vertical={false} strokeDasharray="3 3" />
        <XAxis
          dataKey="month"
          tickLine={false}
          axisLine={false}
          tickMargin={8}
          minTickGap={16}
          tickFormatter={(month: string) => formatMonth(month, true)}
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
              labelFormatter={(_, payload) => formatMonth(String(payload?.[0]?.payload?.month ?? ""))}
            />
          }
        />
        <ChartLegend content={<ChartLegendContent />} />
        <Bar dataKey="thisYear" fill="var(--color-thisYear)" radius={[4, 4, 0, 0]} maxBarSize={36} />
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
  );
}
