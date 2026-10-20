import { NextResponse, type NextFetchEvent, type NextRequest } from "next/server";
import type { Session } from "next-auth";

import { auth } from "@/auth";
import {
  accessMode,
  cronAuthorized,
  isCronPath,
  isPublicPath,
  NO_ACCESS_PATH,
  NOT_CONFIGURED_PATH,
  SIGN_IN_PATH,
} from "@/lib/server/access";

/**
 * The gate in front of every page and API route (Next 16's middleware).
 *
 * - `/api/cron/*` needs `Authorization: Bearer $CRON_SECRET`, signed in or not.
 * - `/api/health`, `/api/auth/*` and the sign-in pages are always open.
 * - With sign-in on, everything else needs a session (pages redirect to sign-in, APIs get 401)
 *   and, if `AUTH_ALLOWED_GROUP` is set, membership of that group (no-access page, or 403).
 * - Locked (oracle in production without sign-in): pages show "sign-in not configured", APIs 503.
 *
 * The data layer refuses to query when locked too, so this is not the only line of defence.
 */

function isApi(pathname: string): boolean {
  return pathname === "/api" || pathname.startsWith("/api/");
}

function deny(request: NextRequest, status: 401 | 403 | 503, message: string, page: string) {
  if (isApi(request.nextUrl.pathname)) {
    return NextResponse.json({ ok: false, message }, { status });
  }
  if (page === SIGN_IN_PATH) {
    const url = new URL(SIGN_IN_PATH, request.nextUrl);
    const target = request.nextUrl.pathname + request.nextUrl.search;
    if (target !== "/") url.searchParams.set("callbackUrl", target);
    return NextResponse.redirect(url);
  }
  return NextResponse.redirect(new URL(page, request.nextUrl));
}

function gate(request: NextRequest, session: Session | null): NextResponse {
  const { pathname } = request.nextUrl;
  if (session?.user) {
    if (session.allowed || pathname === NO_ACCESS_PATH) return NextResponse.next();
    return deny(request, 403, "You don't have access to MBAL BI.", NO_ACCESS_PATH);
  }
  return deny(request, 401, "Sign in to use MBAL BI.", SIGN_IN_PATH);
}

export async function proxy(request: NextRequest, event: NextFetchEvent) {
  const { pathname } = request.nextUrl;

  if (isCronPath(pathname)) {
    if (cronAuthorized(request.headers.get("authorization"))) return NextResponse.next();
    return NextResponse.json({ ok: false, message: "Missing or wrong bearer token." }, { status: 401 });
  }

  const mode = accessMode();
  if (mode === "locked") {
    if (pathname === NOT_CONFIGURED_PATH || pathname === "/api/health") return NextResponse.next();
    return deny(request, 503, "Sign-in is not configured, so MBAL BI serves no data.", NOT_CONFIGURED_PATH);
  }
  if (mode !== "auth" || isPublicPath(pathname)) return NextResponse.next();
  // With a lazy config, `auth(handler)` resolves to the wrapped handler rather than returning it.
  const withSession = await auth((authed) => gate(authed, authed.auth));
  const response = await withSession(request, event as never);
  // Always a Response in practice; fail closed if that ever changes.
  if (!response) return deny(request, 401, "Sign in to use MBAL BI.", SIGN_IN_PATH);
  // Auth.js re-issues the session cookie on every check. Sessions end a working day after sign-in
  // anyway, and a late reply (a prefetch, say) re-issuing it would undo a sign-out: drop it.
  response.headers.delete("set-cookie");
  return response;
}

export const config = {
  // Everything except build output and static files (anything with an extension at the root).
  matcher: [
    "/((?!_next/static|_next/image|favicon\\.ico|.*\\.(?:png|jpg|jpeg|gif|svg|ico|webp|txt|woff2?)$).*)",
  ],
};
