"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { useState } from "react";
import { ChevronRight, Menu } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { isCustomerPath } from "@/lib/customers";
import {
  DASHBOARDS,
  NAV_RAIL_COOKIE,
  OVERVIEW,
  SNAPSHOT,
  dashboardForPath,
  dashboardHref,
} from "@/lib/dashboards";
import { isItemPath } from "@/lib/items";
import { DOC_PARAM, DRILL_PARAM } from "@/lib/sales-drill";
import { cn } from "@/lib/utils";

import { IdentityMark, type IdentityProps } from "./identity";

const ITEMS = [
  { href: OVERVIEW.href, title: OVERVIEW.title, shortTitle: undefined, icon: OVERVIEW.icon },
  ...DASHBOARDS.map((dashboard) => ({
    href: dashboardHref(dashboard),
    title: dashboard.title,
    shortTitle: dashboard.shortTitle,
    icon: dashboard.icon,
  })),
];

/** The current query string, minus a page's open drill-down: filters follow you between pages. */
function useKeptSearch(): string {
  const searchParams = useSearchParams();
  const kept = new URLSearchParams(searchParams);
  kept.delete(DRILL_PARAM);
  kept.delete(DOC_PARAM);
  return kept.size > 0 ? `?${kept.toString()}` : "";
}

function isActive(href: string, pathname: string): boolean {
  // Whole path segments only: /sales must not light up on /sales-orders.
  return href === "/" ? pathname === "/" : pathname === href || pathname.startsWith(`${href}/`);
}

function NavItems({ expanded, onNavigate }: { expanded: boolean; onNavigate?: () => void }) {
  const pathname = usePathname();
  const search = useKeptSearch();
  return (
    <ul className="flex w-full flex-col gap-1.5">
      {ITEMS.map((item) => {
        const active = isActive(item.href, pathname);
        const Icon = item.icon;
        return (
          <li key={item.href}>
            <Link
              href={`${item.href}${search}`}
              aria-current={active ? "page" : undefined}
              title={item.title}
              onClick={onNavigate}
              className={cn(
                "flex w-full items-center overflow-hidden rounded-[14px] whitespace-nowrap text-muted-foreground outline-none hover:bg-accent hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/60",
                expanded
                  ? "flex-row gap-3 px-3 py-2.5 text-[13px] font-medium"
                  : "flex-col gap-1 px-1 py-2.5",
                active &&
                  "bg-secondary text-secondary-foreground hover:bg-secondary hover:text-secondary-foreground",
              )}
            >
              <Icon className="size-5 shrink-0" strokeWidth={1.8} aria-hidden />
              {expanded || !item.shortTitle ? (
                <span
                  className={cn(
                    "max-w-full truncate",
                    !expanded && "text-[10px] leading-tight font-semibold",
                  )}
                >
                  {item.title}
                </span>
              ) : (
                // The short name fits the narrow rail; the link is still named in full.
                <>
                  <span className="max-w-full truncate text-[10px] leading-tight font-semibold" aria-hidden>
                    {item.shortTitle}
                  </span>
                  <span className="sr-only">{item.title}</span>
                </>
              )}
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

/**
 * The left nav rail, as on TNS: 120 px with icon + label, 260 px expanded, an edge toggle, and the
 * state remembered in a cookie. The logo on top follows the company filter.
 */
export function NavRail({
  sourceLabel,
  defaultExpanded,
  ...identity
}: IdentityProps & { sourceLabel: string; defaultExpanded: boolean }) {
  const [expanded, setExpanded] = useState(defaultExpanded);
  const search = useKeptSearch();

  function toggle() {
    const next = !expanded;
    setExpanded(next);
    document.cookie = `${NAV_RAIL_COOKIE}=${next ? "expanded" : "collapsed"}; path=/; max-age=31536000; samesite=lax`;
  }

  return (
    <nav
      id="nav-rail"
      aria-label="Dashboards"
      className={cn(
        "sticky top-8 hidden max-h-[calc(100svh-4rem)] shrink-0 flex-col gap-5 self-start glass rounded-3xl px-2.5 py-5 transition-[width] duration-200 md:flex",
        expanded ? "w-[260px]" : "w-[120px]",
      )}
      data-expanded={expanded}
      data-testid="nav-rail"
    >
      <div className="relative flex flex-col items-center">
        <Link
          href={`/${search}`}
          aria-label="MBAL BI, overview"
          className="rounded-[22%] outline-none focus-visible:ring-3 focus-visible:ring-ring/60"
        >
          <IdentityMark
            {...identity}
            className={cn("transition-all", expanded ? "size-24 text-2xl" : "size-16 text-lg")}
          />
        </Link>
        <button
          type="button"
          onClick={toggle}
          aria-expanded={expanded}
          aria-controls="nav-rail"
          aria-label={expanded ? "Collapse navigation" : "Expand navigation"}
          title={expanded ? "Collapse navigation" : "Expand navigation"}
          className="absolute top-1/2 -right-6 z-10 flex size-6.5 -translate-y-1/2 items-center justify-center rounded-full border border-border bg-card text-muted-foreground shadow-glass outline-none hover:bg-accent hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/60"
          data-testid="nav-rail-toggle"
        >
          <ChevronRight
            className={cn("size-3.5 transition-transform", expanded && "rotate-180")}
            strokeWidth={2.3}
            aria-hidden
          />
        </button>
      </div>
      <div className="-mx-1 min-h-0 overflow-y-auto px-1">
        <NavItems expanded={expanded} />
      </div>
      {expanded && (
        <p className="mt-auto px-3 text-xs text-muted-foreground">Source: {sourceLabel} · read-only</p>
      )}
    </nav>
  );
}

/** The page's name for the phone bar. */
function usePageTitle(): { title: string; shortTitle?: string } {
  const pathname = usePathname();
  if (pathname === SNAPSHOT.href) return { title: SNAPSHOT.title };
  if (isCustomerPath(pathname)) return { title: "Customer" };
  if (isItemPath(pathname)) return { title: "Item" };
  const dashboard = dashboardForPath(pathname);
  return dashboard ? { title: dashboard.title, shortTitle: dashboard.shortTitle } : { title: OVERVIEW.title };
}

/** Under 768 px the rail becomes this bar: menu, logo and page name, with the links in a drawer. */
export function NavBar({ sourceLabel, ...identity }: IdentityProps & { sourceLabel: string }) {
  const [open, setOpen] = useState(false);
  const { title, shortTitle } = usePageTitle();
  return (
    <div
      className="flex items-center gap-2.5 glass rounded-[20px] px-2.5 py-2 md:hidden"
      data-testid="nav-bar"
    >
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetTrigger asChild>
          <Button variant="ghost" size="icon-lg" aria-label="Toggle navigation">
            <Menu aria-hidden />
          </Button>
        </SheetTrigger>
        <SheetContent side="left" className="w-[280px] gap-4 p-4">
          <SheetHeader className="p-0">
            <SheetTitle>Dashboards</SheetTitle>
            <SheetDescription className="sr-only">Every dashboard. Your filters come along.</SheetDescription>
          </SheetHeader>
          <nav aria-label="Dashboards">
            <NavItems expanded onNavigate={() => setOpen(false)} />
          </nav>
          <p className="mt-auto text-xs text-muted-foreground">Source: {sourceLabel} · read-only</p>
        </SheetContent>
      </Sheet>
      <IdentityMark {...identity} className="size-8 text-xs" />
      <span className="min-w-0 truncate text-sm font-semibold" title={title} data-testid="page-title">
        {shortTitle ? (
          <>
            <span className="sm:hidden">{shortTitle}</span>
            <span className="max-sm:hidden">{title}</span>
          </>
        ) : (
          title
        )}
      </span>
    </div>
  );
}
