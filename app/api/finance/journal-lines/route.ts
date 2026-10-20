import { parseFilters, todayIso } from "@/lib/filters";
import { load } from "@/lib/server/errors";
import { journalLines } from "@/lib/server/queries/finance";

const ACCOUNT_RE = /^[\w.-]{1,30}$/;

/**
 * The Finance drill-down: posted journal lines on one GL main account, for the shared filters.
 *
 *   GET /api/finance/journal-lines?account=40809&range=qtd&company=101
 *
 * Answers `{ ok: true, data }` or `{ ok: false, message }` with a friendly message, like the
 * dashboard sections. A read, so a route handler rather than a server action.
 */
export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const account = params.get("account") ?? "";
  if (!ACCOUNT_RE.test(account)) {
    return Response.json(
      { ok: false, message: "Pick a GL account to see its journal lines." },
      { status: 400 },
    );
  }
  const filters = parseFilters(params, todayIso());
  const result = await load(() => journalLines(filters, account));
  return Response.json(result, { status: result.ok ? 200 : 502 });
}
