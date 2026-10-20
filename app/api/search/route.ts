import { load } from "@/lib/server/errors";
import { SEARCH_MIN_LENGTH, searchCustomers, searchText } from "@/lib/server/queries/customers";
import { searchItems } from "@/lib/server/queries/items";

/**
 * The top-bar search: customers and items whose name (description) or code contains `q`, best
 * matches first, at most 20 of each.
 *
 *   GET /api/search?q=noor
 *
 * Answers `{ ok: true, data: [{ kind, code, name, detail }] }`, customers (`kind: "customer"`)
 * before items (`kind: "item"`), or `{ ok: false, message }` with a friendly message (400 when `q`
 * is under 2 characters, 502 when Orion fails). `q` is only ever a bind variable.
 */
export async function GET(request: Request) {
  const text = searchText(new URL(request.url).searchParams.get("q"));
  if (text === null) {
    return Response.json(
      { ok: false, message: `Type at least ${SEARCH_MIN_LENGTH} characters to search.` },
      { status: 400 },
    );
  }
  const result = await load(async () => {
    const [customers, items] = await Promise.all([searchCustomers(text), searchItems(text)]);
    return [...customers, ...items];
  });
  return Response.json(result, { status: result.ok ? 200 : 502 });
}
