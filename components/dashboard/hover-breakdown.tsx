"use client";

import { useEffect, useSyncExternalStore } from "react";
import { ArrowDownRight, ArrowUpRight, Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { formatAed, formatAedCompact, formatDeltaPct, formatPct, pctChange } from "@/lib/format";
import { cn } from "@/lib/utils";

/**
 * The hover card: what one bar is made of. It shows a total, last year's and the change, any
 * further figures with their own last year, and a few labelled sections of rows. Each page has a
 * route that answers `{ ok: true, data }` for one bar and a `toView` that turns `data` into a
 * `HoverView`. Data is fetched once per URL and kept for the life of the page, so hovering back
 * and forth is instant.
 */

/** The label a top-N list gives the rows it folds together (`ALL_OTHER` on the server). */
const ALL_OTHER = "All other";

export interface HoverRow {
  label: string;
  value: number;
}

export interface HoverSection {
  /** Marks the section as `breakdown-<id>` for tests. */
  id: string;
  title: string;
  rows: HoverRow[];
  /** Show each row's share of the total. Leave off where rows can have either sign. */
  share?: boolean;
}

/** A figure shown under the total with its own last year, such as cost of sales. */
export interface HoverFigure {
  id: string;
  label: string;
  value: number;
  lastYear: number;
  /** For costs: a rise is coloured as bad and a fall as good. */
  lowerIsBetter?: boolean;
}

export interface HoverView {
  total: number;
  /** The same days a year earlier. */
  lastYear: number;
  figures?: HoverFigure[];
  sections: HoverSection[];
}

export interface HoverText {
  /** What the total is, such as "Net revenue". */
  totalLabel: string;
  /** Shown when every section is empty, such as "No sales in this period." */
  emptyText: string;
}

type Entry = { status: "loading" } | { status: "ok"; data: unknown } | { status: "error"; message: string };

type Loaded = { ok: true; data: unknown } | { ok: false; message: string };

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
export function prefetchHover(url: string): void {
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

function useHover(url: string): Entry {
  useEffect(() => prefetchHover(url), [url]);
  return useSyncExternalStore(
    subscribe,
    () => entries.get(url) ?? LOADING,
    () => LOADING,
  );
}

/** `path` with the page's filters (`search`, as `filtersToSearch` writes it) and `params`. */
export function hoverUrl(path: string, search: string, params: Record<string, string>): string {
  const query = new URLSearchParams(search);
  for (const [name, value] of Object.entries(params)) query.set(name, value);
  return `${path}?${query.toString()}`;
}

/** The keys either side of `key`, for loading the next bar's card in the background. */
export function neighbours(keys: string[], key: string): string[] {
  const index = keys.indexOf(key);
  return index < 0 ? [] : [keys[index - 1], keys[index + 1]].filter((value): value is string => !!value);
}

function Change({
  current,
  previous,
  lowerIsBetter = false,
  testId,
}: {
  current: number;
  previous: number;
  lowerIsBetter?: boolean;
  testId?: string;
}) {
  const change = pctChange(current, previous);
  if (change === null) return <span className="text-muted-foreground">— vs last year</span>;
  const up = change > 0.0005;
  const down = change < -0.0005;
  const good = lowerIsBetter ? down : up;
  const bad = lowerIsBetter ? up : down;
  const Arrow = up ? ArrowUpRight : ArrowDownRight;
  return (
    <span
      className={cn(
        "tabular inline-flex items-center gap-0.5 rounded-md px-1.5 py-0.5 font-medium",
        good && "bg-positive/12 text-positive",
        bad && "bg-negative/12 text-negative",
        !good && !bad && "bg-muted text-muted-foreground",
      )}
      data-testid={testId}
    >
      {(up || down) && <Arrow className="size-3.5" aria-hidden />}
      <span className="sr-only">{up ? "Up " : down ? "Down " : ""}</span>
      {formatDeltaPct(change)}
    </span>
  );
}

function Figures({ figures }: { figures: HoverFigure[] }) {
  return (
    <dl className="flex flex-col gap-1" data-testid="breakdown-figures">
      {figures.map((figure) => (
        <div
          key={figure.id}
          className="grid grid-cols-[minmax(0,1fr)_auto_4.5rem] items-center gap-x-2"
          data-testid={`breakdown-figure-${figure.id}`}
        >
          <dt className="truncate text-muted-foreground">{figure.label}</dt>
          <dd
            className="tabular text-right font-medium"
            title={`Last year ${formatAed(figure.lastYear)}`}
            data-value={figure.value}
            data-last-year={figure.lastYear}
          >
            {formatAedCompact(figure.value)}
          </dd>
          <dd className="text-right">
            <Change current={figure.value} previous={figure.lastYear} lowerIsBetter={figure.lowerIsBetter} />
          </dd>
        </div>
      ))}
    </dl>
  );
}

function Slices({ section, total }: { section: HoverSection; total: number }) {
  const largest = Math.max(...section.rows.map((row) => Math.abs(row.value)), 1);
  return (
    <section className="flex flex-col gap-1" data-testid={`breakdown-${section.id}`}>
      <h3 className="text-[11px] font-medium tracking-wide text-muted-foreground uppercase">
        {section.title}
      </h3>
      <ul className="flex flex-col gap-1">
        {section.rows.map((row) => (
          <li
            key={row.label}
            className={cn(
              "grid items-center gap-x-2",
              section.share ? "grid-cols-[minmax(0,1fr)_auto_3rem]" : "grid-cols-[minmax(0,1fr)_auto]",
            )}
            data-testid="slice"
          >
            <span className="relative truncate py-0.5" title={row.label}>
              <span
                aria-hidden
                className={cn(
                  "absolute inset-y-0 left-0 rounded-sm",
                  row.label === ALL_OTHER ? "bg-muted" : row.value < 0 ? "bg-negative/15" : "bg-chart-1/20",
                )}
                style={{ width: `${(Math.abs(row.value) / largest) * 100}%` }}
              />
              <span className="relative px-1">{row.label}</span>
            </span>
            <span
              className="tabular text-right font-medium"
              title={formatAed(row.value)}
              data-value={row.value}
            >
              {formatAedCompact(row.value)}
            </span>
            {section.share && (
              <span className="tabular text-right text-muted-foreground">
                {total ? formatPct(row.value / total) : "—"}
              </span>
            )}
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
export function HoverBreakdown<T>({
  url,
  title,
  toView,
  text,
  current,
  lastYear,
  variant = "tooltip",
  prefetch = [],
}: {
  url: string;
  title: string;
  /** Turns the route's `data` into what the card shows. */
  toView: (data: T) => HoverView;
  text: HoverText;
  current?: number;
  lastYear?: number;
  /** `tooltip` floats over the chart; `sheet` fills the bottom sheet on phones. */
  variant?: "tooltip" | "sheet";
  /** Neighbouring bars, loaded in the background so the next hover is instant. */
  prefetch?: string[];
}) {
  const entry = useHover(url);
  const neighbourUrls = prefetch.join(" ");
  useEffect(() => {
    if (entry.status === "ok" && neighbourUrls) neighbourUrls.split(" ").forEach(prefetchHover);
  }, [entry.status, neighbourUrls]);

  const view = entry.status === "ok" ? toView(entry.data as T) : undefined;
  const total = view ? view.total : current;
  const previous = view ? view.lastYear : lastYear;
  return (
    <div
      className={cn(
        "flex flex-col gap-3 text-xs",
        variant === "tooltip" &&
          "w-80 max-w-[calc(100vw-2rem)] rounded-[14px] border border-border bg-popover p-3.5 text-popover-foreground shadow-float",
      )}
      data-testid="breakdown-card"
    >
      <div className="flex flex-col gap-1">
        {variant === "tooltip" && <p className="font-medium text-foreground">{title}</p>}
        <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
          <span className="text-muted-foreground">{text.totalLabel}</span>
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
          {total !== undefined && previous !== undefined && (
            <Change current={total} previous={previous} testId="breakdown-yoy" />
          )}
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
      ) : !view ? null : (
        <>
          {view.figures && view.figures.length > 0 && <Figures figures={view.figures} />}
          {view.sections.every((section) => section.rows.length === 0) ? (
            <p className="text-muted-foreground" data-testid="breakdown-empty">
              {text.emptyText}
            </p>
          ) : (
            view.sections.map((section) => <Slices key={section.id} section={section} total={view.total} />)
          )}
        </>
      )}
    </div>
  );
}

/** What a tapped bar shows in the bottom sheet on phones. */
export interface HoverSelection {
  url: string;
  title: string;
  description: string;
  current?: number;
  lastYear?: number;
  /** The drill-down to open from the sheet's button, for a bar that has one. */
  drill?: string;
}

/** The hover card as a bottom sheet, for phones; its button opens the bar's drill-down. */
export function HoverSheet<T>({
  selected,
  onClose,
  toView,
  text,
  onDrill,
  drillLabel,
}: {
  selected: HoverSelection | null;
  onClose: () => void;
  toView: (data: T) => HoverView;
  text: HoverText;
  onDrill?: (drill: string) => void;
  /** The drill button's words, such as "List its documents". */
  drillLabel?: string;
}) {
  return (
    <Sheet open={selected !== null} onOpenChange={(open) => !open && onClose()}>
      <SheetContent side="bottom" className="max-h-[85vh] overflow-y-auto" data-testid="breakdown-sheet">
        {selected && (
          <>
            <SheetHeader className="pr-12 pb-0">
              <SheetTitle>{selected.title}</SheetTitle>
              <SheetDescription>{selected.description}</SheetDescription>
            </SheetHeader>
            <div className="px-4 pb-6">
              <HoverBreakdown
                url={selected.url}
                title={selected.title}
                toView={toView}
                text={text}
                current={selected.current}
                lastYear={selected.lastYear}
                variant="sheet"
              />
              {selected.drill && onDrill && (
                <Button
                  variant="outline"
                  className="mt-4 w-full"
                  onClick={() => {
                    const drill = selected.drill!;
                    onClose();
                    onDrill(drill);
                  }}
                >
                  {drillLabel ?? "Open the drill-down"}
                </Button>
              )}
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}
