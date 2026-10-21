"use client";

import {
  Bar,
  CartesianGrid,
  ComposedChart,
  Line,
  Rectangle,
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
import { formatAed, formatAedCompact, formatCompact, formatMonth, formatQty } from "@/lib/format";

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

/** A bar that is also a button: a click, Enter or Space selects its month. */
function SelectableBar({
  selectMonth,
  full,
  ...props
}: BarShapeProps & { selectMonth: (month: string) => void; full: (value: number) => string }) {
  const point = props.payload as TrendPoint;
  if (!point.thisYear) return <Rectangle {...props} />;
  return (
    <g
      role="button"
      tabIndex={0}
      aria-label={`${formatMonth(point.month)}: ${full(point.thisYear)}. List its documents`}
      data-drill={point.month}
      className="cursor-pointer outline-none [&:focus-visible>path]:stroke-ring [&:focus-visible>path]:stroke-[3px]"
      onClick={(event) => {
        // A mouse click doesn't focus an SVG element; focus it so focus can come back here.
        event.currentTarget.focus();
        selectMonth(point.month);
      }}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          selectMonth(point.month);
        }
      }}
    >
      <Rectangle {...props} />
    </g>
  );
}

/**
 * Monthly values for this period (bars) against the same months last year (line). With
 * `onSelectMonth`, each bar is a button that passes its `YYYY-MM` month.
 */
export function TrendChart({
  data,
  height = 300,
  ariaLabel = "Monthly net revenue, this year compared with last year",
  format = "aed",
  onSelectMonth,
}: {
  data: TrendPoint[];
  height?: number;
  ariaLabel?: string;
  /** `aed` for money (the default), `qty` for quantities. */
  format?: "aed" | "qty";
  onSelectMonth?: (month: string) => void;
}) {
  const full = format === "qty" ? formatQty : formatAed;
  const compact = format === "qty" ? formatCompact : formatAedCompact;
  return (
    <ChartContainer
      config={CONFIG}
      className="aspect-auto w-full"
      style={{ height }}
      // Buttons can't sit inside an image: a chart with selectable bars is a group.
      role={onSelectMonth ? "group" : "img"}
      aria-label={ariaLabel}
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
          tickFormatter={(value: number) => compact(value)}
        />
        <ChartTooltip
          cursor={{ fill: "var(--muted)", opacity: 0.6 }}
          content={
            <ChartTooltipContent
              valueFormatter={(value) => full(value)}
              labelFormatter={(_, payload) => formatMonth(String(payload?.[0]?.payload?.month ?? ""))}
            />
          }
        />
        <ChartLegend content={<ChartLegendContent />} />
        <Bar
          dataKey="thisYear"
          fill="var(--color-thisYear)"
          radius={[4, 4, 0, 0]}
          maxBarSize={36}
          shape={
            onSelectMonth
              ? (props: BarShapeProps) => <SelectableBar {...props} selectMonth={onSelectMonth} full={full} />
              : undefined
          }
        />
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
