import { createHash, timingSafeEqual } from "node:crypto";

/**
 * Who may see what: the rules `proxy.ts`, the root layout and the data layer share.
 *
 * Deliberately free of `server-only` and Next imports so the proxy and unit tests can load it.
 * Every function takes the environment as a parameter (default `process.env`) to keep it testable.
 *
 * Sign-in (Microsoft Entra ID) is on once all of `AUTH_ENV_VARS` are set. Without them:
 * - sample mode is open, exactly as before (CI, QA and previews rely on it);
 * - oracle mode under `next dev` is open but shows a warning banner;
 * - oracle mode in production is **locked**: no page and no API serves data, only the
 *   "sign-in not configured" page. Live figures are never served without sign-in.
 */

type Env = Record<string, string | undefined>;

export const AUTH_ENV_VARS = [
  "AUTH_SECRET",
  "AUTH_MICROSOFT_ENTRA_ID_ID",
  "AUTH_MICROSOFT_ENTRA_ID_SECRET",
  "AUTH_MICROSOFT_ENTRA_ID_TENANT_ID",
] as const;

/** `open`: no sign-in (sample). `dev-warning`: no sign-in, live data, dev only. */
export type AccessMode = "auth" | "open" | "dev-warning" | "locked";

/** A session lasts one working day from sign-in, however active it is. */
export const SESSION_MAX_AGE_SECONDS = 10 * 60 * 60;

export const SIGN_IN_PATH = "/sign-in";
export const NO_ACCESS_PATH = "/no-access";
export const NOT_CONFIGURED_PATH = "/not-configured";

export function authEnabled(env: Env = process.env): boolean {
  return AUTH_ENV_VARS.every((name) => !!env[name]?.trim());
}

/** Anything but an explicit `sample` counts as live data, so a typo never opens the app. */
function isSample(env: Env): boolean {
  return (env.MBAL_DATA_SOURCE || "sample").trim().toLowerCase() === "sample";
}

export function accessMode(env: Env = process.env): AccessMode {
  if (authEnabled(env)) return "auth";
  if (isSample(env)) return "open";
  return env.NODE_ENV === "production" ? "locked" : "dev-warning";
}

/** The Entra group allowed in, if one is configured. */
export function allowedGroup(env: Env = process.env): string | undefined {
  return env.AUTH_ALLOWED_GROUP?.trim() || undefined;
}

/**
 * Whether a user with these group ids (the ID token's `groups` claim) may use the app. With no
 * group configured, anyone in the tenant may. Group object ids are GUIDs: compared case-blind.
 */
export function groupAllows(group: string | undefined, groups: unknown): boolean {
  if (!group) return true;
  if (!Array.isArray(groups)) return false;
  const wanted = group.toLowerCase();
  return groups.some((id) => typeof id === "string" && id.toLowerCase() === wanted);
}

/** Paths that never need a session: sign-in itself, its pages and the health probe. */
export function isPublicPath(pathname: string): boolean {
  return (
    pathname === "/api/health" ||
    pathname.startsWith("/api/auth/") ||
    pathname === SIGN_IN_PATH ||
    pathname === NO_ACCESS_PATH ||
    pathname === NOT_CONFIGURED_PATH
  );
}

/** Only paths on this site: never `//host` or a full URL, so sign-in can't bounce users away. */
export function safeCallbackPath(value: unknown): string {
  const text = typeof value === "string" ? value : "";
  return text.startsWith("/") && !text.startsWith("//") && !text.startsWith("/\\") ? text : "/";
}

export function isCronPath(pathname: string): boolean {
  return pathname === "/api/cron" || pathname.startsWith("/api/cron/");
}

/**
 * Whether an `Authorization` header carries `Bearer <CRON_SECRET>`. Constant-time: both sides
 * are hashed first, so neither the content nor the length of the secret leaks through timing.
 * With no `CRON_SECRET` set, every request is rejected.
 */
export function cronAuthorized(authorization: string | null, env: Env = process.env): boolean {
  const secret = env.CRON_SECRET;
  if (!secret || !authorization) return false;
  const match = /^Bearer\s+(.+)$/i.exec(authorization.trim());
  if (!match) return false;
  const digest = (value: string) => createHash("sha256").update(value).digest();
  return timingSafeEqual(digest(match[1]), digest(secret));
}
