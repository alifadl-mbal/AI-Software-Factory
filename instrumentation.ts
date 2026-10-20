/**
 * Runs once when the server starts. In production it warms the query cache in the background, so
 * the first visitor after a restart or an update doesn't wait for Orion: it calls the server's own
 * `POST /api/cron/warm`, the same as the scheduled task, once the server is listening. Startup
 * never waits for it, and a failure only goes to the log; the next scheduled run tries again.
 *
 * `WARM_ON_START_URL` is the endpoint to call (default `http://127.0.0.1:$PORT/api/cron/warm`, for
 * a service listening on localhost behind the reverse proxy); `off` switches this off.
 */

const ATTEMPTS = 5;
const RETRY_MS = 3_000;

export function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs" || process.env.NODE_ENV !== "production") return;
  const setting = process.env.WARM_ON_START_URL?.trim();
  if (setting === "off") return;
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    console.info("[mbal-bi] warm-up on start skipped: CRON_SECRET is not set");
    return;
  }
  const url = setting || `http://127.0.0.1:${process.env.PORT || 3000}/api/cron/warm`;
  // `register` must finish before the server listens, so the first attempt waits a moment.
  setTimeout(() => void warmOnStart(url, secret, 1), RETRY_MS).unref();
}

async function warmOnStart(url: string, secret: string, attempt: number): Promise<void> {
  try {
    const response = await fetch(url, { method: "POST", headers: { Authorization: `Bearer ${secret}` } });
    const body = (await response.json().catch(() => ({}))) as { ms?: number };
    // The route logs the details of every run, failed sections included.
    console.info(`[mbal-bi] warm-up on start: HTTP ${response.status} after ${body.ms ?? "?"} ms`);
  } catch (error) {
    // Not listening yet, most likely.
    if (attempt < ATTEMPTS) {
      setTimeout(() => void warmOnStart(url, secret, attempt + 1), RETRY_MS).unref();
      return;
    }
    console.error(
      `[mbal-bi] warm-up on start failed: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}
