import { parseFilters, todayIso } from "@/lib/filters";
import { drillFilters, drillRange, DRILL_PARAM } from "@/lib/sales-drill";
import { load } from "@/lib/server/errors";
import { salesDocuments } from "@/lib/server/queries/sales";

/**
 * The Sales drill-down: the documents behind one month, week or day, for the shared filters.
 *
 *   GET /api/sales/documents?drill=2026-10&range=ytd&company=101
 *
 * The period is cut to the filtered range (see `lib/sales-drill.ts`). Answers `{ ok: true, data }`
 * or `{ ok: false, message }` with a friendly message, like the dashboard sections. Sign-in is
 * checked by the proxy, as for every API route.
 */
export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const filters = parseFilters(params, todayIso());
  const range = drillRange(params.get(DRILL_PARAM), filters);
  if (!range) {
    return Response.json(
      { ok: false, message: "Pick a month, week or day within the period to see its documents." },
      { status: 400 },
    );
  }
  const result = await load(() => salesDocuments(drillFilters(filters, range)));
  return Response.json(result, { status: result.ok ? 200 : 502 });
}
