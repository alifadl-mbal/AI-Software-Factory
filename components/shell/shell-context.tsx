"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { createContext, useCallback, useContext, useEffect, useMemo, useState, useTransition } from "react";

import { filtersToSearch, parseFilters, type Filters } from "@/lib/filters";

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
}

const ShellContext = createContext<ShellState | null>(null);

export function ShellProvider({ today, children }: { today: string; children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [isPending, startTransition] = useTransition();
  const [asOf, setAsOf] = useState<string | null>(null);
  const filters = useMemo(() => parseFilters(searchParams, today), [searchParams, today]);

  const setFilters = useCallback(
    (changes: Partial<Filters>) => {
      const search = filtersToSearch({ ...filters, ...changes });
      startTransition(() => router.push(`${pathname}${search}`, { scroll: false }));
    },
    [filters, pathname, router],
  );

  const value = useMemo(
    () => ({ today, filters, setFilters, isPending, startTransition, asOf, setAsOf }),
    [today, filters, setFilters, isPending, asOf],
  );
  return <ShellContext.Provider value={value}>{children}</ShellContext.Provider>;
}

export function useShell(): ShellState {
  const context = useContext(ShellContext);
  if (!context) throw new Error("useShell must be used inside <ShellProvider>");
  return context;
}

/** Rendered by a page to tell the top bar when its data was read. */
export function ReportAsOf({ iso }: { iso: string }) {
  const { setAsOf } = useShell();
  useEffect(() => {
    setAsOf(iso);
  }, [iso, setAsOf]);
  return null;
}
