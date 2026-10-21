import { parseFilters, todayIso } from "@/lib/filters";
import { parseOrderAge } from "@/lib/order-age";
import { clipToBucket } from "@/lib/periods";
import { BUCKET_PARAM, parseBucket } from "@/lib/sales-orders-drill";
import { load } from "@/lib/server/errors";
import { bookedHover, openAgeHover } from "@/lib/server/queries/sales-orders";

const PERIOD_RE = /^\d{4}(-(0[1-9]|1[0-2]))?$/;

/**
 * The Sales orders hover cards, for the shared filters:
 *
 *   GET /api/sales-orders/breakdown?period=2026-10&range=ytd       a month of the booked trend
 *   GET /api/sales-orders/breakdown?bucket=3&since=12m&company=101  a column of the order-age chart
 *
 * A month bar is the filters narrowed to that month's days; an order-age column is the open book as
 * of today, on the order-age choice (`?since=`). Answers `{ ok: true, data }` or
 * `{ ok: false, message }`. Every query goes through `runQuery`.
 */
export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const today = todayIso();
  const filters = parseFilters(params, today);
  const period = params.get("period");
  if (period !== null) {
    const clipped = PERIOD_RE.test(period) ? clipToBucket(filters, period) : null;
    if (!clipped) return badRequest("Pick a month in the selected period.");
    const result = await load(() => bookedHover(clipped));
    return Response.json(result, { status: result.ok ? 200 : 502 });
  }
  const bucket = parseBucket(params.get(BUCKET_PARAM));
  if (bucket !== null) {
    const result = await load(() => openAgeHover(filters, today, parseOrderAge(params), bucket));
    return Response.json(result, { status: result.ok ? 200 : 502 });
  }
  return badRequest("Pick a month or an order-age column to see its breakdown.");
}

function badRequest(message: string) {
  return Response.json({ ok: false, message }, { status: 400 });
}
