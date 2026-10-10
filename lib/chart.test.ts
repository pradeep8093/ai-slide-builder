import { describe, expect, it } from "vitest";
import { CHART_COLORS_DARK, CHART_COLORS_LIGHT } from "./constants";
import { chartPalette, formatCompact, hasDrawableData, legendVisible, MAX_PIE_SLICES, pieSlices } from "./chart";

describe("chart helpers", () => {
  it("picks the palette for the background", () => {
    expect(chartPalette("#ffffff")).toBe(CHART_COLORS_LIGHT);
    expect(chartPalette("#0f172a")).toBe(CHART_COLORS_DARK);
  });

  it("uses the first series for pie slices and zeroes negative values", () => {
    expect(pieSlices({ categories: ["a", "b"], series: [{ name: "s", values: [3, -2] }, { name: "t", values: [9, 9] }] })).toEqual([
      { name: "a", value: 3 },
      { name: "b", value: 0 },
    ]);
  });

  it("folds slices beyond the palette into Other, keeping category order", () => {
    const categories = Array.from({ length: 10 }, (_, i) => `c${i}`);
    const values = [1, 10, 2, 9, 3, 8, 4, 7, 5, 6];
    const slices = pieSlices({ categories, series: [{ name: "s", values }] });
    expect(slices).toHaveLength(MAX_PIE_SLICES);
    expect(slices[slices.length - 1]).toEqual({ name: "Other", value: 1 + 2 + 3 });
    expect(slices.slice(0, -1).map((s) => s.name)).toEqual(["c1", "c3", "c5", "c6", "c7", "c8", "c9"]);
  });

  it("handles duplicate category names when folding", () => {
    const categories = Array.from({ length: 9 }, () => "same");
    const slices = pieSlices({ categories, series: [{ name: "s", values: [1, 2, 3, 4, 5, 6, 7, 8, 9] }] });
    expect(slices).toHaveLength(MAX_PIE_SLICES);
    expect(slices.reduce((sum, s) => sum + s.value, 0)).toBe(45);
  });

  it("knows when there is nothing to draw", () => {
    expect(hasDrawableData({ chartType: "pie", categories: ["a"], series: [{ name: "s", values: [0] }] })).toBe(false);
    expect(hasDrawableData({ chartType: "pie", categories: ["a"], series: [{ name: "s", values: [1] }] })).toBe(true);
    expect(hasDrawableData({ chartType: "bar", categories: ["a"], series: [{ name: "s", values: [0] }] })).toBe(true);
  });

  it("formats compact numbers", () => {
    expect(formatCompact(950)).toBe("950");
    expect(formatCompact(1200)).toBe("1.2K");
    expect(formatCompact(2_500_000)).toBe("2.5M");
    expect(formatCompact(Number.NaN)).toBe("");
  });

  it("shows a legend for pies and multi-series charts only", () => {
    const one = [{ name: "a", values: [1] }];
    const two = [...one, { name: "b", values: [2] }];
    expect(legendVisible({ chartType: "bar", series: one, showLegend: true })).toBe(false);
    expect(legendVisible({ chartType: "bar", series: two, showLegend: true })).toBe(true);
    expect(legendVisible({ chartType: "pie", series: one, showLegend: true })).toBe(true);
    expect(legendVisible({ chartType: "pie", series: one, showLegend: false })).toBe(false);
  });
});
