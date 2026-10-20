import { connection } from "next/server";

import { dataSource } from "@/lib/server/config";

/** How long the Orion ping may take before the app reports itself unhealthy. */
const PING_TIMEOUT_MS = 5_000;

/**
 * Liveness for the service monitor and the reverse proxy, open without sign-in:
 *
 *   GET /api/health -> 200 { status: "ok", version, commit, dataSource, orion: "up" | "not used" }
 *                   -> 503 { status: "unavailable", ..., orion: "down" }
 *
 * Never includes hostnames, users or error details; those go to the server log.
 */
export async function GET() {
  await connection();
  let source: string;
  let orion: "up" | "down" | "not used";
  try {
    source = dataSource();
    orion =
      source === "oracle"
        ? (await (await import("@/lib/server/oracle")).pingOracle(PING_TIMEOUT_MS))
          ? "up"
          : "down"
        : "not used";
  } catch {
    source = "invalid";
    orion = "down";
  }
  const healthy = orion !== "down";
  return Response.json(
    {
      status: healthy ? "ok" : "unavailable",
      version: process.env.MBAL_VERSION ?? "unknown",
      commit: process.env.MBAL_COMMIT ?? "unknown",
      dataSource: source,
      orion,
    },
    { status: healthy ? 200 : 503, headers: { "Cache-Control": "no-store" } },
  );
}
