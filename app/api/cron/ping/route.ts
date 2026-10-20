import { connection } from "next/server";

import { cronAuthorized } from "@/lib/server/access";

/**
 * A no-op for schedulers to check their token: `Authorization: Bearer $CRON_SECRET`.
 *
 * `proxy.ts` already rejects a missing or wrong token for everything under `/api/cron/`; every
 * cron route checks it again, so moving or renaming the proxy can't open one up.
 */
export async function GET(request: Request) {
  await connection();
  if (!cronAuthorized(request.headers.get("authorization"))) {
    return Response.json({ ok: false, message: "Missing or wrong bearer token." }, { status: 401 });
  }
  return Response.json({ ok: true, time: new Date().toISOString() });
}
