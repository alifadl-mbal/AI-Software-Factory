import "server-only";

import { presetRange } from "@/lib/filters";
import { averageMonthlyQty, monthsOfCover } from "@/lib/items";

import { run } from "../db";
import { ALL_OTHER, num, UNASSIGNED } from "../sql";
import type { Query } from "../types";
import { likeEscape, SEARCH_LIMIT, type SearchResult } from "./customers";
import { stockByLocation } from "./inventory";
import { salesKpis } from "./sales";

/**
 * The item master, `MBALI.ZF_ITEM`, for the item page and the header search. What was checked on
 * live Orion (2026-10-20):
 *
 * - **One code space.** `IM_ITEM_CODE` (VARCHAR2(20)) is the key every view uses for an item:
 *   `ZF_CSL_BI.CSL_ITEM_CODE` (3,162 codes sold since 2025), `ZF_CURR_STK_BI.CS_ITEM_CODE` (37,037
 *   codes in stock), `ZF_STK_MTH_SUMM_BI.ZSL_ITEM_CODE` (36,948 codes at a 2026 month-end),
 *   `ZF_PO_PENDING_BI.PO_ITEM_CODE` (2,030 codes on pending lines) and `ZF_SO_BI.D_ITEM_CODE` (2,871
 *   codes on orders since 2025). None of them was missing from the master. The item page filters
 *   each view on its own code column with the same value.
 * - **One row per code, owned by one company.** The master is unique on `(IM_COMP_CODE,
 *   IM_ITEM_CODE)` as documented, but also on the code alone: 49,484 rows, 49,484 codes, 18
 *   companies. Yet an item moves in other companies too: 322 stock keys, 21 sales keys, 35 pending
 *   PO keys and 20 order keys are in a company other than the master row's. So the page reads the
 *   master by code alone, shows each company's planning fields when there are several rows that
 *   differ, and the stock, sales and order sections cover every company the filter allows.
 * - **Names:** on sales and stock the line's name equals `IM_ITEM_NAME` for every code; on pending
 *   POs (`PO_ITEM_DESC`) and orders (`D_ITEM_DESC`) the line keeps its own text, which differs on
 *   many lines. The page shows the master name. Names aren't unique, so a dashboard row grouped by
 *   name (Sales top items) links only when one code carries that name.
 * - **Codes hold odd characters:** 1,541 have `/`, `?`, `#`, `%`, `&` or spaces, and 2 a leading
 *   space. Links encode them; the code is only ever bound.
 * - **Flags are words:** `IM_FRZ_FLAG` is `Active` / `Freeze` (blank on 29 rows), `IM_STK_YN` is
 *   `Stock` / `Non Stock`. Reorder planning (`IM_MIN_STK`, `IM_MAX_STK`, `IM_RORD_LVL`,
 *   `IM_RORD_QTY`) is set on a few hundred items, nearly all in company 107; `IM_LEAD_TIME` is in
 *   days (0, 30, 56, 75 or 90) and NULL on 2,653 rows.
 * - **Quantity sold** is `SUM(CSL_QTY)` over the revenue rows; see `queries/sales.ts`.
 * - Searching the 49K rows with `LIKE '%…%'` on name and code takes well under a second.
 */

const VIEW = "MBALI.ZF_ITEM";

const FROZEN = "Freeze";
const STOCK_ITEM = "Stock";
const PLANNING_FIELDS = ["minStock", "maxStock", "reorderLevel", "reorderQty", "leadTimeDays"] as const;

/** One company's master row: flags and reorder planning. */
export interface ItemCompany {
  companyCode: string;
  frozen: boolean;
  /** `Stock` items are held in stock; `Non Stock` ones (services, kits) aren't. */
  stockItem: boolean;
  minStock: number | null;
  maxStock: number | null;
  reorderLevel: number | null;
  reorderQty: number | null;
  leadTimeDays: number | null;
}

export interface Item {
  code: string;
  name: string;
  group: string | null;
  /** One row per company that carries the item, by company code. */
  companies: ItemCompany[];
}

/** Item codes as Orion stores them: 1-20 characters, no control characters, not all blank. */
export function isItemCode(code: string): boolean {
  return code.length >= 1 && code.length <= 20 && code.trim() !== "" && !/\p{C}/u.test(code);
}

function text(raw: unknown): string | null {
  if (raw === null || raw === undefined) return null;
  const value = String(raw).trim();
  return value === "" ? null : value;
}

function maybeNum(raw: unknown): number | null {
  return raw === null || raw === undefined || raw === "" ? null : num(raw);
}

export function itemQuery(code: string): Query {
  return {
    sql: `
SELECT IM_COMP_CODE AS comp_code, IM_ITEM_CODE AS code, IM_ITEM_NAME AS name, IM_GROUP_NAME AS group_name,
    IM_FRZ_FLAG AS frz_flag, IM_STK_YN AS stk_yn, IM_MIN_STK AS min_stk, IM_MAX_STK AS max_stk,
    IM_RORD_LVL AS rord_lvl, IM_RORD_QTY AS rord_qty, IM_LEAD_TIME AS lead_time
FROM ${VIEW}
WHERE IM_ITEM_CODE = :item_code
ORDER BY IM_COMP_CODE`,
    binds: { item_code: code },
  };
}

/** The item with this code, or `null` if the master has none. */
export async function item(code: string): Promise<Item | null> {
  if (!isItemCode(code)) return null;
  const rows = await run(itemQuery(code));
  if (rows.length === 0) return null;
  return {
    code: String(rows[0].code),
    name: rows.map((row) => text(row.name)).find(Boolean) ?? code,
    group: rows.map((row) => text(row.group_name)).find(Boolean) ?? null,
    companies: rows.map((row) => ({
      companyCode: String(row.comp_code),
      frozen: text(row.frz_flag) === FROZEN,
      stockItem: text(row.stk_yn) === STOCK_ITEM,
      minStock: maybeNum(row.min_stk),
      maxStock: maybeNum(row.max_stk),
      reorderLevel: maybeNum(row.rord_lvl),
      reorderQty: maybeNum(row.rord_qty),
      leadTimeDays: maybeNum(row.lead_time),
    })),
  };
}

/**
 * The item for the `[code]` route segment. Next.js hands the page a segment holding an encoded `/`
 * (`%2F`) still percent-encoded, while `generateMetadata` gets it decoded, so the code is tried as
 * given and then decoded. Codes that merely contain `%` are found on the first try.
 */
export async function itemByRouteParam(param: string): Promise<Item | null> {
  const found = await item(param);
  if (found) return found;
  let decoded: string;
  try {
    decoded = decodeURIComponent(param);
  } catch {
    return null;
  }
  return decoded === param ? null : item(decoded);
}

/** Whether the companies' reorder planning differs, so the page has to show it per company. */
export function planningDiffers(companies: readonly ItemCompany[]): boolean {
  return companies.some((company) => PLANNING_FIELDS.some((field) => company[field] !== companies[0][field]));
}

/**
 * Items whose description or code contains `text` (case-insensitive), best matches first: the exact
 * code, then codes and names that start with it, then the rest by name. One result per code, with
 * its group as the second line. `text` is only ever bound.
 */
export function itemSearchQuery(text: string, limit = SEARCH_LIMIT): Query {
  return {
    sql: `
SELECT code, name, group_name
FROM (
    SELECT code, name, group_name,
        ROW_NUMBER() OVER (
            ORDER BY CASE
                WHEN UPPER(code) = :exact THEN 0
                WHEN UPPER(code) LIKE :prefix ESCAPE '\\' THEN 1
                WHEN UPPER(name) LIKE :prefix ESCAPE '\\' THEN 2
                ELSE 3
            END, UPPER(name), code
        ) AS rn
    FROM (
        SELECT IM_ITEM_CODE AS code, MAX(IM_ITEM_NAME) AS name, MAX(IM_GROUP_NAME) AS group_name
        FROM ${VIEW}
        WHERE UPPER(IM_ITEM_NAME) LIKE :contains ESCAPE '\\' OR UPPER(IM_ITEM_CODE) LIKE :contains ESCAPE '\\'
        GROUP BY IM_ITEM_CODE
    ) matched
) ranked
WHERE rn <= :row_limit
ORDER BY rn`,
    binds: {
      exact: text.toUpperCase(),
      prefix: `${likeEscape(text.toUpperCase())}%`,
      contains: `%${likeEscape(text.toUpperCase())}%`,
      row_limit: limit,
    },
  };
}

export async function searchItems(text: string, limit = SEARCH_LIMIT): Promise<SearchResult[]> {
  const rows = await run(itemSearchQuery(text, limit));
  return rows.map((row) => ({
    kind: "item",
    code: String(row.code),
    name: (row.name !== null && row.name !== undefined && String(row.name).trim()) || String(row.code),
    detail: row.group_name ? String(row.group_name).trim() || null : null,
  }));
}

/**
 * The item code behind each name, for the dashboard tables that list items by name. Only names
 * that a single master code carries are returned: a shared name stays unlinked, since its figure on
 * the dashboard adds every code under it up. (A code with a row in several companies counts once.)
 */
export function itemCodesByNameQuery(names: readonly string[]): Query {
  const binds = Object.fromEntries(names.map((name, index) => [`name_${index}`, name]));
  return {
    sql: `
SELECT TRIM(IM_ITEM_NAME) AS name, MIN(IM_ITEM_CODE) AS code
FROM ${VIEW}
WHERE TRIM(IM_ITEM_NAME) IN (${names.map((_, index) => `:name_${index}`).join(", ")})
GROUP BY TRIM(IM_ITEM_NAME)
HAVING COUNT(DISTINCT IM_ITEM_CODE) = 1`,
    binds,
  };
}

export async function itemCodesByName(names: readonly string[]): Promise<Map<string, string>> {
  // The dashboards' own labels for a blank name and the folded tail are never items.
  const unique = [...new Set(names)].filter((name) => name !== UNASSIGNED && name !== ALL_OTHER);
  if (unique.length === 0) return new Map();
  const rows = await run(itemCodesByNameQuery(unique));
  return new Map(rows.map((row) => [String(row.name), String(row.code)]));
}

export interface Cover {
  /** Available stock today (on hand less reserved), every location of the companies. */
  available: number;
  /** Units sold in the last 12 months (to `today`), net of returns. */
  soldLast12Months: number;
  /** Average units sold a month over those 12 months. */
  averageMonthly: number;
  /** `available / averageMonthly`; `null` when nothing sold (shown as "no recent sales"). */
  months: number | null;
}

/**
 * Months of cover of one item, as of `today`: available stock over the average monthly quantity
 * sold in the last 12 months, both for the same companies. Both figures come from the dashboards'
 * own queries narrowed to the item (the Inventory KPI rule and the Sales revenue rows).
 */
export async function itemCover(companies: string[], today: string, code: string): Promise<Cover> {
  // Stock has no salesperson or brand, so cover always compares with every sale of the item.
  const window = {
    range: "12m" as const,
    ...presetRange("12m", today),
    companies,
    salespeople: [],
    brands: [],
  };
  const [stock, sales] = await Promise.all([
    stockByLocation(companies, code),
    salesKpis(window, { item: code }),
  ]);
  const available = stock.reduce((sum, row) => sum + row.availableQty, 0);
  const averageMonthly = averageMonthlyQty(sales.quantity);
  return {
    available,
    soldLast12Months: sales.quantity,
    averageMonthly,
    months: monthsOfCover(available, averageMonthly),
  };
}
