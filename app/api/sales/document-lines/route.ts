import { parseFilters, todayIso } from "@/lib/filters";
import { DOC_PARAM, drillFilters, drillRange, DRILL_PARAM, parseDocParam } from "@/lib/sales-drill";
import { load } from "@/lib/server/errors";
import { salesDocumentLines } from "@/lib/server/queries/sales";

/**
 * The lines of one sales document within a drilled period, for the shared filters.
 *
 *   GET /api/sales/document-lines?drill=2026-10&doc=101~IU5~1260&range=ytd
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
      { ok: false, message: "Pick a document within the period to see its lines." },
      { status: 400 },
    );
  }
  const result = await load(() => salesDocumentLines(drillFilters(filters, range), doc));
  return Response.json(result, { status: result.ok ? 200 : 502 });
}
