import { ConfigError } from "@/lib/server/config";
import { appUrl, hasCronToken, todaysSnapshot, unavailableAreas } from "@/lib/server/snapshot";
import { SendError, sendSnapshot } from "@/lib/server/snapshot/transport";

/**
 * The daily snapshot email, sent by the scheduled task (`deploy/snapshot-task.ps1`).
 *
 *   POST /api/cron/snapshot
 *   Authorization: Bearer <CRON_SECRET>
 *
 * Builds today's email from the Overview's loaders and sends it with `SNAPSHOT_TRANSPORT`. A section
 * whose loader fails says "Not available today"; the email still goes out. Answers 200 with what
 * was sent, 401 without the right token, 503 when the server isn't set up for it, and 502 when
 * sending failed. The route checks the token itself, whether or not sign-in covers `/api/cron`.
 */
export async function POST(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    console.error("[mbal-bi] snapshot: CRON_SECRET is not set, so the endpoint is switched off");
    return Response.json({ ok: false, message: "The snapshot endpoint is not configured." }, { status: 503 });
  }
  if (!hasCronToken(request.headers.get("authorization"), secret)) {
    return Response.json(
      { ok: false, message: "Unauthorized." },
      { status: 401, headers: { "WWW-Authenticate": "Bearer" } },
    );
  }

  const { figures, email } = await todaysSnapshot(appUrl(new URL(request.url).origin));
  const unavailable = unavailableAreas(figures).map(({ area }) => area);
  try {
    const sent = await sendSnapshot(email, figures.today);
    console.info(
      `[mbal-bi] snapshot for ${figures.today} sent by ${sent.transport} to ${sent.recipients} recipient(s)`,
    );
    return Response.json({ ok: true, date: figures.today, subject: email.subject, ...sent, unavailable });
  } catch (error) {
    // SendError and ConfigError messages name the step and the code, never a secret or token.
    const message =
      error instanceof SendError || error instanceof ConfigError
        ? error.message
        : "Sending the snapshot failed.";
    console.error(`[mbal-bi] snapshot: ${message}`);
    return Response.json(
      { ok: false, message, unavailable },
      { status: error instanceof ConfigError ? 503 : 502 },
    );
  }
}

/** Only POST sends; anything else is 405. */
export function GET() {
  return Response.json({ ok: false, message: "Use POST." }, { status: 405, headers: { Allow: "POST" } });
}
