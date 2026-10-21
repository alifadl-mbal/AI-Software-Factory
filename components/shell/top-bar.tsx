"use client";

import { usePathname } from "next/navigation";
import { Suspense, useSyncExternalStore } from "react";
import { useTheme } from "next-themes";
import { Database, Loader2, Moon, RefreshCw, SlidersHorizontal, Sun } from "lucide-react";

import { refreshData } from "@/app/actions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { isCustomerPath } from "@/lib/customers";
import { isItemPath } from "@/lib/items";
import { OVERVIEW, SNAPSHOT, dashboardForPath } from "@/lib/dashboards";
import { DEFAULT_RANGE } from "@/lib/filters";
import type { Company } from "@/lib/server/queries/common";

import { CompanySelect, CompanySelectFallback } from "./company-select";
import { DateRangePicker } from "./date-range-picker";
import { SalesFilterSelects } from "./sales-filters";
import { SearchCommand } from "./search-command";
import { useShell } from "./shell-context";
import { UserMenu, type SignedInUser } from "./user-menu";

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
}

const noopSubscribe = () => () => {};

/** False during SSR and hydration, true afterwards: the theme is only known on the client. */
function useMounted(): boolean {
  return useSyncExternalStore(
    noopSubscribe,
    () => true,
    () => false,
  );
}

function ThemeToggle() {
  const { resolvedTheme, setTheme } = useTheme();
  const mounted = useMounted();
  const dark = resolvedTheme === "dark";
  // The server can't know the theme, so the label stays neutral until hydration is over; the icon
  // swap is pure CSS and needs no guard.
  const label = !mounted ? "Toggle theme" : dark ? "Switch to light mode" : "Switch to dark mode";
  return (
    <Button
      variant="ghost"
      size="icon"
      onClick={() => setTheme(dark ? "light" : "dark")}
      aria-label={label}
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

/** Every filter control of the page, in a row on wide screens and stacked in the drawer. */
function FilterControls({ companies, dateFilter }: { companies: Promise<Company[]>; dateFilter: boolean }) {
  return (
    <>
      {dateFilter && <DateRangePicker />}
      <Suspense fallback={<CompanySelectFallback />}>
        <CompanySelect companies={companies} />
      </Suspense>
      <SalesFilterSelects />
    </>
  );
}

/** Under 768 px the filters live in a drawer, behind one button that counts the active ones. */
function FiltersDrawer({ companies, dateFilter }: { companies: Promise<Company[]>; dateFilter: boolean }) {
  const { filters } = useShell();
  const active =
    (dateFilter && filters.range !== DEFAULT_RANGE ? 1 : 0) +
    [filters.companies, filters.salespeople, filters.brands].filter((codes) => codes.length > 0).length;
  return (
    <Sheet>
      <SheetTrigger asChild>
        <Button variant="outline" className="h-9 w-full gap-2" data-testid="filters-trigger">
          <SlidersHorizontal aria-hidden />
          Filters
          {active > 0 && (
            <Badge variant="secondary" className="tabular px-1.5" aria-label={`${active} active`}>
              {active}
            </Badge>
          )}
        </Button>
      </SheetTrigger>
      <SheetContent side="bottom" className="max-h-[85svh] overflow-y-auto" data-testid="filters-drawer">
        <SheetHeader className="pb-0">
          <SheetTitle>Filters</SheetTitle>
          <SheetDescription>They apply to every page that has the data for them.</SheetDescription>
        </SheetHeader>
        <div className="flex flex-col items-stretch gap-2 px-4 pb-6 [&>button]:w-full [&>span]:px-1">
          <FilterControls companies={companies} dateFilter={dateFilter} />
        </div>
      </SheetContent>
    </Sheet>
  );
}

/** The bar above every page: navigation toggle, page title, filters, refresh, theme and user. */
export function TopBar({
  companies,
  sample,
  user,
}: {
  companies: Promise<Company[]>;
  sample: boolean;
  /** The signed-in user; null while sign-in is off. */
  user: SignedInUser | null;
}) {
  const pathname = usePathname();
  const dashboard = dashboardForPath(pathname);
  // The snapshot preview isn't a dashboard: it always covers all companies and fixed periods.
  const snapshot = pathname === SNAPSHOT.href;
  const dateFilter = dashboard?.dateFilter !== false;
  const title = snapshot
    ? SNAPSHOT.title
    : isCustomerPath(pathname)
      ? "Customer"
      : isItemPath(pathname)
        ? "Item"
        : (dashboard?.title ?? OVERVIEW.title);

  return (
    <header className="sticky top-0 z-20 border-b bg-background/85 backdrop-blur supports-[backdrop-filter]:bg-background/70">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 px-4 py-2.5 md:px-6">
        <div className="flex min-w-0 flex-1 items-center gap-2 md:flex-none">
          <SidebarTrigger className="-ml-1" aria-label="Toggle navigation" />
          <Separator orientation="vertical" className="mr-1 data-[orientation=vertical]:h-5" />
          <span className="truncate text-sm font-semibold" data-testid="page-title">
            {title}
          </span>
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
        {!snapshot && (
          <div className="hidden min-w-0 flex-wrap items-center gap-2 md:ml-auto md:flex md:justify-end">
            <FilterControls companies={companies} dateFilter={dateFilter} />
          </div>
        )}
        {/* Its own row under 768 px, like the pickers it stands for, so the title and badge keep theirs. */}
        {!snapshot && (
          <div className="order-last w-full md:hidden">
            <FiltersDrawer companies={companies} dateFilter={dateFilter} />
          </div>
        )}
        <div className="ml-auto flex items-center gap-1 md:ml-0">
          <SearchCommand />
          <RefreshButton />
          <ThemeToggle />
          {user && <UserMenu user={user} />}
        </div>
      </div>
    </header>
  );
}
