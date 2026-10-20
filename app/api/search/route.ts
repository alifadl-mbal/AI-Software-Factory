import { load } from "@/lib/server/errors";
import { SEARCH_MIN_LENGTH, searchCustomers, searchText } from "@/lib/server/queries/customers";

/**
 * The top-bar search: customers whose name or code contains `q`, best matches first, at most 20.
 *
 *   GET /api/search?q=noor
 *
 * Answers `{ ok: true, data: [{ kind: "customer", code, name, detail }] }`, or
 * `{ ok: false, message }` with a friendly message (400 when `q` is under 2 characters, 502 when
 * Orion fails). `q` is only ever a bind variable. Items join the same results later, with their
 * own `kind`.
 */
export async function GET(request: Request) {
  const text = searchText(new URL(request.url).searchParams.get("q"));
  if (text === null) {
    return Response.json(
      { ok: false, message: `Type at least ${SEARCH_MIN_LENGTH} characters to search.` },
      { status: 400 },
    );
  }
  const result = await load(() => searchCustomers(text));
  return Response.json(result, { status: result.ok ? 200 : 502 });
}
