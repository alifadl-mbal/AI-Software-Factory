import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { ConfigError } from "@/lib/server/config";
import type { SnapshotEmail } from "@/lib/server/snapshot/email";
import {
  graphSettings,
  mimeMessage,
  recipients,
  SendError,
  sendSnapshot,
  transportKind,
} from "@/lib/server/snapshot/transport";

const EMAIL: SnapshotEmail = {
  subject: "MBAL daily snapshot · 20 Oct 2026",
  html: "<!DOCTYPE html><html><body><table><tr><td>Net revenue: AED 1,234</td></tr></table></body></html>",
  text: "Net revenue: AED 1,234\n",
};

const SECRET = "client-secret-value-xyz";
const TOKEN = "eyJ0eXAi.access-token.value";

const GRAPH_ENV = {
  SNAPSHOT_TRANSPORT: "graph",
  SNAPSHOT_TENANT_ID: "tenant-123",
  SNAPSHOT_CLIENT_ID: "client-456",
  SNAPSHOT_CLIENT_SECRET: SECRET,
  SNAPSHOT_FROM: "bi-reports@mbal.example",
  SNAPSHOT_TO: "manager@mbal.example, cfo@mbal.example",
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

/** A fetch that answers the token request, then `sendMail` with `sendStatus`. */
function graphFetch(sendResponse: () => Response = () => new Response(null, { status: 202 })) {
  return vi.fn<typeof fetch>(async (input) => {
    const url = String(input);
    if (url.includes("login.microsoftonline.com")) return json({ access_token: TOKEN, expires_in: 3599 });
    return sendResponse();
  });
}

afterEach(() => vi.restoreAllMocks());

describe("settings", () => {
  it("defaults to the file transport and rejects anything else", () => {
    expect(transportKind({})).toBe("file");
    expect(transportKind({ SNAPSHOT_TRANSPORT: " Graph " })).toBe("graph");
    expect(() => transportKind({ SNAPSHOT_TRANSPORT: "smtp" })).toThrow(ConfigError);
  });

  it("reads SNAPSHOT_TO as a comma-separated list", () => {
    expect(recipients({ SNAPSHOT_TO: " a@x.ae, b@y.ae ,," })).toEqual(["a@x.ae", "b@y.ae"]);
    expect(recipients({})).toEqual([]);
    expect(() => recipients({ SNAPSHOT_TO: "a@x.ae, not an address" })).toThrow(/not an address/);
  });

  it("names every missing Graph variable, without echoing values", () => {
    expect(() => graphSettings({ SNAPSHOT_CLIENT_SECRET: SECRET })).toThrow(
      "SNAPSHOT_TENANT_ID, SNAPSHOT_CLIENT_ID, SNAPSHOT_FROM",
    );
    try {
      graphSettings({ SNAPSHOT_CLIENT_SECRET: SECRET });
    } catch (error) {
      expect(String(error)).not.toContain(SECRET);
    }
  });
});

describe("file transport", () => {
  let dir: string | undefined;
  afterEach(async () => {
    if (dir) await rm(dir, { recursive: true, force: true });
  });

  it("writes the .html and .txt to SNAPSHOT_DIR", async () => {
    dir = await mkdtemp(path.join(os.tmpdir(), "snapshot-"));
    const folder = path.join(dir, "nested");
    const result = await sendSnapshot(EMAIL, "2026-10-20", { SNAPSHOT_DIR: folder, SNAPSHOT_TO: "a@x.ae" });
    expect(result).toEqual({
      transport: "file",
      recipients: 1,
      files: [path.join(folder, "snapshot-2026-10-20.html"), path.join(folder, "snapshot-2026-10-20.txt")],
    });
    expect(await readFile(result.files![0], "utf8")).toBe(EMAIL.html);
    expect(await readFile(result.files![1], "utf8")).toBe(EMAIL.text);
  });
});

describe("Graph transport", () => {
  it("gets an app-only token, then sends as the shared mailbox with a bearer token", async () => {
    const fetcher = graphFetch();
    const result = await sendSnapshot(EMAIL, "2026-10-20", GRAPH_ENV, fetcher);
    expect(result).toEqual({ transport: "graph", recipients: 2 });
    expect(fetcher).toHaveBeenCalledTimes(2);

    const [tokenUrl, tokenInit] = fetcher.mock.calls[0];
    expect(tokenUrl).toBe("https://login.microsoftonline.com/tenant-123/oauth2/v2.0/token");
    expect(tokenInit?.method).toBe("POST");
    const form = new URLSearchParams(String(tokenInit?.body));
    expect(Object.fromEntries(form)).toEqual({
      client_id: "client-456",
      client_secret: SECRET,
      scope: "https://graph.microsoft.com/.default",
      grant_type: "client_credentials",
    });

    const [sendUrl, sendInit] = fetcher.mock.calls[1];
    expect(sendUrl).toBe("https://graph.microsoft.com/v1.0/users/bi-reports%40mbal.example/sendMail");
    expect(sendInit?.method).toBe("POST");
    const headers = new Headers(sendInit?.headers);
    expect(headers.get("Authorization")).toBe(`Bearer ${TOKEN}`);
    expect(headers.get("Content-Type")).toBe("text/plain");

    // The body is the MIME message, base64: both alternatives, the recipients and the subject.
    const mime = Buffer.from(String(sendInit?.body), "base64").toString("utf8");
    expect(mime).toContain("From: bi-reports@mbal.example");
    expect(mime).toContain("To: manager@mbal.example, cfo@mbal.example");
    expect(mime).toContain(`Subject: =?UTF-8?B?${Buffer.from(EMAIL.subject).toString("base64")}?=`);
    expect(mime).toMatch(/Content-Type: multipart\/alternative; boundary="([^"]+)"/);
    const parts = mime.split(/\r\n--snapshot-[^\r\n]+/);
    const decode = (part: string) =>
      Buffer.from(part.split("\r\n\r\n")[1].replace(/\r\n/g, ""), "base64").toString("utf8");
    const textPart = parts.find((part) => part.includes("Content-Type: text/plain"))!;
    const htmlPart = parts.find((part) => part.includes("Content-Type: text/html"))!;
    expect(decode(textPart)).toBe(EMAIL.text);
    expect(decode(htmlPart)).toBe(EMAIL.html);
    // Nothing secret travels in the message itself.
    expect(mime).not.toContain(SECRET);
    expect(mime).not.toContain(TOKEN);
  });

  it("wraps base64 lines at 76 characters", () => {
    const mime = mimeMessage({ ...EMAIL, html: "x".repeat(1000) }, "a@x.ae", ["b@y.ae"], "fixed");
    for (const line of mime.split("\r\n")) expect(line.length).toBeLessThanOrEqual(998);
    expect(mime).toContain(`${"eHh4".repeat(19)}\r\n`);
  });

  it("needs at least one recipient", async () => {
    const fetcher = graphFetch();
    await expect(
      sendSnapshot(EMAIL, "2026-10-20", { ...GRAPH_ENV, SNAPSHOT_TO: "" }, fetcher),
    ).rejects.toThrow(ConfigError);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("reports a refused token with the AADSTS code, never the secret", async () => {
    const fetcher = vi.fn<typeof fetch>(async () =>
      json(
        {
          error: "invalid_client",
          error_description: `AADSTS7000215: Invalid client secret provided. Client: client-456 ${SECRET}`,
          error_codes: [7000215],
        },
        401,
      ),
    );
    const error = await sendSnapshot(EMAIL, "2026-10-20", GRAPH_ENV, fetcher).catch(
      (caught: unknown) => caught,
    );
    expect(error).toBeInstanceOf(SendError);
    expect(String(error)).toContain("HTTP 401 invalid_client (AADSTS7000215)");
    expect(String(error)).not.toContain(SECRET);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("reports a failed sendMail with Graph's code, never the token", async () => {
    const fetcher = graphFetch(() =>
      json(
        {
          error: { code: "ErrorAccessDenied", message: "Access is denied. Check credentials and try again." },
        },
        403,
      ),
    );
    const error = await sendSnapshot(EMAIL, "2026-10-20", GRAPH_ENV, fetcher).catch(
      (caught: unknown) => caught,
    );
    expect(error).toBeInstanceOf(SendError);
    expect(String(error)).toContain(
      "Microsoft Graph sendMail failed: HTTP 403 ErrorAccessDenied: Access is denied",
    );
    expect(String(error)).not.toContain(TOKEN);
    expect(String(error)).not.toContain(SECRET);
  });
});
