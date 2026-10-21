"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { createContext, useCallback, useContext, useEffect, useMemo, useState, useTransition } from "react";

import { salesFilterSupport } from "@/lib/dashboards";
import { filtersToSearch, parseFilters, type Filters } from "@/lib/filters";
import type { SalesFilterOptions } from "@/lib/server/queries/sales-filters";

/** The salesperson and brand choices for the current companies and period, loaded by the shell. */
export type SalesOptionsState =
  { status: "loading" } | { status: "ok"; data: SalesFilterOptions } | { status: "error"; message: string };

interface ShellState {
  /** Today on the server, YYYY-MM-DD, so presets resolve the same on both sides. */
  today: string;
  filters: Filters;
  /** Replace some filters; the URL changes and the page reloads its data. */
  setFilters: (changes: Partial<Filters>) => void;
  /** True while a filter change or refresh is loading. */
  isPending: boolean;
  startTransition: (action: () => void | Promise<void>) => void;
  /** ISO time the data on screen was read from the source, reported by the page. */
  asOf: string | null;
  setAsOf: (iso: string | null) => void;
  salesOptions: SalesOptionsState;
}

const ShellContext = createContext<ShellState | null>(null);

export function ShellProvider({ today, children }: { today: string; children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [isPending, startTransition] = useTransition();
  const [asOf, setAsOf] = useState<string | null>(null);
  const filters = useMemo(() => parseFilters(searchParams, today), [searchParams, today]);
  const salesOptions = useSalesOptions(filters, salesFilterSupport(pathname) !== "none");

  const setFilters = useCallback(
    (changes: Partial<Filters>) => {
      const search = filtersToSearch({ ...filters, ...changes });
      startTransition(() => router.push(`${pathname}${search}`, { scroll: false }));
    },
    [filters, pathname, router],
  );

  const value = useMemo(
    () => ({ today, filters, setFilters, isPending, startTransition, asOf, setAsOf, salesOptions }),
    [today, filters, setFilters, isPending, asOf, salesOptions],
  );
  return <ShellContext.Provider value={value}>{children}</ShellContext.Provider>;
}

/**
 * Fetches the salesperson and brand choices whenever the companies or the period change (not when
 * a salesperson or brand is picked: the lists don't depend on those). `enabled` false on pages the
 * filters don't apply to.
 */
function useSalesOptions(filters: Filters, enabled: boolean): SalesOptionsState {
  const scope = filtersToSearch({
    range: filters.range,
    start: filters.start,
    end: filters.end,
    companies: filters.companies,
  });
  const [loaded, setLoaded] = useState<{ scope: string; state: SalesOptionsState } | null>(null);
  useEffect(() => {
    if (!enabled) return;
    const controller = new AbortController();
    fetch(`/api/filter-options${scope}`, { signal: controller.signal })
      .then(async (response) => {
        const body = (await response.json()) as
          { ok: true; data: SalesFilterOptions } | { ok: false; message: string };
        setLoaded({
          scope,
          state: body.ok ? { status: "ok", data: body.data } : { status: "error", message: body.message },
        });
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        setLoaded({
          scope,
          state: { status: "error", message: error instanceof Error ? error.message : String(error) },
        });
      });
    return () => controller.abort();
  }, [scope, enabled]);
  // Until the lists for this scope arrive, the old ones would be wrong: say they're loading.
  return loaded?.scope === scope ? loaded.state : LOADING;
}

const LOADING: SalesOptionsState = { status: "loading" };

export function useShell(): ShellState {
  const context = useContext(ShellContext);
  if (!context) throw new Error("useShell must be used inside <ShellProvider>");
  return context;
}

/** Rendered by a page to tell the header when its data was read. */
export function ReportAsOf({ iso }: { iso: string }) {
  const { setAsOf } = useShell();
  useEffect(() => {
    setAsOf(iso);
  }, [iso, setAsOf]);
  return null;
}
