import { parseFilters, todayIso } from "@/lib/filters";
import { parseOrderAge } from "@/lib/order-age";
import { drillFilters, drillRange, DRILL_PARAM } from "@/lib/sales-drill";
import { BUCKET_PARAM, parseBucket } from "@/lib/sales-orders-drill";
import { load } from "@/lib/server/errors";
import { bookedOrders, openAgeOrders } from "@/lib/server/queries/sales-orders";

/**
 * The Sales orders drill-downs: the orders behind one bar, for the shared filters.
 *
 *   GET /api/sales-orders/orders?drill=2026-10&range=ytd     orders booked in a month (cut to the range)
 *   GET /api/sales-orders/orders?bucket=3&since=12m          open orders in an order-age column
 *
 * Answers `{ ok: true, data }` or `{ ok: false, message }`.
 */
export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const today = todayIso();
  const filters = parseFilters(params, today);
  const bucket = parseBucket(params.get(BUCKET_PARAM));
  if (bucket !== null) {
    const result = await load(() => openAgeOrders(filters, today, parseOrderAge(params), bucket));
    return Response.json(result, { status: result.ok ? 200 : 502 });
  }
  const range = drillRange(params.get(DRILL_PARAM), filters);
  if (!range) {
    return Response.json(
      { ok: false, message: "Pick a month within the period, or an order-age column, to see its orders." },
      { status: 400 },
    );
  }
  const result = await load(() => bookedOrders(drillFilters(filters, range)));
  return Response.json(result, { status: result.ok ? 200 : 502 });
}
