import path from "node:path";

import type { Filters } from "@/lib/filters";
import { setRunnerForTests } from "@/lib/server/db";
import { SampleSource } from "@/lib/server/sample";

export const FIXTURE_DIR = path.join(import.meta.dirname, "..", "fixtures");

/** Q1 2025 in tests/fixtures/ZF_CSL_BI.csv. Hand-computed expected values are in sales.test.ts. */
export const Q1_2025: Filters = {
  range: "custom",
  start: "2025-01-01",
  end: "2025-03-31",
  companies: [],
  salespeople: [],
  brands: [],
};

/** Route runQuery to the small hand-checked fixture, with its dates left as they are. */
export function useFixtureSource(): SampleSource {
  const source = new SampleSource({ fixtureDir: FIXTURE_DIR, rebaseToYear: null });
  setRunnerForTests((sql, binds) => source.query(sql, binds));
  return source;
}
