"use client";

import { Bar, BarChart, CartesianGrid, Cell, XAxis, YAxis } from "recharts";

import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from "@/components/ui/chart";
import { formatAed, formatAedCompact, formatMonth } from "@/lib/format";

export interface MonthEndPoint {
  /** `YYYY-MM`. */
  month: string;
  value: number;
  /** The current month: still receiving adjustments. Drawn lighter. */
  provisional?: boolean;
}

const CONFIG = { value: { label: "Closing value", color: "var(--chart-1)" } } satisfies ChartConfig;

/** One bar per month-end; the provisional (current) month is drawn lighter. */
export function MonthEndChart({
  data,
  ariaLabel,
  height = 300,
}: {
  data: MonthEndPoint[];
  ariaLabel: string;
  height?: number;
}) {
  return (
    <ChartContainer
      config={CONFIG}
      className="aspect-auto w-full"
      style={{ height }}
      role="img"
      aria-label={ariaLabel}
    >
      <BarChart data={data} margin={{ top: 8, right: 8, left: 4, bottom: 0 }}>
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
              labelFormatter={(_, payload) => {
                const point = payload?.[0]?.payload as MonthEndPoint | undefined;
                if (!point) return "";
                return `${formatMonth(point.month)}${point.provisional ? " (provisional)" : ""}`;
              }}
            />
          }
        />
        <Bar dataKey="value" fill="var(--color-value)" radius={[4, 4, 0, 0]} maxBarSize={28}>
          {data.map((point) => (
            <Cell
              key={point.month}
              fill="var(--color-value)"
              fillOpacity={point.provisional ? 0.4 : 1}
              data-testid={point.provisional ? "provisional-bar" : undefined}
            />
          ))}
        </Bar>
      </BarChart>
    </ChartContainer>
  );
}
