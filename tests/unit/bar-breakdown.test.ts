import { describe, expect, it } from "vitest";

import { valueLabelPlacement } from "@/components/dashboard/bar-breakdown";

describe("bar value labels", () => {
  it("sit just past the right end of a positive bar", () => {
    expect(valueLabelPlacement({ x: 120, width: 200 })).toEqual({ x: 328, textAnchor: "start" });
  });

  it("sit right of the zero line for a negative bar, away from the category label", () => {
    // Zero line at x=300, bar reaching left to x=180, as Recharts reports it either way.
    const negativeWidth = valueLabelPlacement({ x: 300, width: -120 });
    const positiveWidth = valueLabelPlacement({ x: 180, width: 120 });
    expect(negativeWidth).toEqual({ x: 308, textAnchor: "start" });
    expect(positiveWidth).toEqual(negativeWidth);
  });

  it("honours a custom offset", () => {
    expect(valueLabelPlacement({ x: 0, width: 50 }, 4).x).toBe(54);
  });
});
