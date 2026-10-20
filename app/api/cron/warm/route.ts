import { cronAuthorized } from "@/lib/server/access";
import { warmCache } from "@/lib/server/warm";

/**
 * The cache warm-up, run every 10 minutes by the scheduled task (`deploy/warm-task.ps1`).
 *
 *   POST /api/cron/warm
 *   Authorization: Bearer <CRON_SECRET>
 *
 * Re-reads the default view of the Overview and of every dashboard into the query cache, so pages
 * open from the cache instead of waiting for Orion. Answers 200 with each section's time, 502 with
 * the same body when a section failed (its friendly message is in the body, details in the log), 401
 * without the right token and 503 when CRON_SECRET is unset. The route checks the token itself,
 * whether or not sign-in covers `/api/cron`.
 */
export async function POST(request: Request) {
  if (!process.env.CRON_SECRET) {
    console.error("[mbal-bi] warm-up: CRON_SECRET is not set, so the endpoint is switched off");
    return Response.json({ ok: false, message: "The warm-up endpoint is not configured." }, { status: 503 });
  }
  if (!cronAuthorized(request.headers.get("authorization"))) {
    return Response.json(
      { ok: false, message: "Unauthorized." },
      { status: 401, headers: { "WWW-Authenticate": "Bearer" } },
    );
  }

  const result = await warmCache();
  const failed = result.sections.filter((section) => !section.ok);
  const summary = `[mbal-bi] warm-up for ${result.today}: ${result.sections.length} sections in ${result.ms} ms`;
  if (failed.length > 0) {
    console.error(
      `${summary}, ${failed.length} failed: ${failed.map((s) => `${s.page} ${s.section}`).join("; ")}`,
    );
  } else {
    console.info(summary);
  }
  return Response.json(result, { status: failed.length > 0 ? 502 : 200 });
}

/** Only POST warms; anything else is 405. */
export function GET() {
  return Response.json({ ok: false, message: "Use POST." }, { status: 405, headers: { Allow: "POST" } });
}
