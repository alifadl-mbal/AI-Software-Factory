import { parseFilters, todayIso } from "@/lib/filters";
import { DOC_PARAM, drillFilters, drillRange, DRILL_PARAM, parseDocParam } from "@/lib/sales-drill";
import { load } from "@/lib/server/errors";
import { receiptLines } from "@/lib/server/queries/purchasing";

/**
 * The lines of one receipt document within a drilled period, for the shared filters.
 *
 *   GET /api/purchasing/document-lines?drill=2026-10&doc=101~GRN~10126&range=ytd
 *
 * One query per opened document. Answers `{ ok: true, data }` or `{ ok: false, message }`.
 */
export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const filters = parseFilters(params, todayIso());
  const range = drillRange(params.get(DRILL_PARAM), filters);
  const doc = parseDocParam(params.get(DOC_PARAM));
  if (!range || !doc) {
    return Response.json(
      { ok: false, message: "Pick a receipt within the period to see its lines." },
      { status: 400 },
    );
  }
  const result = await load(() => receiptLines(drillFilters(filters, range), doc));
  return Response.json(result, { status: result.ok ? 200 : 502 });
}
