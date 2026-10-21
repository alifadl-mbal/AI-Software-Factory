"use client";

import type { ReactNode } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  LabelList,
  ReferenceLine,
  XAxis,
  YAxis,
  type BarShapeProps,
} from "recharts";

import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from "@/components/ui/chart";
import { useIsMobile } from "@/hooks/use-mobile";
import { AGING_BUCKETS } from "@/lib/aging";
import { formatAed, formatAedCompact } from "@/lib/format";

import { SelectableBar } from "./selectable-bar";

/** Buckets from this index on are more than about 90 days old and drawn in the warning colour. */
const OLD_FROM = AGING_BUCKETS.indexOf("3-6 M");

/** One column: a bucket of the ladder and its balance. */
export interface AgingPoint {
  bucket: string;
  /** Ladder index, 0 = `<30 D`. */
  index: number;
  value: number;
}

/**
 * Balances over the aging ladder, one column per bucket, always in ladder order. `values` has one
 * number per bucket. Older buckets are drawn in a second colour so the overdue part stands out.
 *
 * As on `TrendChart`, `renderTooltip` replaces the tooltip on hover or keyboard focus, `onSelect` is
 * called when a column is tapped or clicked (the bottom sheet on phones), and with `onSelectBar`
 * each column with a balance is a button that passes `drillValue(index)`, which also marks it as
 * `data-drill` for focus to return to.
 */
export function AgingChart({
  values,
  label,
  ariaLabel,
  height = 280,
  renderTooltip,
  onSelect,
  onSelectBar,
  drillValue = String,
}: {
  values: number[];
  /** Series name in the tooltip, e.g. "Outstanding". */
  label: string;
  ariaLabel: string;
  height?: number;
  renderTooltip?: (point: AgingPoint) => ReactNode;
  onSelect?: (point: AgingPoint) => void;
  onSelectBar?: (value: string) => void;
  /** What selecting the column at a ladder index opens; by default the index. */
  drillValue?: (index: number) => string;
}) {
  const config = {
    value: { label, color: "var(--chart-1)" },
    old: { label: "3 months and older", color: "var(--chart-2)" },
  } satisfies ChartConfig;
  const data: AgingPoint[] = AGING_BUCKETS.map((bucket, index) => ({
    bucket,
    index,
    value: values[index] ?? 0,
  }));
  const byBucket = new Map(data.map((point) => [point.bucket, point]));
  const hasNegative = data.some((point) => point.value < 0);
  // On phones seven value labels don't fit over the columns; the tooltip and the tables have them.
  const isMobile = useIsMobile();
  return (
    <ChartContainer
      config={config}
      className="aspect-auto w-full"
      style={{ height }}
      // Buttons can't sit inside an image: a chart with selectable columns is a group.
      role={onSelectBar ? "group" : "img"}
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
          allowEscapeViewBox={renderTooltip ? { x: false, y: true } : undefined}
          wrapperStyle={renderTooltip ? { zIndex: 40 } : undefined}
          content={
            renderTooltip ? (
              (props) => {
                const point = props.active
                  ? byBucket.get(String(props.payload?.[0]?.payload?.bucket ?? ""))
                  : undefined;
                return point ? renderTooltip(point) : null;
              }
            ) : (
              <ChartTooltipContent valueFormatter={(value) => formatAed(value)} />
            )
          }
        />
        {hasNegative && <ReferenceLine y={0} stroke="var(--muted-foreground)" strokeOpacity={0.6} />}
        <Bar
          dataKey="value"
          radius={4}
          maxBarSize={56}
          className={onSelect ? "cursor-pointer" : undefined}
          // The tapped column comes from the click itself, as on the trend charts.
          onClick={
            onSelect
              ? (item) => {
                  const point = byBucket.get(String((item.payload as AgingPoint | undefined)?.bucket ?? ""));
                  if (point) onSelect(point);
                }
              : undefined
          }
          shape={
            onSelectBar
              ? (props: BarShapeProps) => {
                  const point = byBucket.get(String((props.payload as AgingPoint | undefined)?.bucket ?? ""));
                  return (
                    <SelectableBar
                      {...props}
                      select={onSelectBar}
                      period={point && point.value !== 0 ? drillValue(point.index) : null}
                      label={point ? `${point.bucket}: ${formatAed(point.value)}. List its accounts` : ""}
                    />
                  );
                }
              : undefined
          }
        >
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
