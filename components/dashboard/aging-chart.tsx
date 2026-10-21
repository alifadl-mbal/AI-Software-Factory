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

/** One column: its bucket label, its 1-based position on the ladder and its value. */
export interface AgingPoint {
  bucket: string;
  /** 1 = `<30 D` … 7 = `2+ Y`, as the order-age SQL numbers them. */
  index: number;
  value: number;
}

/**
 * Balances over the aging ladder, one column per bucket, always in ladder order. `values` has one
 * number per bucket. Older buckets are drawn in a second colour so the overdue part stands out.
 *
 * `renderTooltip` replaces the tooltip on hover or keyboard focus, `onSelect` is called when a
 * column is tapped or clicked (the bottom sheet on phones), and with `onSelectBucket` each column
 * with a value is a button that passes its 1-based `index` as text.
 */
export function AgingChart({
  values,
  label,
  ariaLabel,
  height = 280,
  renderTooltip,
  onSelect,
  onSelectBucket,
  selectHint = "List its orders",
}: {
  values: number[];
  /** Series name in the tooltip, e.g. "Outstanding". */
  label: string;
  ariaLabel: string;
  height?: number;
  renderTooltip?: (point: AgingPoint) => ReactNode;
  onSelect?: (point: AgingPoint) => void;
  onSelectBucket?: (index: string) => void;
  /** What selecting a column does, for its accessible name. */
  selectHint?: string;
}) {
  const config = {
    value: { label, color: "var(--chart-1)" },
    old: { label: "3 months and older", color: "var(--chart-2)" },
  } satisfies ChartConfig;
  const data: AgingPoint[] = AGING_BUCKETS.map((bucket, index) => ({
    bucket,
    index: index + 1,
    value: values[index] ?? 0,
  }));
  const hasNegative = data.some((point) => point.value < 0);
  // On phones seven value labels don't fit over the columns; the tooltip and the tables have them.
  const isMobile = useIsMobile();
  return (
    <ChartContainer
      config={config}
      className="aspect-auto w-full"
      style={{ height }}
      // Buttons can't sit inside an image: a chart with selectable columns is a group.
      role={onSelectBucket ? "group" : "img"}
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
                  ? (props.payload?.[0]?.payload as AgingPoint | undefined)
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
          // The tapped column comes from the click itself, as in TrendChart.
          onClick={
            onSelect
              ? (_, index) => {
                  const point = data[index];
                  if (point) onSelect(point);
                }
              : undefined
          }
          shape={
            onSelectBucket
              ? (props: BarShapeProps) => {
                  const point = props.payload as AgingPoint;
                  return (
                    <SelectableBar
                      {...props}
                      select={onSelectBucket}
                      period={point.value ? String(point.index) : null}
                      label={`${point.bucket}: ${formatAed(point.value)}. ${selectHint}`}
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
