"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
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
import { DASHBOARDS, OVERVIEW, dashboardHref } from "@/lib/dashboards";

/** The left navigation, built from the dashboard registry. A drawer on small screens. */
export function AppSidebar({ sourceLabel }: { sourceLabel: string }) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { setOpenMobile } = useSidebar();
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
              <Link href={`/${search}`} onClick={() => setOpenMobile(false)}>
                <span className="flex aspect-square size-8 items-center justify-center rounded-lg bg-primary text-primary-foreground">
                  <BarChart3 className="size-4" aria-hidden />
                </span>
                <span className="grid flex-1 text-left leading-tight">
                  <span className="truncate font-semibold">MBAL BI</span>
                  <span className="truncate text-xs text-muted-foreground">Orion ERP analytics</span>
                </span>
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
