import { describe, expect, it } from "vitest";

import {
  formatAed,
  formatAedCompact,
  formatDeltaPct,
  formatDeltaPp,
  formatInt,
  formatMonth,
  formatNumber,
  formatPct,
  MISSING,
  pctChange,
} from "@/lib/format";

describe("AED formatting", () => {
  it("full: thousands separators and clear negatives", () => {
    expect(formatAed(1234567.4)).toBe("AED 1,234,567");
    expect(formatAed(-1234.5, 1)).toBe("-AED 1,234.5");
    expect(formatAed(0)).toBe("AED 0");
    expect(formatAed(-0.2)).toBe("AED 0");
    expect(formatAed(null)).toBe(MISSING);
    expect(formatAed(Number.NaN)).toBe(MISSING);
    expect(formatNumber(-46432905.3)).toBe("-46,432,905");
  });

  it("compact for cards", () => {
    expect(formatAedCompact(1_234_567)).toBe("AED 1.2M");
    expect(formatAedCompact(-845_120)).toBe("-AED 845.1K");
    expect(formatAedCompact(999_960)).toBe("AED 1M");
    expect(formatAedCompact(2_500_000_000)).toBe("AED 2.5B");
    expect(formatAedCompact(950)).toBe("AED 950");
    expect(formatAedCompact(0)).toBe("AED 0");
    expect(formatAedCompact(-0.2)).toBe("AED 0");
    expect(formatAedCompact(undefined)).toBe(MISSING);
  });
});

describe("percentages and counts", () => {
  it("formats", () => {
    expect(formatPct(0.34634)).toBe("34.6%");
    expect(formatPct(-0.05)).toBe("-5.0%");
    expect(formatInt(12345)).toBe("12,345");
    expect(formatDeltaPp(0.35 - 0.3)).toBe("+5.0 pp");
    expect(formatDeltaPct(-0.1)).toBe("-10.0%");
    expect(formatDeltaPct(0)).toBe("0.0%");
  });

  it("pctChange is sign-aware", () => {
    expect(pctChange(110, 100)).toBeCloseTo(0.1);
    expect(pctChange(-120, -100)).toBeCloseTo(-0.2); // more returns shows as a fall
    expect(pctChange(5, 0)).toBeNull();
  });

  it("months", () => {
    expect(formatMonth("2026-03")).toBe("Mar 2026");
    expect(formatMonth("2026-03", true)).toBe("Mar 26");
  });
});
