import {
  Boxes,
  ClipboardList,
  Landmark,
  LayoutDashboard,
  LayoutGrid,
  Scale,
  ShoppingCart,
  TrendingUp,
  type LucideIcon,
} from "lucide-react";

/**
 * The groups of the Filters panel, in the order they show. Year and Month together pick the period
 * (with "Custom dates" for any other range); the rest are checklists.
 */
export const FILTER_GROUPS = ["year", "month", "company", "salesperson", "brand"] as const;
export type FilterGroup = (typeof FILTER_GROUPS)[number];

/** Every group: pages whose figures follow the period, the companies and the sales filters. */
const ALL_FILTERS: readonly FilterGroup[] = FILTER_GROUPS;
/** The period and the companies, for pages whose views have no salesperson or brand. */
const PERIOD_AND_COMPANY: readonly FilterGroup[] = ["year", "month", "company"];
/** "As of today" pages: only the companies apply. */
const COMPANY_ONLY: readonly FilterGroup[] = ["company"];

/**
 * The dashboard registry: the single list the nav rail and the Overview page are built from.
 *
 * To add a dashboard, add one entry here and create `app/<slug>/page.tsx`. See "Adding a
 * dashboard" in the README.
 */
export interface Dashboard {
  /** URL path segment; the page lives at `app/<slug>/page.tsx`. */
  slug: string;
  title: string;
  /** What the phone bar says instead, when the title does not fit there. */
  shortTitle?: string;
  /** One sentence for the Overview card and the page header. */
  description: string;
  icon: LucideIcon;
  /** The Orion view(s) the dashboard reads, shown on the Overview card. */
  source: string;
  /**
   * The Filters panel groups that apply to every figure on the page. Leave out "year" and "month"
   * for "as of today" pages, and "salesperson" and "brand" where the views have neither: the panel
   * then hides them, and the scope line says when one is set but doesn't apply. Adding a group here
   * is all it takes to show it on the page.
   */
  filters: readonly FilterGroup[];
}

export const DASHBOARDS: readonly Dashboard[] = [
  {
    slug: "sales",
    title: "Sales",
    description:
      "Net revenue, gross margin, invoices and returns, with breakdowns by company, customer, item, salesperson, brand and item group.",
    icon: TrendingUp,
    source: "ZF_CSL_BI",
    filters: ALL_FILTERS,
  },
  {
    slug: "inventory",
    title: "Inventory",
    description:
      "Stock value as of today, the month-end trend, dead and slow stock, and items at or below their reorder level.",
    icon: Boxes,
    source: "ZF_CURR_STK_BI · ZF_STK_MTH_SUMM_BI · ZF_ITEM",
    filters: COMPANY_ONLY,
  },
  {
    slug: "finance",
    title: "Finance",
    description:
      "P&L from the posted general ledger: revenue, cost of sales, gross and net profit, the P&L statement, costs by account, division and department, and journal-line drill-down.",
    icon: Landmark,
    source: "ZF_F_T_DETAIL_BI",
    filters: PERIOD_AND_COMPANY,
  },
  {
    slug: "sales-orders",
    title: "Sales orders",
    description:
      "The order book as of today: what customers have ordered that isn't delivered or invoiced yet, how old it is and who owns it, and orders booked in the period.",
    icon: ClipboardList,
    source: "ZF_SO_BI",
    filters: ALL_FILTERS,
  },
  {
    slug: "purchasing",
    title: "Purchasing",
    description:
      "Pending purchase orders with aging and overdue lines as of today, and receipts spend by month and supplier.",
    icon: ShoppingCart,
    source: "ZF_PO_PENDING_BI · ZF_CPR_BI",
    filters: PERIOD_AND_COMPANY,
  },
  {
    slug: "receivables-payables",
    title: "Receivables & payables",
    shortTitle: "AR & AP",
    description:
      "Open customer and vendor balances as of today: aging, top customers and vendors, salesperson follow-up, PDCs and vendor prepayments.",
    icon: Scale,
    source: "ZF_SOA_DETL_CUST_INV_SM_BI · ZF_SOAP_DETL_BI",
    filters: COMPANY_ONLY,
  },
  {
    slug: "products",
    title: "Product mix",
    description:
      "Where revenue comes from and where it is growing: a brand → item treemap coloured by change vs last year, and watchlists of growers, decliners, discounts and returns.",
    icon: LayoutGrid,
    source: "ZF_CSL_BI · ZF_STK_SO_PO_SL_BI",
    filters: ALL_FILTERS,
  },
];

export const OVERVIEW = {
  href: "/",
  title: "Overview",
  icon: LayoutDashboard,
  // Its sales figures follow the salesperson and brand filters; the scope line says so.
  filters: ALL_FILTERS,
} as const;

/** The cookie that remembers whether the nav rail is expanded; the layout reads it, so nothing jumps. */
export const NAV_RAIL_COOKIE = "nav_rail";

/** The daily snapshot email preview. Deliberately not in the nav rail, and it has no filters. */
export const SNAPSHOT = { href: "/snapshot", title: "Daily snapshot" } as const;

export function dashboardHref(dashboard: Dashboard): string {
  return `/${dashboard.slug}`;
}

/**
 * How a page applies the salesperson and brand filters: to every figure ("all"), to its sales
 * figures only ("sales": the Overview), to its sales and open orders ("sales-orders": the
 * customer and item pages), or not at all ("none").
 */
export type SalesFilterSupport = "all" | "sales" | "sales-orders" | "none";

export function salesFilterSupport(pathname: string): SalesFilterSupport {
  if (pathname === "/") return "sales";
  if (pathname.startsWith("/customers/") || pathname.startsWith("/items/")) return "sales-orders";
  return dashboardForPath(pathname)?.filters.includes("salesperson") ? "all" : "none";
}

/** The Filters panel groups for a page; none on pages that aren't dashboards (the snapshot). */
export function filterGroupsForPath(pathname: string): readonly FilterGroup[] {
  if (pathname === OVERVIEW.href) return OVERVIEW.filters;
  // Customer and item pages show sales and open orders for one customer or item.
  if (pathname.startsWith("/customers/") || pathname.startsWith("/items/")) return ALL_FILTERS;
  return dashboardForPath(pathname)?.filters ?? [];
}

/** The registry entry for a path like `/sales`, if any. */
export function dashboardForPath(pathname: string): Dashboard | undefined {
  const slug = pathname.split("/")[1];
  return DASHBOARDS.find((dashboard) => dashboard.slug === slug);
}
