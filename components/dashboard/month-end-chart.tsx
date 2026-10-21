"use client";

import type { ReactNode } from "react";
import { Bar, BarChart, CartesianGrid, Cell, XAxis, YAxis, type BarShapeProps } from "recharts";

import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from "@/components/ui/chart";
import { formatAed, formatAedCompact, formatMonth } from "@/lib/format";

import { SelectableBar } from "./selectable-bar";

export interface MonthEndPoint {
  /** `YYYY-MM`. */
  month: string;
  value: number;
  /** The current month: still receiving adjustments. Drawn lighter. */
  provisional?: boolean;
}

const CONFIG = { value: { label: "Closing value", color: "var(--chart-1)" } } satisfies ChartConfig;

/** "Sep 2026", or "Oct 2026 (provisional)". */
export function monthEndTitle(point: MonthEndPoint): string {
  return `${formatMonth(point.month)}${point.provisional ? " (provisional)" : ""}`;
}

/**
 * One bar per month-end; the provisional (current) month is drawn lighter.
 *
 * As on `TrendChart`, `renderTooltip` replaces the tooltip on hover or keyboard focus, `onSelect` is
 * called when a bar is tapped or clicked (the bottom sheet on phones), and with `onSelectBar` each
 * bar with a value is a button that passes its `YYYY-MM` month.
 */
export function MonthEndChart({
  data,
  ariaLabel,
  height = 300,
  renderTooltip,
  onSelect,
  onSelectBar,
}: {
  data: MonthEndPoint[];
  ariaLabel: string;
  height?: number;
  renderTooltip?: (point: MonthEndPoint) => ReactNode;
  onSelect?: (point: MonthEndPoint) => void;
  onSelectBar?: (month: string) => void;
}) {
  const byMonth = new Map(data.map((point) => [point.month, point]));
  return (
    <ChartContainer
      config={CONFIG}
      className="aspect-auto w-full"
      style={{ height }}
      // Buttons can't sit inside an image: a chart with selectable bars is a group.
      role={onSelectBar ? "group" : "img"}
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
          allowEscapeViewBox={renderTooltip ? { x: false, y: true } : undefined}
          wrapperStyle={renderTooltip ? { zIndex: 40 } : undefined}
          content={
            renderTooltip ? (
              (props) => {
                const point = props.active
                  ? byMonth.get(String(props.payload?.[0]?.payload?.month ?? ""))
                  : undefined;
                return point ? renderTooltip(point) : null;
              }
            ) : (
              <ChartTooltipContent
                valueFormatter={(value) => formatAed(value)}
                labelFormatter={(_, payload) => {
                  const point = payload?.[0]?.payload as MonthEndPoint | undefined;
                  return point ? monthEndTitle(point) : "";
                }}
              />
            )
          }
        />
        <Bar
          dataKey="value"
          fill="var(--color-value)"
          radius={[4, 4, 0, 0]}
          maxBarSize={28}
          className={onSelect ? "cursor-pointer" : undefined}
          // The tapped bar comes from the click itself: the chart's activeLabel still holds the
          // previously active bar on a touch tap.
          onClick={
            onSelect
              ? (item) => {
                  const point = byMonth.get(String((item.payload as MonthEndPoint | undefined)?.month ?? ""));
                  if (point) onSelect(point);
                }
              : undefined
          }
          shape={
            onSelectBar
              ? (props: BarShapeProps) => {
                  const point = byMonth.get(
                    String((props.payload as MonthEndPoint | undefined)?.month ?? ""),
                  );
                  return (
                    <SelectableBar
                      {...props}
                      select={onSelectBar}
                      period={point && point.value !== 0 ? point.month : null}
                      label={
                        point ? `${monthEndTitle(point)}: ${formatAed(point.value)}. List its items` : ""
                      }
                    />
                  );
                }
              : undefined
          }
        >
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
