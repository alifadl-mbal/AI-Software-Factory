import { parseFilters, todayIso } from "@/lib/filters";
import { bucketFilters } from "@/lib/periods";
import { load } from "@/lib/server/errors";
import { pnlStatement, statementRows } from "@/lib/server/queries/finance";

/**
 * The Monthly P&L drill-down: the P&L statement of one bar (its lines and their GL accounts),
 * against the same days last year, for the shared filters.
 *
 *   GET /api/finance/statement?period=2026-10&range=ytd&company=101
 *
 * Rows are in display terms (costs positive), as on the Finance statement. The journal lines of
 * one account come from `/api/finance/journal-lines` with the filters narrowed to the bar's days.
 */
export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const filters = bucketFilters(parseFilters(params, todayIso()), params.get("period"));
  if (!filters) {
    return Response.json(
      { ok: false, message: "Pick a month in the selected period to see its P&L." },
      { status: 400 },
    );
  }
  const result = await load(async () => statementRows(await pnlStatement(filters)));
  return Response.json(result, { status: result.ok ? 200 : 502 });
}
