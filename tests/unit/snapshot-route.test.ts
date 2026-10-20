/**
 * POST /api/cron/snapshot, called directly: auth, the file transport, a failing section and how
 * errors are logged. The e2e test covers the same endpoint over HTTP.
 */
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { GET, POST } from "@/app/api/cron/snapshot/route";
import { todayIso } from "@/lib/filters";
import { setRunnerForTests } from "@/lib/server/db";
import { SampleSource } from "@/lib/server/sample";

const SECRET = "test-cron-secret";
const TODAY = todayIso();
const sample = new SampleSource({
  rebaseToYear: Number(TODAY.slice(0, 4)),
  rebaseToMonth: TODAY.slice(0, 7),
  anchorToDate: TODAY,
});

let dir: string;

beforeAll(async () => {
  dir = await mkdtemp(path.join(os.tmpdir(), "snapshot-route-"));
});
afterAll(async () => {
  setRunnerForTests(undefined);
  await rm(dir, { recursive: true, force: true });
});

beforeEach(() => {
  vi.stubEnv("CRON_SECRET", SECRET);
  vi.stubEnv("SNAPSHOT_TRANSPORT", "file");
  vi.stubEnv("SNAPSHOT_DIR", dir);
  vi.stubEnv("SNAPSHOT_TO", "manager@mbal.example");
  vi.stubEnv("APP_URL", "https://bi.example.test/");
  setRunnerForTests((sql, binds) => sample.query(sql, binds));
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

function post(authorization?: string): Promise<Response> {
  return POST(
    new Request("http://localhost:3000/api/cron/snapshot", {
      method: "POST",
      headers: authorization ? { Authorization: authorization } : {},
    }),
  );
}

describe("POST /api/cron/snapshot", () => {
  it("refuses a missing or wrong token with 401", async () => {
    for (const header of [undefined, "Bearer wrong", `Basic ${SECRET}`, SECRET]) {
      const response = await post(header);
      expect(response.status, String(header)).toBe(401);
      expect(response.headers.get("WWW-Authenticate")).toBe("Bearer");
    }
  });

  it("is switched off (503) while CRON_SECRET is unset", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.stubEnv("CRON_SECRET", "");
    expect((await post("Bearer ")).status).toBe(503);
  });

  it("writes today's email with the right token, linking to APP_URL", async () => {
    vi.spyOn(console, "info").mockImplementation(() => {});
    const response = await post(`Bearer ${SECRET}`);
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toMatchObject({ ok: true, date: TODAY, transport: "file", recipients: 1, unavailable: [] });
    const html = await readFile(path.join(dir, `snapshot-${TODAY}.html`), "utf8");
    const text = await readFile(path.join(dir, `snapshot-${TODAY}.txt`), "utf8");
    expect(body.files).toEqual([
      path.join(dir, `snapshot-${TODAY}.html`),
      path.join(dir, `snapshot-${TODAY}.txt`),
    ]);
    expect(html).toContain('href="https://bi.example.test/sales"');
    expect(text).toMatch(/Net revenue, year to date: AED [1-9]/);
  });

  it("still sends when one loader fails, and logs the reason", async () => {
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(console, "info").mockImplementation(() => {});
    setRunnerForTests((sql, binds) =>
      sql.includes("ZF_SOA_DETL_CUST_INV_SM_BI")
        ? Promise.reject(new Error("ORA-12541: TNS:no listener"))
        : sample.query(sql, binds),
    );
    const response = await post(`Bearer ${SECRET}`);
    expect(response.status).toBe(200);
    expect((await response.json()).unavailable).toEqual(["receivables", "arOver90"]);
    const text = await readFile(path.join(dir, `snapshot-${TODAY}.txt`), "utf8");
    expect(text).toMatch(/Receivables — \S+\n {2}Not available today\./);
    expect(text).toMatch(/Stock value: AED [1-9]/);
    expect(errors.mock.calls.flat().join("\n")).toContain("snapshot: receivables is not available");
  });

  it("answers 502 when Graph fails, and logs it without secrets", async () => {
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.stubEnv("SNAPSHOT_TRANSPORT", "graph");
    vi.stubEnv("SNAPSHOT_TENANT_ID", "tenant");
    vi.stubEnv("SNAPSHOT_CLIENT_ID", "client");
    vi.stubEnv("SNAPSHOT_CLIENT_SECRET", "very-secret-value");
    vi.stubEnv("SNAPSHOT_FROM", "bi@mbal.example");
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ error: "unauthorized_client", error_description: "very-secret-value" }), {
        status: 400,
      }),
    );
    const response = await post(`Bearer ${SECRET}`);
    expect(response.status).toBe(502);
    const body = await response.json();
    expect(body.message).toContain("Getting a Microsoft Graph token failed: HTTP 400 unauthorized_client");
    const logged = errors.mock.calls.flat().join("\n");
    expect(logged).toContain("unauthorized_client");
    expect(logged).not.toContain("very-secret-value");
    expect(logged).not.toContain(SECRET);
  });

  it("answers 405 to GET", () => {
    const response = GET();
    expect(response.status).toBe(405);
    expect(response.headers.get("Allow")).toBe("POST");
  });
});
