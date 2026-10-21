import { parseBucket, parseSide } from "@/lib/aging-drill";
import { parseFilters, todayIso } from "@/lib/filters";
import { load } from "@/lib/server/errors";
import { apBucketVendors, arBucketCustomers } from "@/lib/server/queries/ar-ap";

/**
 * The aging drill-down's first level: the customers (AR) or vendors (AP) with a balance in one
 * column, largest first, as of today. AR comes from the same cached aggregate as the hover card.
 *
 *   GET /api/receivables-payables/bucket?side=ar&bucket=3&company=101
 */
export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const { companies, salespeople } = parseFilters(params, todayIso());
  const side = parseSide(params.get("side"));
  const bucket = parseBucket(params.get("bucket"));
  if (side === null || bucket === null) {
    return Response.json({ ok: false, message: "Pick an aging column." }, { status: 400 });
  }
  const asOf = todayIso();
  const result = await load(() =>
    side === "ap"
      ? apBucketVendors(asOf, companies, bucket)
      : arBucketCustomers(asOf, { companies, salespeople }, bucket),
  );
  return Response.json(result, { status: result.ok ? 200 : 502 });
}
