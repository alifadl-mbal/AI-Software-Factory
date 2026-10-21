import { parseFilters, todayIso } from "@/lib/filters";
import { parseOrderAge } from "@/lib/order-age";
import { DOC_PARAM, drillFilters, drillRange, DRILL_PARAM, parseDocParam } from "@/lib/sales-drill";
import { BUCKET_PARAM, parseBucket } from "@/lib/sales-orders-drill";
import { load } from "@/lib/server/errors";
import { bookedOrderLines, openOrderLines } from "@/lib/server/queries/sales-orders";

/**
 * The lines of one order within a drilled bar, for the shared filters.
 *
 *   GET /api/sales-orders/order-lines?drill=2026-10&doc=101~SO5~1001&range=ytd   booked lines
 *   GET /api/sales-orders/order-lines?bucket=3&doc=101~SO5~1001&since=12m       open AED lines
 *
 * One query per opened order. Answers `{ ok: true, data }` or `{ ok: false, message }`.
 */
export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const today = todayIso();
  const filters = parseFilters(params, today);
  const doc = parseDocParam(params.get(DOC_PARAM));
  const bucket = parseBucket(params.get(BUCKET_PARAM));
  const range = drillRange(params.get(DRILL_PARAM), filters);
  if (!doc || (bucket === null && !range)) {
    return Response.json({ ok: false, message: "Pick an order to see its lines." }, { status: 400 });
  }
  const result = await load(() =>
    bucket !== null
      ? openOrderLines(filters, today, parseOrderAge(params), bucket, doc)
      : bookedOrderLines(drillFilters(filters, range!), doc),
  );
  return Response.json(result, { status: result.ok ? 200 : 502 });
}
