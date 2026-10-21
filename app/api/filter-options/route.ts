import { parseFilters, todayIso } from "@/lib/filters";
import { load } from "@/lib/server/errors";
import { salesFilterOptions } from "@/lib/server/queries/sales-filters";

/**
 * The choices of the salesperson and brand filters for the top bar: only those with sales in the
 * selected companies and period. Takes the page's own filter query string.
 *
 *   GET /api/filter-options?range=ytd&company=101,107
 *
 * Answers `{ ok: true, data: { salespeople: [{ code, name }], brands: [{ code, name }] } }`, or
 * `{ ok: false, message }` with a friendly message (502 when Orion fails). Every value is a bind.
 */
export async function GET(request: Request) {
  const filters = parseFilters(new URL(request.url).searchParams, todayIso());
  const result = await load(() => salesFilterOptions(filters));
  return Response.json(result, { status: result.ok ? 200 : 502 });
}
