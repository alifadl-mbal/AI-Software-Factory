import { parseFilters, todayIso } from "@/lib/filters";
import { clipToBucket } from "@/lib/periods";
import { load } from "@/lib/server/errors";
import { isItemCode } from "@/lib/server/queries/items";
import { salesHoverBreakdown } from "@/lib/server/queries/sales";

const PERIOD_RE = /^\d{4}(-(0[1-9]|1[0-2]))?$/;

/**
 * The item page's hover card: one month of an item's sales by company, for the shared filters.
 *
 *   GET /api/items/breakdown?code=IT00004&period=2026-10&range=ytd&company=101
 *
 * The same loader as the Sales card, narrowed to the item, so units and net revenue are the item
 * page's own figures. Answers `{ ok: true, data }` or `{ ok: false, message }`.
 */
export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const filters = parseFilters(params, todayIso());
  const code = params.get("code") ?? "";
  const period = params.get("period") ?? "";
  const clipped = PERIOD_RE.test(period) ? clipToBucket(filters, period) : null;
  if (!isItemCode(code) || !clipped) {
    return Response.json(
      { ok: false, message: "Pick a month of this item's sales in the selected period." },
      { status: 400 },
    );
  }
  const result = await load(() => salesHoverBreakdown(clipped, ["company"], undefined, code));
  return Response.json(result, { status: result.ok ? 200 : 502 });
}
