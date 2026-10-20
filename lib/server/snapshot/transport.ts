import "server-only";

import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { ConfigError } from "../config";
import type { SnapshotEmail } from "./email";

/**
 * Where the daily snapshot goes, chosen with `SNAPSHOT_TRANSPORT`:
 *
 * - `file` (default): writes `snapshot-<date>.html` and `.txt` to `SNAPSHOT_DIR` (`./snapshots`).
 * - `graph`: Microsoft Graph `sendMail` as the shared mailbox `SNAPSHOT_FROM`, with an app-only token
 *   (client credentials: `SNAPSHOT_TENANT_ID`, `SNAPSHOT_CLIENT_ID`, `SNAPSHOT_CLIENT_SECRET`) and the
 *   Mail.Send application permission, limited to that mailbox by an Exchange application access
 *   policy (see the README). The message goes as MIME, so it carries both the HTML and the
 *   plain-text alternative. Plain `fetch`, no SDK.
 *
 * `SNAPSHOT_TO` is a comma-separated list of recipients.
 */

export type TransportKind = "file" | "graph";

export const DEFAULT_SNAPSHOT_DIR = "snapshots";
export const GRAPH_URL = "https://graph.microsoft.com/v1.0";
export const LOGIN_URL = "https://login.microsoftonline.com";

const EMAIL_RE = /^[^\s@,;<>"]+@[^\s@,;<>"]+\.[^\s@,;<>"]+$/;

export interface SendResult {
  transport: TransportKind;
  recipients: number;
  /** Files written by the file transport. */
  files?: string[];
}

type Env = Record<string, string | undefined>;

export function transportKind(env: Env = process.env): TransportKind {
  const value = (env.SNAPSHOT_TRANSPORT || "file").trim().toLowerCase();
  if (value !== "file" && value !== "graph") {
    throw new ConfigError(`SNAPSHOT_TRANSPORT must be 'file' or 'graph', not '${value}'.`);
  }
  return value;
}

/** `SNAPSHOT_TO` as a list of addresses; every one must look like an email address. */
export function recipients(env: Env = process.env): string[] {
  const list = (env.SNAPSHOT_TO ?? "")
    .split(",")
    .map((address) => address.trim())
    .filter(Boolean);
  const bad = list.filter((address) => !EMAIL_RE.test(address));
  if (bad.length > 0) {
    throw new ConfigError(`SNAPSHOT_TO has an address that isn't valid: ${bad.join(", ")}.`);
  }
  return list;
}

/** Send (or write) the email with the configured transport. */
export async function sendSnapshot(
  email: SnapshotEmail,
  date: string,
  env: Env = process.env,
  fetcher: typeof fetch = fetch,
): Promise<SendResult> {
  const kind = transportKind(env);
  const to = recipients(env);
  if (kind === "file") {
    const files = await writeSnapshotFiles(email, date, env.SNAPSHOT_DIR || DEFAULT_SNAPSHOT_DIR);
    return { transport: kind, recipients: to.length, files };
  }
  await sendWithGraph(email, to, graphSettings(env), fetcher);
  return { transport: kind, recipients: to.length };
}

// ---------------------------------------------------------------------------------------------
// File

export async function writeSnapshotFiles(email: SnapshotEmail, date: string, dir: string): Promise<string[]> {
  const folder = path.resolve(dir);
  await mkdir(folder, { recursive: true });
  const base = path.join(folder, `snapshot-${date}`);
  const files = [`${base}.html`, `${base}.txt`];
  await Promise.all([writeFile(files[0], email.html, "utf8"), writeFile(files[1], email.text, "utf8")]);
  return files;
}

// ---------------------------------------------------------------------------------------------
// Microsoft Graph

export interface GraphSettings {
  tenantId: string;
  clientId: string;
  clientSecret: string;
  /** The shared mailbox the email is sent as. */
  from: string;
}

export const GRAPH_ENV_VARS = [
  "SNAPSHOT_TENANT_ID",
  "SNAPSHOT_CLIENT_ID",
  "SNAPSHOT_CLIENT_SECRET",
  "SNAPSHOT_FROM",
] as const;

export function graphSettings(env: Env = process.env): GraphSettings {
  const missing = GRAPH_ENV_VARS.filter((name) => !env[name]?.trim());
  if (missing.length > 0) {
    throw new ConfigError(
      `SNAPSHOT_TRANSPORT=graph needs these environment variables: ${missing.join(", ")}. See .env.example.`,
    );
  }
  const from = env.SNAPSHOT_FROM!.trim();
  if (!EMAIL_RE.test(from)) throw new ConfigError("SNAPSHOT_FROM must be an email address.");
  return {
    tenantId: env.SNAPSHOT_TENANT_ID!.trim(),
    clientId: env.SNAPSHOT_CLIENT_ID!.trim(),
    clientSecret: env.SNAPSHOT_CLIENT_SECRET!,
    from,
  };
}

/** Sending failed. The message names the step and Graph's error code, never a secret or token. */
export class SendError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SendError";
  }
}

/** Graph's error code and message from a failed response, if it sent JSON. */
async function describeFailure(response: Response): Promise<string> {
  let detail = "";
  try {
    const body = (await response.json()) as {
      error?: string | { code?: string; message?: string };
      error_codes?: number[];
    };
    if (typeof body.error === "string") {
      // The token endpoint: `error` plus AADSTS codes; its description may echo the client id, so
      // only the codes are kept.
      detail = `${body.error}${body.error_codes?.length ? ` (AADSTS${body.error_codes.join(", AADSTS")})` : ""}`;
    } else if (body.error) {
      detail = [body.error.code, body.error.message].filter(Boolean).join(": ");
    }
  } catch {
    // Not JSON: the status says enough.
  }
  return `HTTP ${response.status}${detail ? ` ${detail}` : ""}`;
}

export async function graphToken(settings: GraphSettings, fetcher: typeof fetch = fetch): Promise<string> {
  const response = await fetcher(`${LOGIN_URL}/${encodeURIComponent(settings.tenantId)}/oauth2/v2.0/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: settings.clientId,
      client_secret: settings.clientSecret,
      scope: "https://graph.microsoft.com/.default",
      grant_type: "client_credentials",
    }).toString(),
  });
  if (!response.ok) {
    throw new SendError(`Getting a Microsoft Graph token failed: ${await describeFailure(response)}.`);
  }
  const body = (await response.json()) as { access_token?: string };
  if (!body.access_token) throw new SendError("The Microsoft Graph token response had no access token.");
  return body.access_token;
}

function base64(text: string): string {
  return Buffer.from(text, "utf8").toString("base64");
}

/** Base64 wrapped at 76 characters, as MIME requires. */
function base64Lines(text: string): string {
  return base64(text).replace(/.{76}/g, "$&\r\n");
}

/** An RFC 2047 encoded word, so a subject with `·` or other non-ASCII survives. */
function encodedWord(text: string): string {
  return /^[\x20-\x7e]*$/.test(text) ? text : `=?UTF-8?B?${base64(text)}?=`;
}

/** A multipart/alternative MIME message: plain text first, HTML preferred. */
export function mimeMessage(
  email: SnapshotEmail,
  from: string,
  to: string[],
  boundary: string = randomUUID(),
): string {
  const marker = `snapshot-${boundary}`;
  return [
    `From: ${from}`,
    `To: ${to.join(", ")}`,
    `Subject: ${encodedWord(email.subject)}`,
    "MIME-Version: 1.0",
    `Content-Type: multipart/alternative; boundary="${marker}"`,
    "",
    `--${marker}`,
    "Content-Type: text/plain; charset=utf-8",
    "Content-Transfer-Encoding: base64",
    "",
    base64Lines(email.text),
    `--${marker}`,
    "Content-Type: text/html; charset=utf-8",
    "Content-Transfer-Encoding: base64",
    "",
    base64Lines(email.html),
    `--${marker}--`,
    "",
  ].join("\r\n");
}

export async function sendWithGraph(
  email: SnapshotEmail,
  to: string[],
  settings: GraphSettings,
  fetcher: typeof fetch = fetch,
): Promise<void> {
  if (to.length === 0) throw new ConfigError("SNAPSHOT_TO needs at least one recipient.");
  const token = await graphToken(settings, fetcher);
  // sendMail takes a MIME message as base64 text; Graph keeps both alternatives as sent.
  const response = await fetcher(`${GRAPH_URL}/users/${encodeURIComponent(settings.from)}/sendMail`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "text/plain" },
    body: base64(mimeMessage(email, settings.from, to)),
  });
  if (!response.ok) {
    throw new SendError(`Microsoft Graph sendMail failed: ${await describeFailure(response)}.`);
  }
}
