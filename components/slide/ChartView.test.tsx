import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { CHART_KINDS } from "@/lib/constants";
import { createChartElement } from "@/lib/factory";
import ChartView, { CHART_TITLE_HEIGHT } from "./ChartView";

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

  it("shows the title above the chart", () => {
    render(<ChartView element={createChartElement("bar", { title: "Revenue" })} background="#ffffff" />);
    const title = screen.getByText("Revenue");
    expect(title).toHaveStyle({ height: `${CHART_TITLE_HEIGHT}px` });
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
});
