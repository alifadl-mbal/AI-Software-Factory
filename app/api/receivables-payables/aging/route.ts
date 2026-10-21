import { parseBucket, parseSide } from "@/lib/aging-drill";
import { parseFilters, todayIso } from "@/lib/filters";
import { load } from "@/lib/server/errors";
import { apAgingHover, arAgingHover } from "@/lib/server/queries/ar-ap";

const CUSTOMER_RE = /^[\w.-]{1,30}$/;

/**
 * The aging hover card: one column of the AR or AP aging chart, as of today, by company and by the
 * customer's salesperson (AR) or the top vendors (AP).
 *
 *   GET /api/receivables-payables/aging?side=ar&bucket=3&company=101&salesperson=S01
 *   GET /api/receivables-payables/aging?side=ar&bucket=3&customer=C0001      the customer page
 *
 * AR reads the cached aggregate the page starts (one AR query, never one per hover); the customer
 * page's is narrowed to that customer and follows only the companies, as its AR does. AP comes from
 * the page's own AP query.
 */
export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const { companies, salespeople } = parseFilters(params, todayIso());
  const side = parseSide(params.get("side"));
  const bucket = parseBucket(params.get("bucket"));
  const customer = params.get("customer");
  if (side === null || bucket === null || (customer !== null && !CUSTOMER_RE.test(customer))) {
    return Response.json({ ok: false, message: "Pick an aging column." }, { status: 400 });
  }
  const asOf = todayIso();
  const result = await load(() =>
    side === "ap"
      ? apAgingHover(asOf, companies, bucket)
      : customer !== null
        ? arAgingHover(asOf, companies, bucket, customer)
        : arAgingHover(asOf, { companies, salespeople }, bucket),
  );
  return Response.json(result, { status: result.ok ? 200 : 502 });
}
