import path from "node:path";

/** Settings the e2e sample server runs the snapshot endpoint with (see playwright.config.ts). */
export const SNAPSHOT_SECRET = "e2e-cron-secret";
/** Playwright runs from the repository root. */
export const SNAPSHOT_DIR = path.resolve("test-results", "snapshots");
