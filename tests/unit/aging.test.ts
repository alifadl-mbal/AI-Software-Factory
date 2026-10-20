import { describe, expect, it } from "vitest";

import { AGING_BUCKETS, agingBucketIndex, agingCutoffs, shiftMonths } from "@/lib/aging";

const AS_OF = "2025-06-30";
const bucket = (docDate: string, asOf = AS_OF) => AGING_BUCKETS[agingBucketIndex(docDate, asOf)];

describe("aging ladder", () => {
  it("is in the agreed order", () => {
    expect(AGING_BUCKETS).toEqual(["<30 D", "1-2 M", "2-3 M", "3-6 M", "6-12 M", "1-2 Y", "2+ Y"]);
  });

  it.each([
    ["2025-06-30", "<30 D", "today"],
    ["2025-06-01", "<30 D", "29 days"],
    ["2025-05-31", "1-2 M", "30 days"],
    ["2025-05-01", "1-2 M", "a day short of 2 months"],
    ["2025-04-30", "2-3 M", "2 months"],
    ["2025-03-31", "2-3 M", "a day short of 3 months"],
    ["2025-03-30", "3-6 M", "3 months"],
    ["2024-12-31", "3-6 M", "a day short of 6 months"],
    ["2024-12-30", "6-12 M", "6 months"],
    ["2024-07-01", "6-12 M", "a day short of 12 months"],
    ["2024-06-30", "1-2 Y", "12 months"],
    ["2023-07-01", "1-2 Y", "a day short of 24 months"],
    ["2023-06-30", "2+ Y", "24 months"],
    ["1999-12-08", "2+ Y", "decades"],
    ["2025-07-15", "<30 D", "a future-dated document"],
  ])("%s is %s (%s)", (docDate, expected) => {
    expect(bucket(docDate)).toBe(expected);
  });

  it("counts whole calendar months, clamping the day to shorter months", () => {
    expect(shiftMonths("2025-06-30", -4)).toBe("2025-02-28");
    expect(shiftMonths("2024-03-31", -1)).toBe("2024-02-29");
    expect(shiftMonths("2025-01-31", -2)).toBe("2024-11-30");
    expect(shiftMonths("2025-03-15", -24)).toBe("2023-03-15");
    // 31 March: 2 months back is 31 January, so 1 February is still under 2 months.
    expect(bucket("2025-02-01", "2025-03-31")).toBe("1-2 M");
    expect(bucket("2025-01-31", "2025-03-31")).toBe("2-3 M");
  });

  it("puts the over-90-days cut-off at 90 days", () => {
    expect(agingCutoffs(AS_OF).over90Days).toBe("2025-04-01");
  });
});
