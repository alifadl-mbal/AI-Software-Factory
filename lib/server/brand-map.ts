/**
 * Which brand an item belongs to. The sales view `ZF_CSL_BI` has no brand column, so brand comes
 * from a per-item map joined on the item code.
 *
 * Source: `MBALI.ZF_STK_SO_PO_SL_BI` (`"Item"`, `"Brand"`, `"Brand_Name"`; mixed-case, quoted).
 * Checked on live Orion on 2026-10-21 (shares, no amounts; details in docs/live-check.md):
 * - one brand per item code: no item has two brand codes, and no brand code has two names;
 * - it maps 94.5% of year-to-date net revenue (`ZF_CSL_BI`, `INV` + `SARTN`); the rest is
 *   'Unassigned', never dropped;
 * - it is small (about 12K rows), so the map costs well under a second per query.
 *
 * The other candidates: `ZF_STK_MTH_SUMM_BI.ZSL_BRAND` (the issue's "`ZF_CURR_STK_BI.ZSL_BRAND`";
 * the live `ZF_CURR_STK_BI` has no brand column) is also one brand per item and never disagrees
 * with this map, but it is 8M rows (about 5 s per scan) and maps less on its own (92.7%).
 * `ZF_SO_BI.D_FLEX_01_BRAND` is free text on order lines: 420 items carry more than one value, so
 * it can't be a one-brand-per-item map. The TNS dashboard's "brand" was `CSL_GROUP_NAME`, the item
 * group, which the Sales page already breaks down by.
 */

export const BRAND_VIEW = "MBALI.ZF_STK_SO_PO_SL_BI";

/** One row per item code: `item_code`, `brand_code`, `brand_name`. Items without a brand aren't in it. */
export const BRAND_MAP = `SELECT TRIM("Item") AS item_code, MAX(TRIM("Brand")) AS brand_code,
        MAX(TRIM("Brand_Name")) AS brand_name
    FROM ${BRAND_VIEW}
    WHERE NULLIF(TRIM("Brand"), '') IS NOT NULL AND NULLIF(TRIM("Item"), '') IS NOT NULL
    GROUP BY TRIM("Item")`;
