import { describe, expect, it } from "vitest";
import { CHART_COLORS_DARK, CHART_COLORS_LIGHT, MAX_CHART_CATEGORIES, MAX_CHART_SERIES } from "./constants";
import { chartDataFromGrid, chartPalette, dualAxisApplies, formatCompact, hasDrawableData, invalidScatterRows, isRadial, legendVisible, MAX_PIE_SLICES, pieSlices, scatterPoints, stackingApplies } from "./chart";

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

describe("chart types and options", () => {
  const two = [
    { name: "A", values: [1, 2] },
    { name: "B", values: [3, 4] },
  ];
  it("treats pie and doughnut as radial", () => {
    expect(isRadial("pie")).toBe(true);
    expect(isRadial("doughnut")).toBe(true);
    expect(isRadial("bar")).toBe(false);
    expect(isRadial("scatter")).toBe(false);
  });
  it("always shows a legend for doughnuts", () => {
    expect(legendVisible({ chartType: "doughnut", series: [two[0]], showLegend: true })).toBe(true);
  });
  it("stacks only bar charts with two or more series", () => {
    expect(stackingApplies({ chartType: "bar", series: two, stacked: true })).toBe(true);
    expect(stackingApplies({ chartType: "bar", series: [two[0]], stacked: true })).toBe(false);
    expect(stackingApplies({ chartType: "line", series: two, stacked: true })).toBe(false);
    expect(stackingApplies({ chartType: "bar", series: two, stacked: undefined })).toBe(false);
  });
  it("uses a second axis only for bar/line charts with two or more series", () => {
    expect(dualAxisApplies({ chartType: "bar", series: two, dualAxis: true })).toBe(true);
    expect(dualAxisApplies({ chartType: "line", series: two, dualAxis: true })).toBe(true);
    expect(dualAxisApplies({ chartType: "area", series: two, dualAxis: true })).toBe(false);
    expect(dualAxisApplies({ chartType: "line", series: [two[0]], dualAxis: true })).toBe(false);
  });
});

describe("scatter data", () => {
  it("reads X from the labels and skips rows whose X isn't a number", () => {
    const points = scatterPoints({ categories: ["1", "x", "3.5"], series: [{ name: "S", values: [10, 20, 30] }] });
    expect(points).toEqual([
      [
        { x: 1, y: 10 },
        { x: 3.5, y: 30 },
      ],
    ]);
  });
  it("reports invalid X rows (1-based)", () => {
    expect(invalidScatterRows(["1", "a", "", "4"])).toEqual([2, 3]);
  });
  it("has nothing to draw without numeric X values", () => {
    expect(hasDrawableData({ chartType: "scatter", categories: ["a", "b"], series: [{ name: "S", values: [1, 2] }] })).toBe(false);
    expect(hasDrawableData({ chartType: "scatter", categories: ["1", "b"], series: [{ name: "S", values: [1, 2] }] })).toBe(true);
  });
  it("needs a positive slice for doughnuts", () => {
    expect(hasDrawableData({ chartType: "doughnut", categories: ["a"], series: [{ name: "S", values: [0] }] })).toBe(false);
  });
});

describe("chartDataFromGrid", () => {
  it("uses the first row as series names when it holds text", () => {
    expect(
      chartDataFromGrid([
        ["Quarter", "Revenue", "Cost"],
        ["Q1", "$1,200", "800"],
        ["Q2", "1500", "x"],
      ]),
    ).toEqual({
      categories: ["Q1", "Q2"],
      series: [
        { name: "Revenue", values: ["$1,200", "1500"] },
        { name: "Cost", values: ["800", "x"] },
      ],
      truncated: false,
    });
  });
  it("treats an all-numeric first row as data", () => {
    const data = chartDataFromGrid([
      ["1", "2"],
      ["3", "4"],
    ]);
    expect(data?.categories).toEqual(["1", "3"]);
    expect(data?.series).toEqual([{ name: "Series 1", values: ["2", "4"] }]);
  });
  it("names series with blank headers and pads short rows", () => {
    const data = chartDataFromGrid([
      ["", "Sales", ""],
      ["Jan", "5"],
    ]);
    expect(data?.series.map((s) => s.name)).toEqual(["Sales", "Series 2"]);
    expect(data?.series[1].values).toEqual([""]);
  });
  it("returns null without a value column or without data rows", () => {
    expect(chartDataFromGrid([["only"], ["labels"]])).toBeNull();
    expect(chartDataFromGrid([["Label", "Value"]])).toBeNull();
    expect(chartDataFromGrid([])).toBeNull();
    expect(chartDataFromGrid([["", ""]])).toBeNull();
  });
  it("cuts rows and series to the chart limits and says so", () => {
    const wide = [["L", ...Array.from({ length: MAX_CHART_SERIES + 2 }, (_, i) => `S${i}`)], ["a", ...Array.from({ length: MAX_CHART_SERIES + 2 }, () => "1")]];
    const wideData = chartDataFromGrid(wide);
    expect(wideData?.series).toHaveLength(MAX_CHART_SERIES);
    expect(wideData?.truncated).toBe(true);
    const tall = Array.from({ length: MAX_CHART_CATEGORIES + 5 }, (_, i) => [`r${i}`, String(i)]);
    const tallData = chartDataFromGrid(tall);
    expect(tallData?.categories).toHaveLength(MAX_CHART_CATEGORIES);
    expect(tallData?.truncated).toBe(true);
  });
});
