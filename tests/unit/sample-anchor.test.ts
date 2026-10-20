import { describe, expect, it } from "vitest";

import { SampleSource } from "@/lib/server/sample";

import { FIXTURE_DIR } from "./fixture";

describe("sample balance views are anchored to today", () => {
  const source = new SampleSource({
    fixtureDir: FIXTURE_DIR,
    rebaseToYear: 2030,
    anchorToDate: "2031-03-10",
  });

  it("moves AR and AP dates by whole days so the newest is the anchor", async () => {
    const [ar] = await source.query(
      "SELECT MAX(SDR_DOC_DT) AS newest, MIN(SDR_DOC_DT) AS oldest FROM MBALI.ZF_SOA_DETL_CUST_INV_SM_BI",
    );
    expect(ar.newest).toBe("2031-03-10");
    // The oldest fixture date, 2023-01-01, is 906 days before the newest, 2025-06-25.
    expect(ar.oldest).toBe("2028-09-15");
    const [ap] = await source.query("SELECT MAX(SOAP_DOC_DT) AS newest FROM MBALI.ZF_SOAP_DETL_BI");
    expect(ap.newest).toBe("2031-03-10");
  });

  it("leaves the other views on the yearly rebase", async () => {
    const [sales] = await source.query("SELECT MAX(CSL_DATE) AS newest FROM MBALI.ZF_CSL_BI");
    expect(String(sales.newest).slice(0, 4)).toBe("2030");
  });
});
