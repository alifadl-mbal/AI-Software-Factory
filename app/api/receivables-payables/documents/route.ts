import { parseAgingAccount, parseBucket, parseSide } from "@/lib/aging-drill";
import { parseFilters, todayIso } from "@/lib/filters";
import { load } from "@/lib/server/errors";
import { apDocuments, arDocuments } from "@/lib/server/queries/ar-ap";

/**
 * The aging drill-down's second level: one customer's (AR) or vendor's (AP) open documents in one
 * column, largest first, as of today. Narrowed to one account, so it is light even on the AR view.
 *
 *   GET /api/receivables-payables/documents?side=ar&bucket=3&account=C0001&company=101
 *   GET /api/receivables-payables/documents?side=ap&bucket=3&account=101%7CV0001
 */
export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const { companies, salespeople } = parseFilters(params, todayIso());
  const side = parseSide(params.get("side"));
  const bucket = parseBucket(params.get("bucket"));
  const account = parseAgingAccount(params.get("account"));
  if (side === null || bucket === null || account === null || (side === "ap" && !account.includes("|"))) {
    return Response.json({ ok: false, message: "Pick a customer or vendor." }, { status: 400 });
  }
  const asOf = todayIso();
  const result = await load(() =>
    side === "ap"
      ? apDocuments(asOf, account, bucket)
      : arDocuments(asOf, { companies, salespeople }, account, undefined, bucket),
  );
  return Response.json(result, { status: result.ok ? 200 : 502 });
}
