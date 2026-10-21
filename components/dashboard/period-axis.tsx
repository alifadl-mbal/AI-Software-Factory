"use client";

import { useId } from "react";

import { formatDeltaPct } from "@/lib/format";
import { bucketTick, partialLabel, type PeriodBucket } from "@/lib/periods";

/**
 * Shared parts of the period charts (Sales monthly, Finance P&L): the hatched fill of a partial
 * bar, the axis tick with the year-on-year change under it, and the note that explains the hatch.
 */

/** Diagonal stripes over a light fill of `color`, for a bar the range only partly covers. */
export function HatchPattern({ id, color }: { id: string; color: string }) {
  return (
    <pattern id={id} width={6} height={6} patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
      <rect width={6} height={6} fill={color} fillOpacity={0.3} />
      <line x1={0} y1={0} x2={0} y2={6} stroke={color} strokeWidth={3} />
    </pattern>
  );
}

export interface TickPoint {
  bucket: PeriodBucket;
  /** Fraction; `null` shows "—". */
  yoy: number | null;
}

interface TickProps {
  x?: number | string;
  y?: number | string;
  payload?: { value?: string };
  points: ReadonlyMap<string, TickPoint>;
}

/**
 * Two lines under each bar: the period (`Oct 26`, or `1–21 Oct` when partial) and its change on
 * last year, green up, red down, with an arrow so colour is never the only cue.
 */
export function PeriodTick({ x = 0, y = 0, payload, points }: TickProps) {
  const point = payload?.value === undefined ? undefined : points.get(payload.value);
  if (!point) return null;
  const { yoy } = point;
  const up = yoy !== null && yoy > 0.0005;
  const down = yoy !== null && yoy < -0.0005;
  return (
    <g transform={`translate(${Number(x)},${Number(y)})`} data-testid="period-tick">
      <text
        textAnchor="middle"
        dy={12}
        fontSize={12}
        style={{ fill: "var(--muted-foreground)", fontStyle: point.bucket.partial ? "italic" : undefined }}
      >
        {bucketTick(point.bucket)}
      </text>
      <text
        textAnchor="middle"
        dy={28}
        fontSize={11}
        fontWeight={500}
        style={{ fill: up ? "var(--positive)" : down ? "var(--negative)" : "var(--muted-foreground)" }}
        data-testid="yoy"
      >
        {yoy === null ? "—" : `${up ? "▲" : down ? "▼" : ""}${formatDeltaPct(yoy)}`}
      </text>
    </g>
  );
}

/** The legend entry for the hatch: which bars are partial and that last year covers the same days. */
export function PartialNote({
  buckets,
  color,
  measure = "change on last year",
}: {
  buckets: PeriodBucket[];
  color: string;
  /** What the figure under each bar is. */
  measure?: string;
}) {
  const partial = buckets.filter((bucket) => bucket.partial);
  const unit = buckets[0]?.granularity === "year" ? "year" : "month";
  const hatchId = `partial-legend-${useId().replace(/\W/g, "")}`;
  return (
    <div className="flex flex-wrap items-center justify-center gap-x-4 gap-y-1 pt-1 text-xs text-muted-foreground">
      {partial.length > 0 && (
        <span className="inline-flex items-center gap-1.5" data-testid="partial-marker">
          <svg width={12} height={12} aria-hidden className="shrink-0 rounded-[2px]">
            <defs>
              <HatchPattern id={hatchId} color={color} />
            </defs>
            <rect width={12} height={12} fill={`url(#${hatchId})`} />
          </svg>
          <span>
            Partial {unit}
            {partial.length > 1 ? "s" : ""}: {partial.map((bucket) => partialLabel(bucket)).join(", ")},
            compared with the same days last year
          </span>
        </span>
      )}
      <span>
        Under each {unit}: {measure}
      </span>
    </div>
  );
}
