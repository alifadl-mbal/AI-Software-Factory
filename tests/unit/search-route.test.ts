/** GET /api/search, called directly, against the hand-checked fixtures. */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { GET } from "@/app/api/search/route";
import { setRunnerForTests } from "@/lib/server/db";

import { useFixtureSource } from "./fixture";

beforeAll(() => {
  useFixtureSource();
});
afterAll(() => setRunnerForTests(undefined));

function search(q?: string): Promise<Response> {
  const url = new URL("http://localhost:3000/api/search");
  if (q !== undefined) url.searchParams.set("q", q);
  return GET(new Request(url));
}

describe("GET /api/search", () => {
  it("answers customers with a kind, code and name", async () => {
    const response = await search("customer b");
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      ok: true,
      data: [{ kind: "customer", code: "CB", name: "Customer B", detail: "ABU DHABI" }],
    });
  });

  it("refuses q under 2 characters with 400", async () => {
    for (const q of [undefined, "", "a", "   b  "]) {
      const response = await search(q);
      expect(response.status, String(q)).toBe(400);
      expect(await response.json()).toEqual({ ok: false, message: "Type at least 2 characters to search." });
    }
  });

  it("treats SQL-injection-like input as text", async () => {
    for (const q of ["' OR '1'='1", "'; DELETE FROM MBALI.ZF_CUSTOMER --", "%%", "__"]) {
      const response = await search(q);
      expect(response.status, q).toBe(200);
      expect((await response.json()).data, q).toEqual([]);
    }
  });

  it("answers 502 with a friendly message when Orion fails", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    setRunnerForTests(() => Promise.reject(new Error("ORA-12541: TNS:no listener")));
    const response = await search("customer");
    expect(response.status).toBe(502);
    const body = await response.json();
    expect(body.ok).toBe(false);
    expect(body.message).toContain("Couldn't connect to Orion (ORA-12541)");
    useFixtureSource();
    vi.restoreAllMocks();
  });
});
