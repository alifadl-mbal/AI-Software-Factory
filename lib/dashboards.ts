import { Boxes, Landmark, LayoutDashboard, TrendingUp, type LucideIcon } from "lucide-react";

/**
 * The dashboard registry: the single list the sidebar and the Overview page are built from.
 *
 * To add a dashboard, add one entry here and create `app/<slug>/page.tsx`. See "Adding a
 * dashboard" in the README.
 */
export interface Dashboard {
  /** URL path segment; the page lives at `app/<slug>/page.tsx`. */
  slug: string;
  title: string;
  /** One sentence for the Overview card and the page header. */
  description: string;
  icon: LucideIcon;
  /** The Orion view(s) the dashboard reads, shown on the Overview card. */
  source: string;
  /** False for dashboards that show "as of today" figures: the top bar then hides the date filter. */
  dateFilter?: boolean;
}

export const DASHBOARDS: readonly Dashboard[] = [
  {
    slug: "sales",
    title: "Sales",
    description:
      "Net revenue, gross margin, invoices and returns, with breakdowns by company, customer, item, salesperson and item group.",
    icon: TrendingUp,
    source: "ZF_CSL_BI",
  },
  {
    slug: "inventory",
    title: "Inventory",
    description:
      "Stock value as of today, the month-end trend, dead and slow stock, and items at or below their reorder level.",
    icon: Boxes,
    source: "ZF_CURR_STK_BI · ZF_STK_MTH_SUMM_BI · ZF_ITEM",
    dateFilter: false,
  },
  {
    slug: "finance",
    title: "Finance",
    description:
      "P&L from the posted general ledger: revenue, cost of sales, gross and net profit, the P&L statement, costs by account, division and department, and journal-line drill-down.",
    icon: Landmark,
    source: "ZF_F_T_DETAIL_BI",
  },
];

export const OVERVIEW = { href: "/", title: "Overview", icon: LayoutDashboard } as const;

export function dashboardHref(dashboard: Dashboard): string {
  return `/${dashboard.slug}`;
}

/** The registry entry for a path like `/sales`, if any. */
export function dashboardForPath(pathname: string): Dashboard | undefined {
  const slug = pathname.split("/")[1];
  return DASHBOARDS.find((dashboard) => dashboard.slug === slug);
}
