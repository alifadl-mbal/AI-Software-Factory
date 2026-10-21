import { parseFilters, todayIso } from "@/lib/filters";
import { clipToBucket } from "@/lib/periods";
import { load } from "@/lib/server/errors";
import { receiptsHover } from "@/lib/server/queries/purchasing";

const PERIOD_RE = /^\d{4}(-(0[1-9]|1[0-2]))?$/;

/**
 * The Purchasing hover card: what makes up one bar of the receipts trend, for the shared filters.
 *
 *   GET /api/purchasing/breakdown?period=2026-10&range=ytd&company=101&brand=B1
 *
 * A month (or `YYYY`) bar is the filters narrowed to its days. Answers `{ ok: true, data }` or
 * `{ ok: false, message }`. Every query goes through `runQuery` (read-only guard, binds, cache).
 */
export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const filters = parseFilters(params, todayIso());
  const period = params.get("period") ?? "";
  const clipped = PERIOD_RE.test(period) ? clipToBucket(filters, period) : null;
  if (!clipped) {
    return Response.json({ ok: false, message: "Pick a month in the selected period." }, { status: 400 });
  }
  const result = await load(() => receiptsHover(clipped));
  return Response.json(result, { status: result.ok ? 200 : 502 });
}
