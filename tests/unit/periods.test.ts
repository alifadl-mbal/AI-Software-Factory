import { describe, expect, it } from "vitest";

import {
  bucketTick,
  bucketTitle,
  clipToBucket,
  granularityFor,
  MAX_MONTHLY_BARS,
  partialLabel,
  periodBuckets,
  rollUp,
  yoyChange,
} from "@/lib/periods";

describe("periodBuckets", () => {
  it("year to date: full months, then the running month is partial", () => {
    const buckets = periodBuckets("2026-01-01", "2026-10-21");
    expect(buckets.map((bucket) => bucket.key)).toEqual([
      "2026-01",
      "2026-02",
      "2026-03",
      "2026-04",
      "2026-05",
      "2026-06",
      "2026-07",
      "2026-08",
      "2026-09",
      "2026-10",
    ]);
    expect(buckets.filter((bucket) => bucket.partial).map((bucket) => bucket.key)).toEqual(["2026-10"]);
    expect(buckets.at(-1)).toMatchObject({ from: "2026-10-01", to: "2026-10-21" });
  });

  it("a month ending on its last day is full, also in February of a leap year", () => {
    expect(periodBuckets("2026-01-01", "2026-09-30").some((bucket) => bucket.partial)).toBe(false);
    expect(periodBuckets("2028-02-01", "2028-02-29")[0].partial).toBe(false);
    expect(periodBuckets("2028-02-01", "2028-02-28")[0].partial).toBe(true);
  });

  it("a range that starts mid-month makes its first month partial", () => {
    const [first] = periodBuckets("2025-10-22", "2026-10-21");
    expect(first).toMatchObject({ key: "2025-10", from: "2025-10-22", to: "2025-10-31", partial: true });
  });

  it("switches to years beyond 24 months, marking partial years", () => {
    expect(granularityFor("2024-01-01", "2025-12-31")).toBe("month");
    expect(MAX_MONTHLY_BARS).toBe(24);
    expect(granularityFor("2024-01-01", "2026-01-01")).toBe("year");
    const buckets = periodBuckets("2023-01-01", "2026-10-21");
    expect(buckets.map((bucket) => [bucket.key, bucket.partial])).toEqual([
      ["2023", false],
      ["2024", false],
      ["2025", false],
      ["2026", true],
    ]);
    expect(buckets.at(-1)).toMatchObject({ from: "2026-01-01", to: "2026-10-21", granularity: "year" });
  });
});

describe("labels", () => {
  const [october] = periodBuckets("2026-10-01", "2026-10-21");
  const [september] = periodBuckets("2026-09-01", "2026-09-30");
  const years = periodBuckets("2023-03-05", "2026-10-21");

  it("partial months show their days", () => {
    expect(partialLabel(october)).toBe("1–21 Oct");
    expect(bucketTick(october)).toBe("1–21 Oct");
    expect(bucketTitle(october)).toBe("Oct 2026 (1–21 Oct)");
  });

  it("full months show the month", () => {
    expect(partialLabel(september)).toBeNull();
    expect(bucketTick(september)).toBe("Sep 26");
    expect(bucketTitle(september)).toBe("Sep 2026");
  });

  it("years", () => {
    expect(years.map(bucketTick)).toEqual(["2023 from 5 Mar", "2024", "2025", "2026 to 21 Oct"]);
    expect(bucketTitle(years[3])).toBe("2026 (1 Jan–21 Oct)");
  });
});

describe("clipToBucket", () => {
  const ytd = { start: "2026-01-01", end: "2026-10-21", companies: ["101"] };

  it("narrows the range to a month's days, keeping the other filters", () => {
    expect(clipToBucket(ytd, "2026-10")).toEqual({
      start: "2026-10-01",
      end: "2026-10-21",
      companies: ["101"],
    });
    expect(clipToBucket(ytd, "2026-02")).toMatchObject({ start: "2026-02-01", end: "2026-02-28" });
  });

  it("narrows to a year", () => {
    expect(clipToBucket(ytd, "2026")).toMatchObject({ start: "2026-01-01", end: "2026-10-21" });
  });

  it("is null outside the range", () => {
    expect(clipToBucket(ytd, "2026-11")).toBeNull();
    expect(clipToBucket(ytd, "2025")).toBeNull();
  });
});

describe("yoyChange", () => {
  it("is the change as a fraction of last year", () => {
    expect(yoyChange(120, 100)).toBeCloseTo(0.2);
    expect(yoyChange(80, 100)).toBeCloseTo(-0.2);
  });

  it("is null (shown as —) when last year is zero", () => {
    expect(yoyChange(100, 0)).toBeNull();
    expect(yoyChange(0, 0)).toBeNull();
  });

  it("a bigger loss is a fall", () => {
    expect(yoyChange(-120, -100)).toBeCloseTo(-0.2);
  });
});

describe("rollUp", () => {
  const months = [
    { month: "2025-11", thisYear: 1, lastYear: 10 },
    { month: "2025-12", thisYear: 2, lastYear: 20 },
    { month: "2026-01", thisYear: 4, lastYear: 40 },
  ];

  it("keeps months as they are within 24 months, zero-filling gaps", () => {
    const points = rollUp(months, ["thisYear", "lastYear"], "2025-10-15", "2026-01-31");
    expect(points.map((point) => [point.month, point.thisYear, point.lastYear])).toEqual([
      ["2025-10", 0, 0],
      ["2025-11", 1, 10],
      ["2025-12", 2, 20],
      ["2026-01", 4, 40],
    ]);
    expect(points[0].bucket.partial).toBe(true);
  });

  it("sums months into years beyond 24 months", () => {
    const points = rollUp(months, ["thisYear", "lastYear"], "2024-01-01", "2026-01-31");
    expect(points.map((point) => [point.month, point.thisYear, point.lastYear])).toEqual([
      ["2024", 0, 0],
      ["2025", 3, 30],
      ["2026", 4, 40],
    ]);
    expect(points.map((point) => point.bucket.partial)).toEqual([false, false, true]);
  });
});
