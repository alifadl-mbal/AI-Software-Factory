import { describe, expect, it } from "vitest";

import { presetRange } from "@/lib/filters";
import {
  isFutureMonth,
  monthsLabel,
  periodToPick,
  pickToPeriod,
  yearOptions,
  yearsLabel,
} from "@/lib/period-picker";

const TODAY = "2026-10-21";

describe("pickToPeriod", () => {
  it("runs from the first selected month to the last", () => {
    expect(pickToPeriod({ years: [2025], months: [1, 3] }, TODAY)).toEqual({
      range: "custom",
      start: "2025-01-01",
      end: "2025-03-31",
    });
  });

  it("spans several years from the first year's first month to the last year's last", () => {
    expect(pickToPeriod({ years: [2026, 2025], months: [3, 4, 5] }, TODAY)).toEqual({
      range: "custom",
      start: "2025-03-01",
      end: "2026-05-31",
    });
  });

  it("ends at the last day of the month, leap years included", () => {
    expect(pickToPeriod({ years: [2024], months: [2] }, TODAY)?.end).toBe("2024-02-29");
    expect(pickToPeriod({ years: [2025], months: [2] }, TODAY)?.end).toBe("2025-02-28");
  });

  it("never ends after today, and uses a preset when it matches one", () => {
    expect(pickToPeriod({ years: [2026], months: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12] }, TODAY)).toEqual({
      range: "ytd",
      ...presetRange("ytd", TODAY),
    });
    expect(pickToPeriod({ years: [2026], months: [10] }, TODAY)).toEqual({
      range: "mtd",
      ...presetRange("mtd", TODAY),
    });
    expect(pickToPeriod({ years: [2026], months: [4, 5, 6] }, "2026-05-10")).toEqual({
      range: "qtd",
      ...presetRange("qtd", "2026-05-10"),
    });
    expect(pickToPeriod({ years: [2025, 2026], months: [9, 12] }, TODAY)).toEqual({
      range: "custom",
      start: "2025-09-01",
      end: TODAY,
    });
  });

  it("is null when a group is empty or the period hasn't started", () => {
    expect(pickToPeriod({ years: [], months: [1] }, TODAY)).toBeNull();
    expect(pickToPeriod({ years: [2026], months: [] }, TODAY)).toBeNull();
    expect(pickToPeriod({ years: [2026], months: [11] }, TODAY)).toBeNull();
  });
});

describe("periodToPick", () => {
  it("shows a preset as its year and months, exactly", () => {
    expect(periodToPick({ range: "ytd", ...presetRange("ytd", TODAY) }, TODAY)).toEqual({
      years: [2026],
      months: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10],
      exact: true,
    });
    expect(periodToPick({ range: "mtd", ...presetRange("mtd", TODAY) }, TODAY)).toMatchObject({
      months: [10],
      exact: true,
    });
  });

  it("round-trips a multi-year pick", () => {
    const period = pickToPeriod({ years: [2024, 2025], months: [3, 4] }, TODAY)!;
    expect(periodToPick(period, TODAY)).toEqual({ years: [2024, 2025], months: [3, 4], exact: true });
  });

  it("flags ranges no pick can give back", () => {
    const twelve = periodToPick({ range: "12m", ...presetRange("12m", TODAY) }, TODAY);
    expect(twelve).toEqual({ years: [2025, 2026], months: [10], exact: false });
    expect(periodToPick({ range: "custom", start: "2026-01-05", end: "2026-01-31" }, TODAY).exact).toBe(
      false,
    );
    // End month before start month over two years: all months.
    expect(periodToPick({ range: "custom", start: "2025-11-01", end: "2026-02-28" }, TODAY)).toEqual({
      years: [2025, 2026],
      months: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12],
      exact: false,
    });
  });
});

describe("labels and options", () => {
  it("lists years from 2019 to this year, latest first", () => {
    expect(yearOptions(TODAY)).toEqual([2026, 2025, 2024, 2023, 2022, 2021, 2020, 2019]);
  });

  it("knows which months haven't started", () => {
    expect(isFutureMonth(2026, 10, TODAY)).toBe(false);
    expect(isFutureMonth(2026, 11, TODAY)).toBe(true);
    expect(isFutureMonth(2025, 12, TODAY)).toBe(false);
  });

  it("labels years and months", () => {
    expect(yearsLabel([2026])).toBe("2026");
    expect(yearsLabel([2025, 2026])).toBe("2025, 2026");
    expect(yearsLabel([2022, 2023, 2024])).toBe("2022 – 2024");
    expect(yearsLabel([2020, 2023, 2026])).toBe("3 years");
    expect(yearsLabel([])).toBe("Pick a year");
    expect(monthsLabel([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12])).toBe("All months");
    expect(monthsLabel([10])).toBe("October");
    expect(monthsLabel([1, 2, 3])).toBe("Jan – Mar");
    expect(monthsLabel([1, 3])).toBe("Jan, Mar");
    expect(monthsLabel([1, 3, 5, 7])).toBe("4 months");
    expect(monthsLabel([])).toBe("Pick a month");
  });
});
