import { parseFilters, todayIso } from "@/lib/filters";
import { parseStockMonth } from "@/lib/inventory-drill";
import { load } from "@/lib/server/errors";
import { monthEndHover } from "@/lib/server/queries/inventory";

/**
 * The month-end stock hover card: one bar's closing value against the same month-end last year,
 * and its top companies, brands and item groups, for the company and brand filters.
 *
 *   GET /api/inventory/month-end?month=2026-09&company=101&brand=NW
 *
 * Answers `{ ok: true, data }` or `{ ok: false, message }`. Every query goes through `runQuery`.
 */
export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const { companies, brands } = parseFilters(params, todayIso());
  const month = parseStockMonth(params.get("month"));
  if (!month) return Response.json({ ok: false, message: "Pick a month-end." }, { status: 400 });
  const result = await load(() => monthEndHover({ companies, brands }, month));
  return Response.json(result, { status: result.ok ? 200 : 502 });
}
