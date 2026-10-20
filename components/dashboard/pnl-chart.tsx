"use client";

import { Bar, CartesianGrid, ComposedChart, Line, ReferenceLine, XAxis, YAxis } from "recharts";

import {
  ChartContainer,
  ChartLegend,
  ChartLegendContent,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart";
import { formatAed, formatAedCompact, formatMonth } from "@/lib/format";

export interface PnlPoint {
  /** `YYYY-MM`. */
  month: string;
  revenue: number;
  grossProfit: number;
  netProfit: number;
}

const CONFIG = {
  revenue: { label: "Revenue", color: "var(--chart-1)" },
  grossProfit: { label: "Gross profit", color: "var(--chart-2)" },
  netProfit: { label: "Net profit", color: "var(--chart-3)" },
} satisfies ChartConfig;

/** Monthly revenue (bars) with gross and net profit (lines). Losses dip below the zero line. */
export function PnlChart({ data, height = 300 }: { data: PnlPoint[]; height?: number }) {
  const hasLoss = data.some((point) => point.netProfit < 0 || point.grossProfit < 0);
  return (
    <ChartContainer
      config={CONFIG}
      className="aspect-auto w-full"
      style={{ height }}
      role="img"
      aria-label="Monthly revenue, gross profit and net profit"
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
        {hasLoss && <ReferenceLine y={0} stroke="var(--muted-foreground)" strokeOpacity={0.6} />}
        <Bar dataKey="revenue" fill="var(--color-revenue)" radius={[4, 4, 0, 0]} maxBarSize={36} />
        <Line
          dataKey="grossProfit"
          type="monotone"
          stroke="var(--color-grossProfit)"
          strokeWidth={2}
          dot={{ r: 3, fill: "var(--color-grossProfit)", strokeWidth: 0 }}
          activeDot={{ r: 5 }}
        />
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
  );
}
