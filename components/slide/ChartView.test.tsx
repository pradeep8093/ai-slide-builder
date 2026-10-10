import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { CHART_COLORS_LIGHT, CHART_KINDS } from "@/lib/constants";
import { createChartElement } from "@/lib/factory";
import type { ChartElement } from "@/lib/schema";
import ChartView, { CHART_TITLE_HEIGHT } from "./ChartView";

const LIGHT_INK = "#52514e";
const DARK_INK = "#c3c2b7";

function draw(element: ChartElement, background = "#ffffff", interactive = false) {
  return render(<ChartView element={element} background={background} interactive={interactive} />).container;
}

const legendLabels = (container: HTMLElement) => Array.from(container.querySelectorAll(".recharts-legend-item-text")).map((n) => n.textContent);
const valueLabels = (container: HTMLElement) => Array.from(container.querySelectorAll(".recharts-label-list text")).map((n) => n.textContent);
const yTicks = (container: HTMLElement, side: "left" | "right") =>
  Array.from(container.querySelectorAll(`.recharts-yAxis-tick-labels text[orientation="${side}"]`)).map((n) => n.textContent);
const yAxisCount = (container: HTMLElement) => container.querySelectorAll(".recharts-yAxis-tick-labels").length;

/** Bar rectangles of one series (by its palette color on a light background), in category order. */
function barsOf(container: HTMLElement, seriesIndex: number) {
  return Array.from(container.querySelectorAll(`.recharts-rectangle[fill="${CHART_COLORS_LIGHT[seriesIndex]}"]`)).map((n) => ({
    x: Number(n.getAttribute("x")),
    y: Number(n.getAttribute("y")),
    height: Number(n.getAttribute("height")),
  }));
}

const twoSeries = [
  { name: "A", values: [1, 2, 3, 4] },
  { name: "B", values: [4, 3, 2, 1] },
];

describe("ChartView", () => {
  it.each(CHART_KINDS)("renders a %s chart as SVG", (kind) => {
    const { container } = render(<ChartView element={createChartElement(kind)} background="#ffffff" />);
    expect(container.querySelector(`[data-chart-type="${kind}"]`)).toBeInTheDocument();
    expect(container.querySelector("svg")).toBeInTheDocument();
  });

  it("does not add charts to the tab order", () => {
    const { container } = render(<ChartView element={createChartElement("line")} background="#ffffff" />);
    expect(container.querySelector('[tabindex]:not([tabindex="-1"])')).toBeNull();
  });

  it.each(["bar", "line", "area", "scatter"] as const)("does not add %s charts to the tab order, with labels and tooltips on", (kind) => {
    const container = draw(createChartElement(kind, { showValues: true }), "#ffffff", true);
    expect(container.querySelector('[tabindex]:not([tabindex="-1"])')).toBeNull();
  });

  it.each(["pie", "doughnut"] as const)("does not add %s charts to the tab order", (kind) => {
    const container = draw(createChartElement(kind));
    expect(container.querySelector('[tabindex]:not([tabindex="-1"])')).toBeNull();
  });

  it("keeps legend entries in series order", () => {
    const chart = createChartElement("bar", { series: [{ name: "Zeta", values: [1, 2, 3, 4] }, { name: "Alpha", values: [1, 2, 3, 4] }] });
    const { container } = render(<ChartView element={chart} background="#ffffff" />);
    const labels = Array.from(container.querySelectorAll(".recharts-legend-item-text")).map((n) => n.textContent);
    expect(labels).toEqual(["Zeta", "Alpha"]);
  });

  it("keeps pie legend entries in category order", () => {
    const chart = createChartElement("pie", { categories: ["Zulu", "Alpha", "Mike"], series: [{ name: "s", values: [1, 2, 3] }] });
    const { container } = render(<ChartView element={chart} background="#ffffff" />);
    const labels = Array.from(container.querySelectorAll(".recharts-legend-item-text")).map((n) => n.textContent);
    expect(labels).toEqual(["Zulu", "Alpha", "Mike"]);
  });

  it.each(["line", "area"] as const)("keeps %s legend entries in series order", (kind) => {
    const chart = createChartElement(kind, { series: [{ name: "Zeta", values: [1, 2, 3, 4] }, { name: "Mike", values: [1, 2, 3, 4] }, { name: "Alpha", values: [1, 2, 3, 4] }] });
    expect(legendLabels(draw(chart))).toEqual(["Zeta", "Mike", "Alpha"]);
  });

  it("keeps doughnut legend entries in category order, with 'Other' last", () => {
    const categories = ["Zulu", "Alpha", "Mike", "Bravo", "Yankee", "Charlie", "Xray", "Delta", "Echo"];
    const chart = createChartElement("doughnut", { categories, series: [{ name: "s", values: [9, 8, 7, 6, 5, 4, 3, 2, 1] }] });
    expect(legendLabels(draw(chart))).toEqual(["Zulu", "Alpha", "Mike", "Bravo", "Yankee", "Charlie", "Xray", "Other"]);
  });

  it("keeps scatter legend entries in series order", () => {
    const chart = createChartElement("scatter", { series: [{ name: "Zeta", values: [1, 2, 3, 4] }, { name: "Alpha", values: [4, 3, 2, 1] }] });
    expect(legendLabels(draw(chart))).toEqual(["Zeta", "Alpha"]);
  });

  it("keeps the legend in series order when the last series moves to a second axis", () => {
    const chart = createChartElement("bar", { dualAxis: true, series: [{ name: "Zeta", values: [1, 2, 3, 4] }, { name: "Alpha", values: [1, 2, 3, 4] }] });
    expect(legendLabels(draw(chart))).toEqual(["Zeta", "Alpha"]);
  });

  it("hides the legend when it is turned off, even for doughnuts", () => {
    const container = draw(createChartElement("doughnut", { showLegend: false }));
    expect(container.querySelector(".recharts-legend-wrapper")).toBeNull();
  });

  it("shows the title above the chart", () => {
    render(<ChartView element={createChartElement("bar", { title: "Revenue" })} background="#ffffff" />);
    const title = screen.getByText("Revenue");
    expect(title).toHaveStyle({ height: `${CHART_TITLE_HEIGHT}px` });
  });

  it("leaves the full height to the chart when the title is blank", () => {
    const container = draw(createChartElement("bar", { title: "   ", height: 400 }));
    expect(container.querySelector(".recharts-wrapper")).toHaveStyle({ height: "400px" });
    const titled = draw(createChartElement("bar", { title: "Sales", height: 400 }));
    expect(titled.querySelector(".recharts-wrapper")).toHaveStyle({ height: `${400 - CHART_TITLE_HEIGHT}px` });
  });

  it("shows a legend with series names for multi-series charts only", () => {
    const multi = createChartElement("line", { series: [{ name: "Plan", values: [1, 2, 3, 4] }, { name: "Actual", values: [2, 3, 4, 5] }] });
    const { unmount } = render(<ChartView element={multi} background="#ffffff" />);
    expect(screen.getByText("Plan")).toBeInTheDocument();
    expect(screen.getByText("Actual")).toBeInTheDocument();
    unmount();
    render(<ChartView element={createChartElement("bar", { series: [{ name: "Solo", values: [1, 2, 3, 4] }] })} background="#ffffff" />);
    expect(screen.queryByText("Solo")).not.toBeInTheDocument();
  });

  it("explains when there is nothing to draw", () => {
    render(<ChartView element={createChartElement("pie", { categories: ["a"], series: [{ name: "s", values: [0] }] })} background="#000000" />);
    expect(screen.getByText("No data to display")).toBeInTheDocument();
  });

  it("shows tooltips only when interactive", () => {
    expect(draw(createChartElement("bar")).querySelector(".recharts-tooltip-wrapper")).toBeNull();
    expect(draw(createChartElement("bar"), "#ffffff", true).querySelector(".recharts-tooltip-wrapper")).toBeInTheDocument();
  });

  describe("doughnut", () => {
    it("draws ring slices with a hole, unlike a pie", () => {
      const ringPath = draw(createChartElement("doughnut")).querySelector(".recharts-sector")!.getAttribute("d")!;
      const piePath = draw(createChartElement("pie")).querySelector(".recharts-sector")!.getAttribute("d")!;
      // A ring slice has an outer and an inner arc; a pie slice only has the outer one.
      expect(ringPath.match(/A/g)).toHaveLength(2);
      expect(piePath.match(/A/g)).toHaveLength(1);
    });

    it("draws one slice per positive value of the first series in palette order", () => {
      const chart = createChartElement("doughnut", {
        categories: ["a", "b", "c", "d"],
        series: [
          { name: "first", values: [5, 0, -3, 2] },
          { name: "ignored", values: [100, 100, 100, 100] },
        ],
      });
      const sectors = Array.from(draw(chart).querySelectorAll(".recharts-sector"));
      expect(sectors.map((s) => s.getAttribute("name"))).toEqual(["a", "d"]);
      expect(sectors.map((s) => s.getAttribute("fill"))).toEqual([CHART_COLORS_LIGHT[0], CHART_COLORS_LIGHT[3]]);
    });

    it("explains when no value is positive", () => {
      render(<ChartView element={createChartElement("doughnut", { series: [{ name: "s", values: [0, -1, -2, 0] }] })} background="#ffffff" />);
      expect(screen.getByText("No data to display")).toBeInTheDocument();
    });
  });

  describe("scatter", () => {
    it("plots one point per row with a numeric X, skipping the others", () => {
      const chart = createChartElement("scatter", { categories: ["1", "x", "3", "4"], series: [{ name: "A", values: [10, 20, 30, 40] }] });
      const container = draw(chart);
      expect(container.querySelectorAll(".recharts-scatter-symbol")).toHaveLength(3);
      expect(container.querySelector(".recharts-legend-wrapper")).toBeNull();
    });

    it("colors each series with its own palette slot", () => {
      const container = draw(createChartElement("scatter", { series: twoSeries }));
      const fills = Array.from(container.querySelectorAll(".recharts-scatter-symbol path")).map((n) => n.getAttribute("fill"));
      expect(fills).toEqual([...Array(4).fill(CHART_COLORS_LIGHT[0]), ...Array(4).fill(CHART_COLORS_LIGHT[1])]);
    });

    it("explains when no X value is a number", () => {
      render(<ChartView element={createChartElement("scatter", { categories: ["a", "b", "c", "d"] })} background="#ffffff" />);
      expect(screen.getByText("Scatter charts need numbers in the first column (X values)")).toBeInTheDocument();
      expect(screen.queryByText("No data to display")).not.toBeInTheDocument();
    });
  });

  describe("stacked bars", () => {
    it("stacks each series on top of the previous one in the same column", () => {
      const container = draw(createChartElement("bar", { stacked: true, series: twoSeries }));
      const bottom = barsOf(container, 0);
      const top = barsOf(container, 1);
      expect(bottom).toHaveLength(4);
      expect(top).toHaveLength(4);
      top.forEach((bar, i) => {
        expect(bar.x).toBe(bottom[i].x);
        expect(bar.y + bar.height).toBeCloseTo(bottom[i].y, 3);
      });
      // Every column totals 5, so all stacks end at the same height.
      expect(new Set(top.map((b) => b.y)).size).toBe(1);
    });

    it("places series side by side when not stacked", () => {
      const container = draw(createChartElement("bar", { series: twoSeries }));
      const left = barsOf(container, 0);
      const right = barsOf(container, 1);
      right.forEach((bar, i) => expect(bar.x).toBeGreaterThan(left[i].x));
    });

    it("separates stacked segments with the background color", () => {
      const container = draw(createChartElement("bar", { stacked: true, series: twoSeries }), "#ffffff");
      const rects = Array.from(container.querySelectorAll(".recharts-rectangle"));
      expect(rects.length).toBe(8);
      rects.forEach((r) => expect(r.getAttribute("stroke")).toBe("#ffffff"));
    });

    it("draws a single-series 'stacked' bar chart like a normal one", () => {
      const container = draw(createChartElement("bar", { stacked: true }));
      expect(container.querySelectorAll(".recharts-rectangle")).toHaveLength(4);
      Array.from(container.querySelectorAll(".recharts-rectangle")).forEach((r) => expect(r.getAttribute("stroke")).not.toBe("#ffffff"));
    });
  });

  describe("dual axis", () => {
    const dualData = [
      { name: "Units", values: [1, 2, 3, 4] },
      { name: "Revenue", values: [4000, 3000, 2000, 1000] },
    ];

    it("draws the last series of a bar chart as a line on a right-hand axis", () => {
      const container = draw(createChartElement("bar", { dualAxis: true, series: dualData }));
      expect(yAxisCount(container)).toBe(2);
      expect(yTicks(container, "left").at(-1)).toBe("4");
      expect(yTicks(container, "right").at(-1)).toBe("4K");
      expect(container.querySelectorAll(".recharts-bar")).toHaveLength(1);
      expect(container.querySelectorAll(".recharts-line")).toHaveLength(1);
      expect(barsOf(container, 0)).toHaveLength(4);
      expect(barsOf(container, 1)).toHaveLength(0);
    });

    it("gives the last line of a line chart its own right-hand axis", () => {
      const container = draw(createChartElement("line", { dualAxis: true, series: dualData }));
      expect(yTicks(container, "left").at(-1)).toBe("4");
      expect(yTicks(container, "right").at(-1)).toBe("4K");
      expect(container.querySelectorAll(".recharts-line")).toHaveLength(2);
    });

    it("shares one axis when dual axis is off", () => {
      const container = draw(createChartElement("bar", { series: dualData }));
      expect(yAxisCount(container)).toBe(1);
      expect(yTicks(container, "left").at(-1)).toBe("4K");
      expect(container.querySelectorAll(".recharts-line")).toHaveLength(0);
      expect(container.querySelectorAll(".recharts-bar")).toHaveLength(2);
    });

    it.each([
      ["a single series", createChartElement("bar", { dualAxis: true })],
      ["area charts", createChartElement("area", { dualAxis: true, series: dualData })],
      ["scatter charts", createChartElement("scatter", { dualAxis: true, series: dualData })],
    ])("ignores dual axis for %s", (_, chart) => {
      const container = draw(chart);
      expect(yAxisCount(container)).toBe(1);
      expect(yTicks(container, "right")).toEqual([]);
    });

    it("stacks the remaining bars when combined with stacking", () => {
      const container = draw(
        createChartElement("bar", {
          dualAxis: true,
          stacked: true,
          series: [{ name: "A", values: [1, 2, 3, 4] }, { name: "B", values: [4, 3, 2, 1] }, { name: "C", values: [100, 200, 300, 400] }],
        }),
      );
      const bottom = barsOf(container, 0);
      const top = barsOf(container, 1);
      top.forEach((bar, i) => expect(bar.x).toBe(bottom[i].x));
      expect(container.querySelectorAll(".recharts-line")).toHaveLength(1);
      expect(yTicks(container, "right").at(-1)).toBe("400");
    });
  });

  describe("data labels", () => {
    it("adds no value labels by default", () => {
      const container = draw(createChartElement("bar"));
      expect(container.querySelector(".recharts-label-list")).toBeNull();
    });

    it.each(["bar", "line", "area"] as const)("labels every %s value above its mark in compact form", (kind) => {
      const container = draw(createChartElement(kind, { showValues: true, series: [{ name: "s", values: [950, 1200, 2500000, -42] }] }));
      expect(valueLabels(container)).toEqual(["950", "1.2K", "2.5M", "-42"]);
      Array.from(container.querySelectorAll(".recharts-label-list text")).forEach((n) => expect(n.getAttribute("fill")).toBe(LIGHT_INK));
    });

    it("uses light ink for labels on dark slides", () => {
      const container = draw(createChartElement("line", { showValues: true }), "#000000");
      const fills = new Set(Array.from(container.querySelectorAll(".recharts-label-list text")).map((n) => n.getAttribute("fill")));
      expect([...fills]).toEqual([DARK_INK]);
    });

    it("labels each scatter point with its Y value", () => {
      const container = draw(createChartElement("scatter", { showValues: true, categories: ["1", "x", "3", "4"], series: [{ name: "A", values: [10, 20, 30, 1500] }] }));
      expect(valueLabels(container)).toEqual(["10", "30", "1.5K"]);
    });

    it.each(["pie", "doughnut"] as const)("labels %s slices with their values", (kind) => {
      const container = draw(createChartElement(kind, { showValues: true, series: [{ name: "s", values: [1200, 30, 45, 2500000] }] }));
      const labels = Array.from(container.querySelectorAll("svg.recharts-surface text")).map((n) => n.textContent);
      expect(labels).toEqual(["1.2K", "30", "45", "2.5M"]);
    });

    it.each(["pie", "doughnut"] as const)("draws no %s slice labels by default", (kind) => {
      const container = draw(createChartElement(kind));
      expect(container.querySelectorAll("svg.recharts-surface text")).toHaveLength(0);
    });

    it("centers stacked labels inside segments with text that contrasts with the segment", () => {
      const series = Array.from({ length: 7 }, (_, i) => ({ name: `S${i + 1}`, values: [11 + i] }));
      const container = draw(createChartElement("bar", { stacked: true, showValues: true, categories: ["Q1"], series }));
      const fillOf = (text: string) => Array.from(container.querySelectorAll(".recharts-label-list text")).find((n) => n.textContent === text)!.getAttribute("fill");
      expect(valueLabels(container)).toEqual(["11", "12", "13", "14", "15", "16", "17"]);
      // Light segments get near-black text; the dark green (slot 6) and violet (slot 7) segments get white.
      expect(fillOf("11")).toBe("#111111");
      expect(fillOf("15")).toBe("#111111");
      expect(fillOf("16")).toBe("#ffffff");
      expect(fillOf("17")).toBe("#ffffff");
    });

    it("keeps side-by-side bar labels in the slide's ink color", () => {
      const series = Array.from({ length: 7 }, (_, i) => ({ name: `S${i + 1}`, values: [11 + i] }));
      const container = draw(createChartElement("bar", { showValues: true, categories: ["Q1"], series }));
      const fills = new Set(Array.from(container.querySelectorAll(".recharts-label-list text")).map((n) => n.getAttribute("fill")));
      expect([...fills]).toEqual([LIGHT_INK]);
    });

    it("labels the second-axis line in a dual-axis bar chart", () => {
      const container = draw(createChartElement("bar", { dualAxis: true, showValues: true, series: [{ name: "A", values: [1, 2, 3, 4] }, { name: "B", values: [1000, 2000, 3000, 4000] }] }));
      expect(valueLabels(container)).toEqual(["1", "2", "3", "4", "1K", "2K", "3K", "4K"]);
    });
  });

  describe("no data", () => {
    it.each([
      ["a pie with only zero or negative values", createChartElement("pie", { series: [{ name: "s", values: [0, -5, 0, -1] }] })],
      ["a bar chart without finite values", createChartElement("bar", { series: [{ name: "s", values: [NaN, NaN, NaN, NaN] }] })],
    ])("shows 'No data to display' for %s", (_, chart) => {
      const container = draw(chart);
      expect(screen.getByText("No data to display")).toBeInTheDocument();
      expect(container.querySelector("svg")).toBeNull();
    });

    it("keeps the title and the chart's size when there is nothing to draw", () => {
      draw(createChartElement("doughnut", { title: "Share", width: 500, height: 300, series: [{ name: "s", values: [0, 0, 0, 0] }] }));
      expect(screen.getByText("Share")).toBeInTheDocument();
      expect(screen.getByText("No data to display")).toHaveStyle({ width: "500px", height: `${300 - CHART_TITLE_HEIGHT}px` });
    });

    it("draws a pie as long as one value is positive", () => {
      const container = draw(createChartElement("pie", { series: [{ name: "s", values: [0, 0, 0.5, 0] }] }));
      expect(screen.queryByText("No data to display")).not.toBeInTheDocument();
      expect(container.querySelectorAll(".recharts-sector")).toHaveLength(1);
    });
  });
});
