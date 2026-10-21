import { parseFilters, todayIso } from "@/lib/filters";
import { parseStockMonth } from "@/lib/inventory-drill";
import { load } from "@/lib/server/errors";
import { monthEndItems } from "@/lib/server/queries/inventory";

/**
 * The month-end stock drill-down: the items of one bar, largest closing value first, with the
 * count and value of all of them, for the company and brand filters.
 *
 *   GET /api/inventory/month-end-items?month=2026-09&company=101
 */
export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const { companies, brands } = parseFilters(params, todayIso());
  const month = parseStockMonth(params.get("month"));
  if (!month) {
    return Response.json({ ok: false, message: "Pick a month-end to see its items." }, { status: 400 });
  }
  const result = await load(() => monthEndItems({ companies, brands }, month));
  return Response.json(result, { status: result.ok ? 200 : 502 });
}
