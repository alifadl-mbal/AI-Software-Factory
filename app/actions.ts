"use server";

import { refresh } from "next/cache";

import { clearCache } from "@/lib/server/db";

/** The Refresh button: drop every cached query result and re-render the page with fresh data. */
export async function refreshData(): Promise<void> {
  clearCache();
  refresh();
}
