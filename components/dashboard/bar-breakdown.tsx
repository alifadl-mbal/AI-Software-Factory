"use client";

import { Bar, BarChart, CartesianGrid, LabelList, XAxis, YAxis } from "recharts";

import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from "@/components/ui/chart";
import { useIsMobile } from "@/hooks/use-mobile";
import { formatAed, formatAedCompact } from "@/lib/format";

export interface BreakdownPoint {
  label: string;
  value: number;
}

const CONFIG = { value: { label: "Net revenue", color: "var(--chart-1)" } } satisfies ChartConfig;

const ROW_HEIGHT = 34;

/** Ranked horizontal bars, one per label, with the compact value printed at the end of each bar. */
export function BarBreakdown({
  data,
  label = "Net revenue",
  ariaLabel,
}: {
  data: BreakdownPoint[];
  label?: string;
  ariaLabel: string;
}) {
  const config = { value: { ...CONFIG.value, label } } satisfies ChartConfig;
  const isMobile = useIsMobile();
  const longest = Math.max(...data.map((point) => point.label.length), 4);
  return (
    <ChartContainer
      config={config}
      className="aspect-auto w-full"
      style={{ height: Math.max(data.length * ROW_HEIGHT + 16, 120) }}
      role="img"
      aria-label={ariaLabel}
    >
      <BarChart
        data={data}
        layout="vertical"
        margin={{ top: 0, right: 88, left: 0, bottom: 0 }}
        barCategoryGap={6}
      >
        <CartesianGrid horizontal={false} strokeDasharray="3 3" />
        <XAxis type="number" hide />
        <YAxis
          type="category"
          dataKey="label"
          tickLine={false}
          axisLine={false}
          width={Math.min(Math.max(longest * 7 + 12, 96), isMobile ? 120 : 190)}
          tickFormatter={(value: string) => (value.length > 26 ? `${value.slice(0, 25)}…` : value)}
          interval={0}
        />
        <ChartTooltip
          cursor={{ fill: "var(--muted)", opacity: 0.6 }}
          content={<ChartTooltipContent valueFormatter={(value) => formatAed(value)} />}
        />
        <Bar dataKey="value" fill="var(--color-value)" radius={4} maxBarSize={22}>
          <LabelList
            dataKey="value"
            position="right"
            offset={8}
            className="fill-foreground"
            fontSize={12}
            formatter={(value: unknown) => formatAedCompact(Number(value))}
          />
        </Bar>
      </BarChart>
    </ChartContainer>
  );
}
