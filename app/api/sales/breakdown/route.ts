import { parseFilters, todayIso } from "@/lib/filters";
import { clipToBucket } from "@/lib/periods";
import { load } from "@/lib/server/errors";
import {
  COMPANY_CARD_DIMENSIONS,
  CUSTOMER_CARD_DIMENSIONS,
  MONTH_CARD_DIMENSIONS,
  salesHoverBreakdown,
  type SalesSlice,
} from "@/lib/server/queries/sales";

const PERIOD_RE = /^\d{4}(-(0[1-9]|1[0-2]))?$/;
const MAX_LABEL_LENGTH = 200;
const CUSTOMER_RE = /^[\w.-]{1,30}$/;

/**
 * The Sales hover card: what makes up one bar, for the shared filters.
 *
 *   GET /api/sales/breakdown?period=2026-10&range=ytd&company=101     a month (or `YYYY`) bar
 *   GET /api/sales/breakdown?by=company&label=Alpha%20Trading&…       a "Revenue by company" bar
 *   GET /api/sales/breakdown?period=2026-10&customer=C0001&…          a month bar of a customer page
 *
 * A month bar is the filters narrowed to that month's days. Answers `{ ok: true, data }` or
 * `{ ok: false, message }`, like the journal-lines route. Every query goes through `runQuery`
 * (read-only guard, binds, cache).
 */
export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const filters = parseFilters(params, todayIso());
  const period = params.get("period");
  const by = params.get("by");
  const label = params.get("label");
  const customer = params.get("customer");

  if (period !== null) {
    const clipped = PERIOD_RE.test(period) ? clipToBucket(filters, period) : null;
    if (!clipped) return badRequest("Pick a month in the selected period.");
    if (customer !== null && !CUSTOMER_RE.test(customer)) return badRequest("Pick a customer.");
    const result = await load(() =>
      customer === null
        ? salesHoverBreakdown(clipped, MONTH_CARD_DIMENSIONS)
        : salesHoverBreakdown(clipped, CUSTOMER_CARD_DIMENSIONS, undefined, customer),
    );
    return Response.json(result, { status: result.ok ? 200 : 502 });
  }
  if (by === "company" && label !== null && label.length > 0 && label.length <= MAX_LABEL_LENGTH) {
    const slice: SalesSlice = { dimension: "company", label };
    const result = await load(() => salesHoverBreakdown(filters, COMPANY_CARD_DIMENSIONS, slice));
    return Response.json(result, { status: result.ok ? 200 : 502 });
  }
  return badRequest("Pick a month or a company to see its breakdown.");
}

function badRequest(message: string) {
  return Response.json({ ok: false, message }, { status: 400 });
}
