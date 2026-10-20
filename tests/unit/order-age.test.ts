import { describe, expect, it } from "vitest";

import {
  DEFAULT_ORDER_AGE,
  orderAgeCutoff,
  orderAgeScope,
  orderAgeSearch,
  parseOrderAge,
  withOrderAge,
} from "@/lib/order-age";

describe("parseOrderAge", () => {
  it("defaults to the last 2 years", () => {
    expect(DEFAULT_ORDER_AGE).toBe("2y");
    expect(parseOrderAge({})).toBe("2y");
    expect(parseOrderAge(undefined)).toBe("2y");
    expect(parseOrderAge(new URLSearchParams(""))).toBe("2y");
  });

  it.each([
    ["12m", "12m"],
    ["all", "all"],
    ["2y", "2y"],
    ["ALL", "2y"],
    ["6m", "2y"],
    ["", "2y"],
  ])("since=%s reads as %s", (value, expected) => {
    expect(parseOrderAge({ since: value })).toBe(expected);
    expect(parseOrderAge(new URLSearchParams({ since: value }))).toBe(expected);
    expect(parseOrderAge(value)).toBe(expected);
  });

  it("takes the first of repeated parameters", () => {
    expect(parseOrderAge({ since: ["all", "12m"] })).toBe("all");
  });
});

describe("orderAgeCutoff", () => {
  it.each([
    ["2y", "2026-10-20", "2024-10-20"],
    ["12m", "2026-10-20", "2025-10-20"],
    // The day is clamped to the end of a shorter month.
    ["2y", "2028-02-29", "2026-02-28"],
    ["12m", "2026-03-31", "2025-03-31"],
  ] as const)("%s on %s starts on %s", (age, today, cutoff) => {
    expect(orderAgeCutoff(age, today)).toBe(cutoff);
  });

  it("all has no cut-off", () => {
    expect(orderAgeCutoff("all", "2026-10-20")).toBeNull();
  });
});

describe("URLs and labels", () => {
  it("leaves the default out of the URL", () => {
    expect(orderAgeSearch("2y")).toBe("");
    expect(orderAgeSearch("12m")).toBe("since=12m");
    expect(withOrderAge("", "all")).toBe("?since=all");
    expect(withOrderAge("?company=101", "all")).toBe("?company=101&since=all");
    expect(withOrderAge("?company=101", "2y")).toBe("?company=101");
  });

  it("names the scope", () => {
    expect(orderAgeScope("2y")).toBe("orders from the last 2 years");
    expect(orderAgeScope("12m")).toBe("orders from the last 12 months");
    expect(orderAgeScope("all")).toBe("orders of any age");
  });
});
