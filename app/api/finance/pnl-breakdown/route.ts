import { parseFilters, todayIso } from "@/lib/filters";
import { bucketFilters } from "@/lib/periods";
import { load } from "@/lib/server/errors";
import { pnlHover } from "@/lib/server/queries/finance";

/**
 * The Monthly P&L hover card: one bar's revenue, cost of sales, G&A and net profit against the
 * same days last year, and net profit by company, for the shared filters.
 *
 *   GET /api/finance/pnl-breakdown?period=2026-10&range=ytd&company=101     a month (or `YYYY`) bar
 *
 * The bar is the filters narrowed to its days. Answers `{ ok: true, data }` or
 * `{ ok: false, message }`. Every query goes through `runQuery` (read-only guard, binds, cache).
 */
export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const filters = bucketFilters(parseFilters(params, todayIso()), params.get("period"));
  if (!filters) {
    return Response.json({ ok: false, message: "Pick a month in the selected period." }, { status: 400 });
  }
  const result = await load(() => pnlHover(filters));
  return Response.json(result, { status: result.ok ? 200 : 502 });
}
