"use client";

import { useEffect, useSyncExternalStore } from "react";
import { ArrowDownRight, ArrowUpRight, Loader2 } from "lucide-react";

import { formatAed, formatAedCompact, formatDeltaPct, formatPct, pctChange } from "@/lib/format";
import type { Dimension, HoverBreakdown } from "@/lib/server/queries/sales";
import { ALL_OTHER } from "@/lib/server/sql";
import { cn } from "@/lib/utils";

/**
 * The Sales hover card: what one bar is made of, by company, salesperson and item group, with the
 * bar's total, last year's and the change. Data comes from `/api/sales/breakdown`, fetched once per
 * URL and kept for the life of the page, so hovering back and forth is instant.
 */

type Entry =
  { status: "loading" } | { status: "ok"; data: HoverBreakdown } | { status: "error"; message: string };

type Loaded = { ok: true; data: HoverBreakdown } | { ok: false; message: string };

const LOADING: Entry = { status: "loading" };
/** Enough for every bar of a few filter sets; the oldest go first. */
const MAX_ENTRIES = 300;
const entries = new Map<string, Entry>();
const listeners = new Set<() => void>();

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function settle(url: string, entry: Entry) {
  entries.set(url, entry);
  for (const key of entries.keys()) {
    if (entries.size <= MAX_ENTRIES) break;
    entries.delete(key);
  }
  listeners.forEach((listener) => listener());
}

/** Start loading `url` unless it is loaded or loading; a failed load is tried again. */
export function prefetchBreakdown(url: string): void {
  const entry = entries.get(url);
  if (entry && entry.status !== "error") return;
  entries.set(url, LOADING);
  fetch(url)
    .then((response) => response.json() as Promise<Loaded>)
    .then((body) =>
      settle(url, body.ok ? { status: "ok", data: body.data } : { status: "error", message: body.message }),
    )
    .catch(() => settle(url, { status: "error", message: "Loading the breakdown failed. Try again." }));
}

function useBreakdown(url: string): Entry {
  useEffect(() => prefetchBreakdown(url), [url]);
  return useSyncExternalStore(
    subscribe,
    () => entries.get(url) ?? LOADING,
    () => LOADING,
  );
}

/** `/api/sales/breakdown` with the page's filters (`search`, as `filtersToSearch` writes it). */
export function breakdownUrl(search: string, params: Record<string, string>): string {
  const query = new URLSearchParams(search);
  for (const [name, value] of Object.entries(params)) query.set(name, value);
  return `/api/sales/breakdown?${query.toString()}`;
}

const DIMENSION_TITLES: Record<Dimension, string> = {
  company: "By company",
  customer: "By customer",
  item: "By item",
  salesperson: "By salesperson",
  itemGroup: "By item group",
};

function Change({ current, previous }: { current: number; previous: number }) {
  const change = pctChange(current, previous);
  if (change === null) return <span className="text-muted-foreground">— vs last year</span>;
  const up = change > 0.0005;
  const down = change < -0.0005;
  const Arrow = up ? ArrowUpRight : ArrowDownRight;
  return (
    <span
      className={cn(
        "tabular inline-flex items-center gap-0.5 rounded-md px-1.5 py-0.5 font-medium",
        up && "bg-positive/12 text-positive",
        down && "bg-negative/12 text-negative",
        !up && !down && "bg-muted text-muted-foreground",
      )}
      data-testid="breakdown-yoy"
    >
      {(up || down) && <Arrow className="size-3.5" aria-hidden />}
      <span className="sr-only">{up ? "Up " : down ? "Down " : ""}</span>
      {formatDeltaPct(change)}
    </span>
  );
}

function Slices({
  dimension,
  rows,
  total,
}: {
  dimension: Dimension;
  rows: HoverBreakdown["breakdowns"][number]["rows"];
  total: number;
}) {
  const largest = Math.max(...rows.map((row) => Math.abs(row.netRevenue)), 1);
  return (
    <section className="flex flex-col gap-1" data-testid={`breakdown-${dimension}`}>
      <h3 className="text-[11px] font-medium tracking-wide text-muted-foreground uppercase">
        {DIMENSION_TITLES[dimension]}
      </h3>
      <ul className="flex flex-col gap-1">
        {rows.map((row) => (
          <li
            key={row.label}
            className="grid grid-cols-[minmax(0,1fr)_auto_3rem] items-center gap-x-2"
            data-testid="slice"
          >
            <span className="relative truncate py-0.5" title={row.label}>
              <span
                aria-hidden
                className={cn(
                  "absolute inset-y-0 left-0 rounded-sm",
                  row.label === ALL_OTHER ? "bg-muted" : "bg-chart-1/20",
                )}
                style={{ width: `${(Math.abs(row.netRevenue) / largest) * 100}%` }}
              />
              <span className="relative px-1">{row.label}</span>
            </span>
            <span
              className="tabular text-right font-medium"
              title={formatAed(row.netRevenue)}
              data-value={row.netRevenue}
            >
              {formatAedCompact(row.netRevenue)}
            </span>
            <span className="tabular text-right text-muted-foreground">
              {total ? formatPct(row.netRevenue / total) : "—"}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

/**
 * The card body. `current` and `lastYear` are what the bar already knows, shown while the
 * breakdown loads; the loaded totals replace them.
 */
export function BreakdownCard({
  url,
  title,
  current,
  lastYear,
  variant = "tooltip",
  prefetch = [],
}: {
  url: string;
  title: string;
  current?: number;
  lastYear?: number;
  /** `tooltip` floats over the chart; `sheet` fills the bottom sheet on phones. */
  variant?: "tooltip" | "sheet";
  /** Neighbouring bars, loaded in the background so the next hover is instant. */
  prefetch?: string[];
}) {
  const entry = useBreakdown(url);
  const neighbours = prefetch.join(" ");
  useEffect(() => {
    if (entry.status === "ok" && neighbours) neighbours.split(" ").forEach(prefetchBreakdown);
  }, [entry.status, neighbours]);

  const total = entry.status === "ok" ? entry.data.netRevenue : current;
  const previous = entry.status === "ok" ? entry.data.lastYearNetRevenue : lastYear;
  return (
    <div
      className={cn(
        "flex flex-col gap-3 text-xs",
        variant === "tooltip" &&
          "w-80 max-w-[calc(100vw-2rem)] rounded-lg border border-border/50 bg-background p-3 shadow-xl",
      )}
      data-testid="breakdown-card"
    >
      <div className="flex flex-col gap-1">
        {variant === "tooltip" && <p className="font-medium text-foreground">{title}</p>}
        <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
          <span className="text-muted-foreground">Net revenue</span>
          <span className="tabular text-sm font-semibold text-foreground" data-testid="breakdown-total">
            {total === undefined ? "…" : formatAed(total)}
          </span>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
          <span className="text-muted-foreground">
            Last year{" "}
            <span className="tabular" data-testid="breakdown-last-year">
              {previous === undefined ? "…" : formatAed(previous)}
            </span>
          </span>
          {total !== undefined && previous !== undefined && <Change current={total} previous={previous} />}
        </div>
      </div>
      {entry.status === "loading" ? (
        <p className="flex items-center gap-2 text-muted-foreground" role="status">
          <Loader2 className="size-3.5 animate-spin" aria-hidden />
          Loading breakdown…
        </p>
      ) : entry.status === "error" ? (
        <p className="text-negative" role="alert" data-testid="breakdown-error">
          {entry.message}
        </p>
      ) : entry.data.breakdowns.every((breakdown) => breakdown.rows.length === 0) ? (
        <p className="text-muted-foreground" data-testid="breakdown-empty">
          No sales in this period.
        </p>
      ) : (
        entry.data.breakdowns.map((breakdown) => (
          <Slices
            key={breakdown.dimension}
            dimension={breakdown.dimension}
            rows={breakdown.rows}
            total={entry.data.netRevenue}
          />
        ))
      )}
    </div>
  );
}
