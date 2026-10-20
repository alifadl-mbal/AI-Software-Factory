"use client";

import { usePathname } from "next/navigation";
import { Suspense } from "react";
import { useTheme } from "next-themes";
import { Database, Loader2, Moon, RefreshCw, Sun } from "lucide-react";

import { refreshData } from "@/app/actions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { OVERVIEW, dashboardForPath } from "@/lib/dashboards";
import type { Company } from "@/lib/server/queries/common";

import { CompanySelect, CompanySelectFallback } from "./company-select";
import { DateRangePicker } from "./date-range-picker";
import { useShell } from "./shell-context";

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
}

function ThemeToggle() {
  const { resolvedTheme, setTheme } = useTheme();
  const dark = resolvedTheme === "dark";
  return (
    <Button
      variant="ghost"
      size="icon"
      onClick={() => setTheme(dark ? "light" : "dark")}
      aria-label={dark ? "Switch to light mode" : "Switch to dark mode"}
      data-testid="theme-toggle"
    >
      <Sun className="hidden dark:block" aria-hidden />
      <Moon className="dark:hidden" aria-hidden />
    </Button>
  );
}

function RefreshButton() {
  const { asOf, isPending, startTransition } = useShell();
  return (
    <div className="flex items-center gap-2">
      <span className="hidden text-xs whitespace-nowrap text-muted-foreground lg:inline" aria-live="polite">
        {asOf ? `Data as of ${formatTime(asOf)}` : ""}
      </span>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="outline"
            className="h-9"
            disabled={isPending}
            onClick={() => startTransition(() => refreshData())}
            data-testid="refresh"
          >
            {isPending ? <Loader2 className="animate-spin" aria-hidden /> : <RefreshCw aria-hidden />}
            <span className="hidden sm:inline">Refresh</span>
            <span className="sr-only sm:hidden">Refresh data</span>
          </Button>
        </TooltipTrigger>
        <TooltipContent>
          {asOf ? `Data as of ${formatTime(asOf)}. ` : ""}Results are cached for 15 minutes; Refresh reloads
          them from the source.
        </TooltipContent>
      </Tooltip>
    </div>
  );
}

/** The bar above every page: navigation toggle, page title, filters, refresh and theme. */
export function TopBar({ companies, sample }: { companies: Promise<Company[]>; sample: boolean }) {
  const pathname = usePathname();
  const title = dashboardForPath(pathname)?.title ?? OVERVIEW.title;

  return (
    <header className="sticky top-0 z-20 border-b bg-background/85 backdrop-blur supports-[backdrop-filter]:bg-background/70">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 px-4 py-2.5 md:px-6">
        <div className="flex min-w-0 flex-1 items-center gap-2 md:flex-none">
          <SidebarTrigger className="-ml-1" aria-label="Toggle navigation" />
          <Separator orientation="vertical" className="mr-1 data-[orientation=vertical]:h-5" />
          <span className="truncate text-sm font-semibold">{title}</span>
          {sample && (
            <Badge
              variant="secondary"
              className="ml-1 gap-1 border border-chart-4/40 bg-chart-4/15 text-foreground"
              data-testid="sample-badge"
            >
              <Database className="size-3" aria-hidden />
              Sample data
            </Badge>
          )}
        </div>
        <div className="order-last flex w-full min-w-0 flex-wrap items-center gap-2 md:order-none md:ml-auto md:w-auto md:justify-end">
          <DateRangePicker />
          <Suspense fallback={<CompanySelectFallback />}>
            <CompanySelect companies={companies} />
          </Suspense>
        </div>
        <div className="ml-auto flex items-center gap-1 md:ml-0">
          <RefreshButton />
          <ThemeToggle />
        </div>
      </div>
    </header>
  );
}
