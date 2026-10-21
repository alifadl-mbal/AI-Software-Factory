import { parseFilters, todayIso } from "@/lib/filters";
import { load } from "@/lib/server/errors";
import { arSalespersonOptions } from "@/lib/server/queries/ar-ap";
import { stockBrandOptions } from "@/lib/server/queries/inventory";
import { salesFilterOptions, sortOptions } from "@/lib/server/queries/sales-filters";

/**
 * The choices of the salesperson and brand filters for the Filters panel. Takes the page's own
 * filter query string, and `source` from the page's registry entry (`Dashboard.filterOptions`):
 *
 *   GET /api/filter-options?range=ytd&company=101,107                 with sales in the period
 *   GET /api/filter-options?company=101&source=stock                  brands of items in live stock
 *   GET /api/filter-options?company=101&source=receivables            salespeople with open AR
 *
 * Answers `{ ok: true, data: { salespeople: [{ code, name }], brands: [{ code, name }] } }`, or
 * `{ ok: false, message }` with a friendly message (502 when Orion fails). Every value is a bind.
 */
export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const today = todayIso();
  const filters = parseFilters(params, today);
  const source = params.get("source");
  const result = await load(async () => {
    if (source === "stock") {
      return { salespeople: [], brands: sortOptions(await stockBrandOptions(filters.companies)) };
    }
    if (source === "receivables") {
      return { salespeople: sortOptions(await arSalespersonOptions(today, filters.companies)), brands: [] };
    }
    return salesFilterOptions(filters);
  });
  return Response.json(result, { status: result.ok ? 200 : 502 });
}
