import "server-only";

import { run } from "../db";
import { ALL_OTHER, num, UNASSIGNED } from "../sql";
import type { Query } from "../types";

/**
 * The customer master, `MBALI.ZF_CUSTOMER`, for the customer page and the header search. What was
 * checked on live Orion (2026-10-20):
 *
 * - **One row per customer:** 25,483 rows, 25,483 distinct `CUST_CODE` (VARCHAR2(12), never NULL)
 *   but only 24,476 distinct `CUST_NAME`: some names are shared (Amazon.ae has two accounts, for
 *   instance), so a name alone doesn't always identify a customer.
 * - **One code space.** `ZF_CSL_BI.CSL_CUST_CODE` (2,590 codes with sales since 2025),
 *   `ZF_SOA_DETL_CUST_INV_SM_BI.SDR_SUB_ACNT_CODE` (1,220 codes with an open AR line) and
 *   `ZF_SO_BI.H_CUST_CODE` (2,462 codes on orders since 2025) are all `CUST_CODE`s: none was
 *   missing from the master, and on sales and AR the name on the line equals `CUST_NAME` for every
 *   code. So the customer page filters each view on its own code column with the same value, and a
 *   name from the master is the name the dashboards show.
 * - **No salesperson or credit limit** in the master. Both are on the AR lines (`SDR_CUST_SM_NAME`,
 *   `SDR_CREDIT_LIMIT`; see `arProfile`). The master has type, category, parent, city and country,
 *   filled with placeholders (`NA`, `Not Applicable`, `Not Applicapble`) when unknown, and
 *   `CUST_FRZ_FLAG_NUM` (1 = frozen, 2 = active; 2,421 frozen).
 * - Searching 25K rows with `LIKE '%…%'` on name and code takes well under a second.
 */

const VIEW = "MBALI.ZF_CUSTOMER";

/** Search answers at most this many results. */
export const SEARCH_LIMIT = 20;
/** Shorter queries are not searched: they would match most of the master. */
export const SEARCH_MIN_LENGTH = 2;
/** Customer codes are VARCHAR2(12); search text is capped a little above any useful name prefix. */
export const SEARCH_MAX_LENGTH = 80;

const FROZEN_FLAG = 1;
/** Orion's fillers for an unknown master value, shown as nothing. */
const PLACEHOLDERS = new Set(["", "NA", "N/A", "NOT APPLICABLE", "NOT APPLICAPBLE"]);

export interface Customer {
  code: string;
  name: string;
  /** The parent account, when it isn't the customer itself. */
  parent: string | null;
  type: string | null;
  category: string | null;
  city: string | null;
  country: string | null;
  frozen: boolean;
}

/** What one search result is; the item search is in `queries/items.ts`. */
export type SearchKind = "customer" | "item";

export interface SearchResult {
  kind: SearchKind;
  code: string;
  name: string;
  /** A short second line, such as the city. */
  detail: string | null;
}

function value(raw: unknown): string | null {
  if (raw === null || raw === undefined) return null;
  const text = String(raw).trim();
  return PLACEHOLDERS.has(text.toUpperCase()) ? null : text;
}

/** Customer codes as Orion stores them: 1-12 visible characters. Anything else matches nothing. */
export function isCustomerCode(code: string): boolean {
  return /^[^\s\p{C}](?:[^\p{C}]{0,10}[^\s\p{C}])?$/u.test(code);
}

export function customerQuery(code: string): Query {
  return {
    sql: `
SELECT CUST_CODE AS code, CUST_NAME AS name, CUST_PARENT_NAME AS parent_name, CUST_TYPE_NAME AS type_name,
    CUST_CAT_NAME AS cat_name, CUST_CITY_NAME AS city_name, CUST_COUNTRY_NAME AS country_name,
    CUST_FRZ_FLAG_NUM AS frozen_flag
FROM ${VIEW}
WHERE CUST_CODE = :cust_code`,
    binds: { cust_code: code },
  };
}

/** The customer with this code, or `null` if the master has none. */
export async function customer(code: string): Promise<Customer | null> {
  if (!isCustomerCode(code)) return null;
  const [row] = await run(customerQuery(code));
  if (!row) return null;
  const name = value(row.name) ?? code;
  const parent = value(row.parent_name);
  return {
    code: String(row.code),
    name,
    parent: parent && parent !== name ? parent : null,
    type: value(row.type_name),
    category: value(row.cat_name),
    city: value(row.city_name),
    country: value(row.country_name),
    frozen: num(row.frozen_flag) === FROZEN_FLAG,
  };
}

/** `text` for a `LIKE … ESCAPE '\'` pattern, its wildcards taken literally. */
export function likeEscape(text: string): string {
  return text.replace(/[\\%_]/g, (char) => `\\${char}`);
}

/**
 * Customers whose name or code contains `text` (case-insensitive), best matches first: the exact
 * code, then codes and names that start with it, then the rest by name. `text` is only ever bound.
 */
export function searchQuery(text: string, limit = SEARCH_LIMIT): Query {
  return {
    sql: `
SELECT code, name, city_name
FROM (
    SELECT CUST_CODE AS code, CUST_NAME AS name, CUST_CITY_NAME AS city_name,
        ROW_NUMBER() OVER (
            ORDER BY CASE
                WHEN UPPER(CUST_CODE) = :exact THEN 0
                WHEN UPPER(CUST_CODE) LIKE :prefix ESCAPE '\\' THEN 1
                WHEN UPPER(CUST_NAME) LIKE :prefix ESCAPE '\\' THEN 2
                ELSE 3
            END, UPPER(CUST_NAME), CUST_CODE
        ) AS rn
    FROM ${VIEW}
    WHERE UPPER(CUST_NAME) LIKE :contains ESCAPE '\\' OR UPPER(CUST_CODE) LIKE :contains ESCAPE '\\'
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

/** Search text as typed, trimmed; `null` when it is too short to search. */
export function searchText(raw: string | null | undefined): string | null {
  const text = (raw ?? "").replace(/\s+/g, " ").trim().slice(0, SEARCH_MAX_LENGTH);
  return text.length >= SEARCH_MIN_LENGTH ? text : null;
}

export async function searchCustomers(text: string, limit = SEARCH_LIMIT): Promise<SearchResult[]> {
  const rows = await run(searchQuery(text, limit));
  return rows.map((row) => ({
    kind: "customer",
    code: String(row.code),
    name: value(row.name) ?? String(row.code),
    detail: value(row.city_name),
  }));
}

/**
 * The customer code behind each name, for the dashboard tables that list customers by name. Only
 * names that a single master code carries are returned: a shared name (two accounts, one name)
 * stays unlinked, since its figure on the dashboard adds both accounts up.
 */
export function codesByNameQuery(names: readonly string[]): Query {
  const binds = Object.fromEntries(names.map((name, index) => [`name_${index}`, name]));
  return {
    sql: `
SELECT TRIM(CUST_NAME) AS name, MIN(CUST_CODE) AS code
FROM ${VIEW}
WHERE TRIM(CUST_NAME) IN (${names.map((_, index) => `:name_${index}`).join(", ")})
GROUP BY TRIM(CUST_NAME)
HAVING COUNT(*) = 1`,
    binds,
  };
}

export async function customerCodesByName(names: readonly string[]): Promise<Map<string, string>> {
  // The dashboards' own labels for a blank name and the folded tail are never customers.
  const unique = [...new Set(names)].filter((name) => name !== UNASSIGNED && name !== ALL_OTHER);
  if (unique.length === 0) return new Map();
  const rows = await run(codesByNameQuery(unique));
  return new Map(rows.map((row) => [String(row.name), String(row.code)]));
}
