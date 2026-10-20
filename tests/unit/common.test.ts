import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { setRunnerForTests } from "@/lib/server/db";
import { companies, companiesQuery } from "@/lib/server/queries/common";

import { useFixtureSource } from "./fixture";

beforeAll(() => {
  useFixtureSource();
});
afterAll(() => setRunnerForTests(undefined));

describe("companies", () => {
  // Live Orion: the distinct companies of ZF_CSL_BI took 7 s (a scan of 3.7M sales lines) on every
  // page naming companies, and missed companies with postings, stock or POs but no sales.
  it("come from the company master, not a scan of the sales view", () => {
    const { sql, binds } = companiesQuery();
    expect(sql).toContain("FROM MBALI.FM_COMPANY");
    expect(sql).not.toContain("ZF_CSL_BI");
    expect(binds).toEqual({});
  });

  it("lists every company by code with its name", async () => {
    expect(await companies()).toEqual([
      { code: "101", name: "Alpha Trading" },
      { code: "102", name: "Beta Supplies" },
    ]);
  });
});
