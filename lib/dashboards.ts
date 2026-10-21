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
   * Which of the salesperson and brand filters the page follows. Left out, neither: the top bar
   * shows them disabled, and the scope line says when one is set but doesn't apply.
   */
  salesFilters?: SalesFilterSupport;
}

/** Where the top bar gets a filter's choices from. */
export type FilterOptionsSource = "sales" | "stock" | "receivables";

/** How a page applies the salesperson and brand filters. */
export interface SalesFilterSupport {
  salespeople: boolean;
  brands: boolean;
  /**
   * Which figures follow them, when not every figure does, such as "sales figures only". The scope
   * line adds it in brackets while one of them is set.
   */
  only?: string;
  /**
   * Where the choices come from: salespeople and brands with sales in the companies and period
   * (`sales`, the default), brands of the items in live stock (`stock`), or the customers'
   * salespeople on open receivables (`receivables`).
   */
  options?: FilterOptionsSource;
}

const BOTH: SalesFilterSupport = { salespeople: true, brands: true };
const NONE: SalesFilterSupport = { salespeople: false, brands: false };

export const DASHBOARDS: readonly Dashboard[] = [
  {
    slug: "sales",
    title: "Sales",
    description:
      "Net revenue, gross margin, invoices and returns, with breakdowns by company, customer, item, salesperson, brand and item group.",
    icon: TrendingUp,
    source: "ZF_CSL_BI",
    salesFilters: BOTH,
  },
  {
    slug: "inventory",
    title: "Inventory",
    description:
      "Stock value as of today, the month-end trend, dead and slow stock, and items at or below their reorder level.",
    icon: Boxes,
    source: "ZF_CURR_STK_BI · ZF_STK_MTH_SUMM_BI · ZF_ITEM",
    dateFilter: false,
    // Brand through the per-item map, as on Sales. Stock has no salesperson.
    salesFilters: { salespeople: false, brands: true, options: "stock" },
  },
  {
    slug: "finance",
    title: "Finance",
    description:
      "P&L from the posted general ledger: revenue, cost of sales, gross and net profit, the P&L statement and journal-line drill-down.",
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
    salesFilters: BOTH,
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
    // The customer's own salesperson (`SDR_CUST_SM_CODE`) on AR. AP has no salesperson, no view brand.
    salesFilters: { salespeople: true, brands: false, only: "receivables only", options: "receivables" },
  },
  {
    slug: "products",
    title: "Product mix",
    description:
      "Where revenue comes from and where it is growing: a brand → item treemap coloured by change vs last year, and watchlists of growers, decliners, discounts and returns.",
    icon: LayoutGrid,
    source: "ZF_CSL_BI · ZF_STK_SO_PO_SL_BI",
    salesFilters: BOTH,
  },
];

export const OVERVIEW = { href: "/", title: "Overview", icon: LayoutDashboard } as const;

/** The daily snapshot email preview. Deliberately not in the sidebar. */
export const SNAPSHOT = { href: "/snapshot", title: "Daily snapshot" } as const;

export function dashboardHref(dashboard: Dashboard): string {
  return `/${dashboard.slug}`;
}

/**
 * How the page at `pathname` applies the salesperson and brand filters: as its registry entry says,
 * to the Overview's sales figures only, and to the customer and item pages' sales and open orders.
 */
export function salesFilterSupport(pathname: string): SalesFilterSupport {
  if (pathname === "/") return { ...BOTH, only: "sales figures only" };
  if (pathname.startsWith("/customers/") || pathname.startsWith("/items/")) {
    return { ...BOTH, only: "sales and open orders only" };
  }
  return dashboardForPath(pathname)?.salesFilters ?? NONE;
}

/** True when the page follows at least one of the two filters. */
export function hasSalesFilterSupport(support: SalesFilterSupport): boolean {
  return support.salespeople || support.brands;
}

/** The registry entry for a path like `/sales`, if any. */
export function dashboardForPath(pathname: string): Dashboard | undefined {
  const slug = pathname.split("/")[1];
  return DASHBOARDS.find((dashboard) => dashboard.slug === slug);
}
