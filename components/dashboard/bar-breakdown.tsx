"use client";

import { Bar, BarChart, CartesianGrid, LabelList, ReferenceLine, XAxis, YAxis } from "recharts";

import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from "@/components/ui/chart";
import { useIsMobile } from "@/hooks/use-mobile";
import { formatAed, formatAedCompact } from "@/lib/format";

export interface BreakdownPoint {
  label: string;
  value: number;
}

const CONFIG = { value: { label: "Net revenue", color: "var(--chart-1)" } } satisfies ChartConfig;

const ROW_HEIGHT = 34;
const LABEL_OFFSET = 8;

/** The X domain always spans zero, so negative bars grow left from a visible baseline. */
const DOMAIN: [(dataMin: number) => number, (dataMax: number) => number] = [
  (dataMin) => Math.min(0, dataMin),
  (dataMax) => Math.max(0, dataMax),
];

/**
 * Where a bar's value label goes. Positive bars print it just past their right end. Negative bars
 * print it just right of the zero line, inside the plot area: past their left end it would run
 * into the category label on the Y axis.
 */
export function valueLabelPlacement(
  { x, width }: { x: number; width: number },
  offset = LABEL_OFFSET,
): { x: number; textAnchor: "start" } {
  // Recharts may hand negative bars a negative width, so take the right edge explicitly: the bar's
  // end for a positive value, the zero line for a negative one.
  return { x: Math.max(x, x + width) + offset, textAnchor: "start" };
}

interface LabelProps {
  x?: number | string;
  y?: number | string;
  width?: number | string;
  height?: number | string;
  value?: number | string;
}

function ValueLabel({ x = 0, y = 0, width = 0, height = 0, value = 0 }: LabelProps) {
  const placement = valueLabelPlacement({ x: Number(x), width: Number(width) });
  return (
    <text
      x={placement.x}
      y={Number(y) + Number(height) / 2}
      textAnchor={placement.textAnchor}
      dominantBaseline="central"
      className="fill-foreground"
      fontSize={12}
      data-testid="bar-value-label"
    >
      {formatAedCompact(Number(value))}
    </text>
  );
}

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
  const hasNegative = data.some((point) => point.value < 0);
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
        <XAxis type="number" hide domain={DOMAIN} />
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
        {hasNegative && <ReferenceLine x={0} stroke="var(--muted-foreground)" strokeOpacity={0.6} />}
        <Bar dataKey="value" fill="var(--color-value)" radius={4} maxBarSize={22}>
          <LabelList dataKey="value" content={<ValueLabel />} />
        </Bar>
      </BarChart>
    </ChartContainer>
  );
}
