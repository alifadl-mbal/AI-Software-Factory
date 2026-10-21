import {
  Boxes,
  ClipboardList,
  Landmark,
  LayoutDashboard,
  Scale,
  ShoppingCart,
  TrendingUp,
  type LucideIcon,
} from "lucide-react";

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
  /** What the top bar says instead on phones, when the title doesn't fit beside the controls there. */
  shortTitle?: string;
  /** One sentence for the Overview card and the page header. */
  description: string;
  icon: LucideIcon;
  /** The Orion view(s) the dashboard reads, shown on the Overview card. */
  source: string;
  /** False for dashboards that show "as of today" figures: the top bar then hides the date filter. */
  dateFilter?: boolean;
  /**
   * True when every figure follows the salesperson and brand filters (its views have both). Elsewhere
   * the top bar shows them disabled, and the scope line says when one is set but doesn't apply.
   */
  salesFilters?: boolean;
}

export const DASHBOARDS: readonly Dashboard[] = [
  {
    slug: "sales",
    title: "Sales",
    description:
      "Net revenue, gross margin, invoices and returns, with breakdowns by company, customer, item, salesperson, brand and item group.",
    icon: TrendingUp,
    source: "ZF_CSL_BI",
    salesFilters: true,
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
  {
    slug: "sales-orders",
    title: "Sales orders",
    description:
      "The order book as of today: what customers have ordered that isn't delivered or invoiced yet, how old it is and who owns it, and orders booked in the period.",
    icon: ClipboardList,
    source: "ZF_SO_BI",
    salesFilters: true,
  },
  {
    slug: "purchasing",
    title: "Purchasing",
    description:
      "Pending purchase orders with aging and overdue lines as of today, and receipts spend by month and supplier.",
    icon: ShoppingCart,
    source: "ZF_PO_PENDING_BI · ZF_CPR_BI",
  },
  {
    slug: "receivables-payables",
    title: "Receivables & payables",
    shortTitle: "AR & AP",
    description:
      "Open customer and vendor balances as of today: aging, top customers and vendors, salesperson follow-up, PDCs and vendor prepayments.",
    icon: Scale,
    source: "ZF_SOA_DETL_CUST_INV_SM_BI · ZF_SOAP_DETL_BI",
    dateFilter: false,
  },
];

export const OVERVIEW = { href: "/", title: "Overview", icon: LayoutDashboard } as const;

/** The daily snapshot email preview. Deliberately not in the sidebar. */
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
  return dashboardForPath(pathname)?.salesFilters ? "all" : "none";
}

/** The registry entry for a path like `/sales`, if any. */
export function dashboardForPath(pathname: string): Dashboard | undefined {
  const slug = pathname.split("/")[1];
  return DASHBOARDS.find((dashboard) => dashboard.slug === slug);
}
