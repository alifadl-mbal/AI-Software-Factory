"use client";

import { ArrowDownRight, ArrowUpRight, Minus } from "lucide-react";
import { Area, AreaChart, YAxis } from "recharts";

import { Card, CardContent } from "@/components/ui/card";
import { ChartContainer, type ChartConfig } from "@/components/ui/chart";
import { formatDeltaPct, formatDeltaPp, pctChange } from "@/lib/format";
import { cn } from "@/lib/utils";

import { formatValue, type ValueFormat } from "./value-format";

export interface KpiCardProps {
  label: string;
  value: number | null;
  /** Same period last year; drives the delta. */
  previous?: number | null;
  /** `aedCompact` on cards; the full value shows in the title tooltip. */
  format?: ValueFormat;
  /**
   * `pct`: relative change (+12.3%). `pp`: difference in percentage points, for ratios like
   * margin %. Changes are sign-aware: a more negative returns value counts as a fall.
   */
  delta?: "pct" | "pp";
  /** Monthly values for the sparkline. */
  spark?: number[];
  /** One short line under the value. */
  hint?: string;
  /** For costs: a rise is coloured as bad and a fall as good. The arrow still shows the direction. */
  lowerIsBetter?: boolean;
}

const SPARK_CONFIG = { value: { label: "Value", color: "var(--chart-1)" } } satisfies ChartConfig;

/** A headline figure with its change vs the same period last year and a sparkline. */
export function KpiCard({
  label,
  value,
  previous,
  format = "aedCompact",
  delta = "pct",
  spark,
  hint,
  lowerIsBetter = false,
}: KpiCardProps) {
  const change =
    previous === undefined
      ? undefined
      : delta === "pp"
        ? value === null || previous === null
          ? null
          : value - previous
        : pctChange(value, previous);
  const direction =
    change === undefined || change === null
      ? "none"
      : change > 0.0005
        ? "up"
        : change < -0.0005
          ? "down"
          : "flat";
  const good = lowerIsBetter ? direction === "down" : direction === "up";
  const bad = lowerIsBetter ? direction === "up" : direction === "down";
  const fullFormat = format === "aedCompact" ? "aed" : format;
  const Arrow = direction === "up" ? ArrowUpRight : direction === "down" ? ArrowDownRight : Minus;
  const changeText =
    change === undefined || change === null
      ? null
      : delta === "pp"
        ? formatDeltaPp(change)
        : formatDeltaPct(change);

  return (
    <Card className="gap-0 py-0" data-testid="kpi-card">
      <CardContent className="flex flex-col gap-2 p-4 sm:gap-3 sm:p-5">
        <p className="text-sm font-medium text-muted-foreground">{label}</p>
        <p
          className="tabular text-xl font-semibold tracking-tight text-foreground sm:text-2xl"
          title={formatValue(fullFormat, value)}
          data-testid="kpi-value"
        >
          {formatValue(format, value)}
        </p>
        <div className="flex min-h-5 flex-wrap items-center gap-x-2 gap-y-1 text-xs">
          {changeText !== null ? (
            <span
              className={cn(
                "tabular inline-flex items-center gap-0.5 rounded-md px-1.5 py-0.5 font-medium",
                good && "bg-positive/12 text-positive",
                bad && "bg-negative/12 text-negative",
                direction === "flat" && "bg-muted text-muted-foreground",
              )}
            >
              <Arrow className="size-3.5" aria-hidden />
              <span>
                <span className="sr-only">
                  {direction === "up" ? "Up " : direction === "down" ? "Down " : ""}
                </span>
                {changeText}
              </span>
            </span>
          ) : previous !== undefined ? (
            <span className="text-muted-foreground">No comparison</span>
          ) : null}
          {previous !== undefined && (
            <span
              className="truncate text-muted-foreground"
              title={`Last year: ${formatValue(fullFormat, previous)}`}
            >
              vs {formatValue(format, previous)}
              <span className="sr-only"> last year</span>
            </span>
          )}
        </div>
        {hint && <p className="-mt-1 text-xs text-muted-foreground">{hint}</p>}
      </CardContent>
      {spark && spark.length > 1 && (
        <ChartContainer config={SPARK_CONFIG} className="aspect-auto h-12 w-full" aria-hidden>
          <AreaChart
            data={spark.map((point, index) => ({ index, value: point }))}
            margin={{ top: 4, bottom: 0, left: 0, right: 0 }}
            // Decorative: the trend is in the monthly chart; keep it out of the tab order.
            accessibilityLayer={false}
          >
            <defs>
              <linearGradient id={`spark-${label.replace(/\W/g, "")}`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="var(--color-value)" stopOpacity={0.25} />
                <stop offset="100%" stopColor="var(--color-value)" stopOpacity={0} />
              </linearGradient>
            </defs>
            <YAxis hide domain={["dataMin", "dataMax"]} />
            <Area
              dataKey="value"
              type="monotone"
              stroke="var(--color-value)"
              strokeWidth={2}
              fill={`url(#spark-${label.replace(/\W/g, "")})`}
              isAnimationActive={false}
              dot={false}
            />
          </AreaChart>
        </ChartContainer>
      )}
    </Card>
  );
}
