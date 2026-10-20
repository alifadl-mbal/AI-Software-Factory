import "server-only";

import { createHash, timingSafeEqual } from "node:crypto";

import { todayIso } from "@/lib/filters";

import { isSampleMode } from "../config";
import { dataAsOf } from "../db";
import { overviewFigures, type OverviewFigures } from "../overview";
import { buildSnapshotEmail, type SnapshotEmail } from "./email";

export interface Snapshot {
  figures: OverviewFigures;
  email: SnapshotEmail;
}

/**
 * The dashboards' address for the email's links: `APP_URL`, else `fallback` (the address the
 * request came in on). Set `APP_URL` in production: the scheduled task calls the endpoint on
 * localhost, which is no use as a link in someone's inbox.
 */
export function appUrl(fallback: string, env: Record<string, string | undefined> = process.env): string {
  return (env.APP_URL?.trim() || fallback).replace(/\/+$/, "");
}

/** The areas (and Needs-attention items) whose loader failed, with the friendly reason. */
export function unavailableAreas(figures: OverviewFigures): { area: string; message: string }[] {
  return Object.entries({ ...figures, ...figures.attention }).flatMap(([area, loaded]) =>
    typeof loaded === "object" && loaded !== null && "ok" in loaded && !loaded.ok
      ? [{ area, message: loaded.message }]
      : [],
  );
}

/** Today's snapshot email, from the same loaders as the Overview. */
export async function todaysSnapshot(baseUrl: string, today: string = todayIso()): Promise<Snapshot> {
  const figures = await overviewFigures(today);
  for (const { area, message } of unavailableAreas(figures)) {
    console.error(`[mbal-bi] snapshot: ${area} is not available: ${message}`);
  }
  const email = buildSnapshotEmail(figures, { appUrl: baseUrl, sample: isSampleMode(), readAt: dataAsOf() });
  return { figures, email };
}

/**
 * Check `Authorization: Bearer <CRON_SECRET>` in constant time. Both sides are hashed first, so
 * neither the comparison nor an early length check reveals anything about the secret.
 */
export function hasCronToken(authorization: string | null, secret: string | undefined): boolean {
  if (!secret) return false;
  const match = /^Bearer\s+(.+)$/i.exec(authorization?.trim() ?? "");
  const given = createHash("sha256")
    .update(match?.[1] ?? "")
    .digest();
  const expected = createHash("sha256").update(secret).digest();
  return timingSafeEqual(given, expected) && match !== null;
}
