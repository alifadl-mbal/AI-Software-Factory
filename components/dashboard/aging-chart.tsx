"use client";

import { Bar, BarChart, CartesianGrid, Cell, LabelList, ReferenceLine, XAxis, YAxis } from "recharts";

import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from "@/components/ui/chart";
import { useIsMobile } from "@/hooks/use-mobile";
import { AGING_BUCKETS } from "@/lib/aging";
import { formatAed, formatAedCompact } from "@/lib/format";

/** Buckets from this index on are more than about 90 days old and drawn in the warning colour. */
const OLD_FROM = AGING_BUCKETS.indexOf("3-6 M");

/**
 * Balances over the aging ladder, one column per bucket, always in ladder order. `values` has one
 * number per bucket. Older buckets are drawn in a second colour so the overdue part stands out.
 */
export function AgingChart({
  values,
  label,
  ariaLabel,
  height = 280,
}: {
  values: number[];
  /** Series name in the tooltip, e.g. "Outstanding". */
  label: string;
  ariaLabel: string;
  height?: number;
}) {
  const config = {
    value: { label, color: "var(--chart-1)" },
    old: { label: "3 months and older", color: "var(--chart-2)" },
  } satisfies ChartConfig;
  const data = AGING_BUCKETS.map((bucket, index) => ({ bucket, value: values[index] ?? 0 }));
  const hasNegative = data.some((point) => point.value < 0);
  // On phones seven value labels don't fit over the columns; the tooltip and the tables have them.
  const isMobile = useIsMobile();
  return (
    <ChartContainer
      config={config}
      className="aspect-auto w-full"
      style={{ height }}
      role="img"
      aria-label={ariaLabel}
    >
      <BarChart data={data} margin={{ top: isMobile ? 8 : 32, right: 4, left: 4, bottom: 0 }}>
        <CartesianGrid vertical={false} strokeDasharray="3 3" />
        <XAxis
          dataKey="bucket"
          tickLine={false}
          axisLine={false}
          tickMargin={8}
          interval={0}
          fontSize={isMobile ? 10 : 12}
        />
        <YAxis
          tickLine={false}
          axisLine={false}
          width={isMobile ? 56 : 72}
          fontSize={isMobile ? 10 : 12}
          tickFormatter={(value: number) => formatAedCompact(value)}
        />
        <ChartTooltip
          cursor={{ fill: "var(--muted)", opacity: 0.6 }}
          content={<ChartTooltipContent valueFormatter={(value) => formatAed(value)} />}
        />
        {hasNegative && <ReferenceLine y={0} stroke="var(--muted-foreground)" strokeOpacity={0.6} />}
        <Bar dataKey="value" radius={4} maxBarSize={56}>
          {data.map((point, index) => (
            <Cell key={point.bucket} fill={index >= OLD_FROM ? "var(--color-old)" : "var(--color-value)"} />
          ))}
          {!isMobile && (
            <LabelList
              dataKey="value"
              position="top"
              className="fill-foreground"
              fontSize={11}
              formatter={(value: unknown) => formatAedCompact(Number(value))}
            />
          )}
        </Bar>
      </BarChart>
    </ChartContainer>
  );
}
