"use client";

import { useSyncExternalStore } from "react";
import { useTheme } from "next-themes";
import { Database, Loader2, Moon, RefreshCw, Sun } from "lucide-react";

import { refreshData } from "@/app/actions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

import { IdentityBlock, type IdentityProps } from "./identity";
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

/** The TNS pill-glass theme toggle. */
function ThemeToggle() {
  const { resolvedTheme, setTheme } = useTheme();
  const mounted = useMounted();
  const dark = resolvedTheme === "dark";
  // The server can't know the theme, so the label stays neutral until hydration is over; the icon
  // swap is pure CSS and needs no guard.
  const label = !mounted ? "Toggle theme" : dark ? "Switch to light mode" : "Switch to dark mode";
  return (
    <Button
      variant="outline"
      size="icon"
      className="size-[42px] rounded-xl"
      onClick={() => setTheme(dark ? "light" : "dark")}
      aria-label={label}
      data-testid="theme-toggle"
    >
      <Sun className="hidden size-4.5 dark:block" aria-hidden />
      <Moon className="size-4.5 dark:hidden" aria-hidden />
    </Button>
  );
}

/** When the data on screen was read from the source. */
function AsOf() {
  const { asOf } = useShell();
  return (
    <span className="hidden text-xs whitespace-nowrap text-muted-foreground lg:inline" aria-live="polite">
      {asOf ? `Data as of ${formatTime(asOf)}` : ""}
    </span>
  );
}

/** The navy Refresh pill. */
function RefreshButton() {
  const { asOf, isPending, startTransition } = useShell();
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          className="h-[42px] gap-2 rounded-xl px-4 max-sm:w-[42px] max-sm:px-0"
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
  );
}

/**
 * The top of the content panel, as on TNS: the logo and company name with a small subtitle on the
 * left (they follow the company filter), and search, data-as-of, the theme toggle and Refresh on
 * the right.
 */
export function ShellHeader({
  sample,
  user,
  ...identity
}: IdentityProps & {
  sample: boolean;
  /** The signed-in user; null while sign-in is off. */
  user: SignedInUser | null;
}) {
  return (
    <header className="flex items-center justify-between gap-3 px-1 pt-1 sm:gap-6">
      <div className="flex min-w-0 items-center gap-3">
        <IdentityBlock {...identity} />
        {sample && (
          <Badge
            variant="secondary"
            className="gap-1 border border-chart-4/40 bg-chart-4/15 text-foreground max-sm:px-1.5"
            title="Sample data"
            data-testid="sample-badge"
          >
            <Database className="size-3" aria-hidden />
            {/* The icon alone on phones, so the company name keeps its room. */}
            <span className="max-sm:sr-only">Sample data</span>
          </Badge>
        )}
      </div>
      <div className="ml-auto flex shrink-0 items-center gap-2 sm:gap-2.5">
        <SearchCommand />
        <AsOf />
        <ThemeToggle />
        <RefreshButton />
        {user && <UserMenu user={user} />}
      </div>
    </header>
  );
}
