"use client";

import { useSearchParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { ArrowLeft, Loader2 } from "lucide-react";

import { ErrorCard } from "@/components/dashboard/error-card";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { filtersToSearch, type Filters } from "@/lib/filters";

/**
 * The pieces of a drill-down dialog: a bar opens it to a list, a row of the list opens the next
 * level, and Back returns. Its state lives in URL parameters, so a reload or a shared link reopens
 * it. Each level loads on demand from a route that answers `{ ok: true, data }` or
 * `{ ok: false, message }`; `DrillView` loads one and shows its loading and error states. Tables
 * inside come from `DataTable`, which gives totals, CSV export and customer or item links.
 */

export type Loaded<T> = { ok: true; data: T } | { ok: false; message: string };

/** Where focus goes back to when the dialog closes: the bar or row that opened it. */
let opener: HTMLElement | SVGElement | null = null;

/** Write drill parameters into the URL without a server round trip (Next syncs `useSearchParams`). */
export function setDrillParams(changes: Record<string, string | null>) {
  const params = new URLSearchParams(window.location.search);
  for (const [name, value] of Object.entries(changes)) {
    if (value === null) params.delete(name);
    else params.set(name, value);
  }
  const search = params.toString().replaceAll("%2C", ",");
  window.history.replaceState(null, "", `${window.location.pathname}${search ? `?${search}` : ""}`);
}

/**
 * Opens a drill-down: remembers the focused bar or row for when it closes, sets `param` to the
 * value and clears the deeper levels' `reset` parameters.
 */
export function useOpenDrill(param: string, reset: readonly string[] = []) {
  const resetKey = reset.join(",");
  return useCallback(
    (value: string) => {
      const active = document.activeElement;
      opener =
        (active instanceof HTMLElement || active instanceof SVGElement) && active !== document.body
          ? active
          : null;
      setDrillParams({
        [param]: value,
        ...Object.fromEntries(resetKey ? resetKey.split(",").map((name) => [name, null]) : []),
      });
    },
    [param, resetKey],
  );
}

/** The current value of each drill parameter. */
export function useDrillParams<K extends string>(names: readonly K[]): Record<K, string | null> {
  const searchParams = useSearchParams();
  return Object.fromEntries(names.map((name) => [name, searchParams.get(name)])) as Record<K, string | null>;
}

/** Fetch `url` and keep its answer; `retry` loads it again. */
export function useLoaded<T>(url: string): { result: Loaded<T> | null; retry: () => void } {
  const [state, setState] = useState<{ url: string; result: Loaded<T> } | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    fetch(url, { signal: controller.signal })
      .then((response) => response.json() as Promise<Loaded<T>>)
      .then((result) => setState({ url, result }))
      .catch((error: unknown) => {
        if (!controller.signal.aborted) {
          setState({
            url,
            result: { ok: false, message: error instanceof Error ? error.message : "Loading failed." },
          });
        }
      });
    return () => controller.abort();
  }, [url, attempt]);

  return {
    result: state?.url === url ? state.result : null,
    retry: () => {
      setState(null);
      setAttempt((value) => value + 1);
    },
  };
}

/** `path` with the shared filters and `changes`. */
export function drillApiUrl(path: string, filters: Filters, changes: Record<string, string>): string {
  const params = new URLSearchParams(filtersToSearch(filters));
  for (const [name, value] of Object.entries(changes)) params.set(name, value);
  return `${path}?${params.toString()}`;
}

export function DrillLoading({ what }: { what: string }) {
  return (
    <div className="flex items-center gap-2 py-4 text-sm text-muted-foreground" aria-busy="true">
      <Loader2 className="size-4 animate-spin" aria-hidden />
      Loading {what}…
    </div>
  );
}

/** One level's data: loading, an error with Retry, or `children(data)`. */
export function DrillView<T>({
  url,
  what,
  children,
}: {
  url: string;
  /** What is loading, such as "documents". */
  what: string;
  children: (data: T) => ReactNode;
}) {
  const { result, retry } = useLoaded<T>(url);
  if (result === null) return <DrillLoading what={what} />;
  if (!result.ok) return <ErrorCard message={result.message} onRetry={retry} />;
  return children(result.data);
}

/** The figures above a level's table. Each is marked `drill-total-<label>` for tests. */
export function DrillTotals({ items }: { items: { label: string; value: string }[] }) {
  return (
    <dl
      className="grid grid-cols-2 gap-2 rounded-lg border p-3 text-sm sm:grid-cols-5"
      data-testid="drill-totals"
    >
      {items.map((item) => (
        <div key={item.label}>
          <dt className="text-xs text-muted-foreground">{item.label}</dt>
          <dd
            className="tabular font-medium"
            data-testid={`drill-total-${item.label.toLowerCase().replace(/\W+/g, "-")}`}
          >
            {item.value}
          </dd>
        </div>
      ))}
    </dl>
  );
}

/** The Back button of a deeper level, focused when the level opens. */
export function DrillBack({ label, onClick }: { label: string; onClick: () => void }) {
  const ref = useRef<HTMLButtonElement>(null);
  useEffect(() => ref.current?.focus(), []);
  return (
    <Button ref={ref} variant="outline" size="sm" onClick={onClick}>
      <ArrowLeft aria-hidden />
      {label}
    </Button>
  );
}

/** After Back, focus the row of `container` that opened the level just left. */
export function useReturnFocus(open: string | null) {
  const container = useRef<HTMLDivElement>(null);
  const [returnTo, setReturnTo] = useState<string | null>(null);
  useEffect(() => {
    if (open !== null || returnTo === null) return;
    container.current?.querySelector<HTMLElement>(`[data-row-id="${CSS.escape(returnTo)}"]`)?.focus();
  }, [open, returnTo]);
  return { container, setReturnTo };
}

/**
 * The dialog itself, a full-screen sheet on phones. Closing clears `params` from the URL and
 * returns focus to the bar or row that opened it, or after a reload to the element matching
 * `returnSelector`.
 */
export function DrillDialog({
  open,
  params,
  title,
  description,
  returnSelector,
  testId,
  children,
}: {
  open: boolean;
  /** Every URL parameter of this drill-down, cleared on close. */
  params: readonly string[];
  title: ReactNode;
  description: ReactNode;
  /** Called on close; a selector for the element to focus when the opener is gone. */
  returnSelector?: () => string | null;
  testId: string;
  children: ReactNode;
}) {
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) setDrillParams(Object.fromEntries(params.map((name) => [name, null])));
      }}
    >
      <DialogContent
        className="flex max-h-[90vh] flex-col gap-0 overflow-hidden p-0 max-sm:top-0 max-sm:left-0 max-sm:h-dvh max-sm:max-h-dvh max-sm:max-w-full max-sm:translate-x-0 max-sm:translate-y-0 max-sm:rounded-none sm:max-w-5xl"
        data-testid={testId}
        onCloseAutoFocus={(event) => {
          const selector = opener?.isConnected === true ? null : returnSelector?.();
          const target =
            opener?.isConnected === true
              ? opener
              : selector
                ? document.querySelector<HTMLElement | SVGElement>(selector)
                : null;
          opener = null;
          if (target) {
            event.preventDefault();
            target.focus();
          }
        }}
      >
        <DialogHeader className="border-b p-4 pr-12">
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <div className="min-h-0 flex-1 overflow-y-auto p-4">{children}</div>
      </DialogContent>
    </Dialog>
  );
}
