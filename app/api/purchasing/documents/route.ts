import { parseFilters, todayIso } from "@/lib/filters";
import { drillFilters, drillRange, DRILL_PARAM } from "@/lib/sales-drill";
import { load } from "@/lib/server/errors";
import { receiptDocuments } from "@/lib/server/queries/purchasing";

/**
 * The Purchasing drill-down: the receipt documents (GRNs and returns to supplier) behind one month
 * of the receipts trend, for the shared filters.
 *
 *   GET /api/purchasing/documents?drill=2026-10&range=ytd&company=101
 *
 * The period is cut to the filtered range (see `lib/sales-drill.ts`). Answers `{ ok: true, data }`
 * or `{ ok: false, message }`.
 */
export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const filters = parseFilters(params, todayIso());
  const range = drillRange(params.get(DRILL_PARAM), filters);
  if (!range) {
    return Response.json(
      { ok: false, message: "Pick a month within the period to see its receipts." },
      { status: 400 },
    );
  }
  const result = await load(() => receiptDocuments(drillFilters(filters, range)));
  return Response.json(result, { status: result.ok ? 200 : 502 });
}
