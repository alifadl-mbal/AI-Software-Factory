"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { Suspense, use } from "react";
import { BarChart3 } from "lucide-react";

import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
  useSidebar,
} from "@/components/ui/sidebar";
import { monogram } from "@/lib/company-identity";
import { DASHBOARDS, OVERVIEW, dashboardHref } from "@/lib/dashboards";
import type { Company } from "@/lib/server/queries/common";

import { useShell } from "./shell-context";

/** The app's own mark and name: all companies, several, or one whose name isn't known yet. */
function AppIdentity() {
  return (
    <>
      <span className="flex aspect-square size-8 items-center justify-center rounded-lg bg-primary text-primary-foreground">
        <BarChart3 className="size-4" aria-hidden />
      </span>
      <span className="grid flex-1 text-left leading-tight">
        <span className="truncate font-semibold">MBAL BI</span>
        <span className="truncate text-xs text-muted-foreground">Orion ERP analytics</span>
      </span>
    </>
  );
}

/** One company selected: its logo (from `public/logos/`) or a monogram badge, and its name. */
function CompanyIdentity({
  code,
  companies: companiesPromise,
  logos,
}: {
  code: string;
  companies: Promise<Company[]>;
  logos: Record<string, string>;
}) {
  const name = use(companiesPromise).find((company) => company.code === code)?.name ?? code;
  const logo = logos[code];
  return (
    <>
      {logo ? (
        <Image
          src={logo}
          alt=""
          width={32}
          height={32}
          unoptimized
          className="size-8 shrink-0 rounded-lg bg-white object-contain p-0.5 ring-1 ring-border"
          data-testid="company-logo"
        />
      ) : (
        <span
          className="flex aspect-square size-8 shrink-0 items-center justify-center rounded-lg bg-primary text-xs font-semibold tracking-tight text-primary-foreground"
          aria-hidden
          data-testid="company-monogram"
        >
          {monogram(name)}
        </span>
      )}
      <span className="grid flex-1 text-left leading-tight">
        <span className="truncate font-semibold" data-testid="company-identity-name">
          {name}
        </span>
        <span className="truncate text-xs text-muted-foreground">MBAL BI · Orion ERP analytics</span>
      </span>
    </>
  );
}

/** The left navigation, built from the dashboard registry. A drawer on small screens. */
export function AppSidebar({
  sourceLabel,
  companies,
  logos,
}: {
  sourceLabel: string;
  companies: Promise<Company[]>;
  /** Company code → logo URL, from `public/logos/`. */
  logos: Record<string, string>;
}) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { setOpenMobile } = useSidebar();
  const { filters } = useShell();
  const single = filters.companies.length === 1 ? filters.companies[0] : null;
  // Keep the filters when moving between dashboards.
  const search = searchParams.size > 0 ? `?${searchParams.toString()}` : "";
  const items = [
    { href: OVERVIEW.href, title: OVERVIEW.title, icon: OVERVIEW.icon },
    ...DASHBOARDS.map((dashboard) => ({
      href: dashboardHref(dashboard),
      title: dashboard.title,
      icon: dashboard.icon,
    })),
  ];

  return (
    <Sidebar collapsible="icon" aria-label="Dashboards">
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton size="lg" asChild tooltip="MBAL BI">
              <Link href={`/${search}`} onClick={() => setOpenMobile(false)} data-testid="app-identity">
                {single ? (
                  <Suspense fallback={<AppIdentity />}>
                    <CompanyIdentity code={single} companies={companies} logos={logos} />
                  </Suspense>
                ) : (
                  <AppIdentity />
                )}
              </Link>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>Dashboards</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {items.map((item) => {
                // Whole path segments only: /sales must not light up on /sales-orders.
                const active =
                  item.href === "/"
                    ? pathname === "/"
                    : pathname === item.href || pathname.startsWith(`${item.href}/`);
                const Icon = item.icon;
                return (
                  <SidebarMenuItem key={item.href}>
                    <SidebarMenuButton asChild isActive={active} tooltip={item.title}>
                      <Link
                        href={`${item.href}${search}`}
                        aria-current={active ? "page" : undefined}
                        onClick={() => setOpenMobile(false)}
                      >
                        <Icon aria-hidden />
                        <span>{item.title}</span>
                      </Link>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                );
              })}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
      <SidebarFooter>
        <p className="px-2 py-1 text-xs text-muted-foreground group-data-[collapsible=icon]:hidden">
          Source: {sourceLabel} · read-only
        </p>
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  );
}
