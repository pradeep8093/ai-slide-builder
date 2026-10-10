import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { currentDeck, editor, seedDeck, slideWith } from "@/test/utils";
import { MAX_CHART_CATEGORIES, MAX_CHART_SERIES } from "@/lib/constants";
import { createChartElement } from "@/lib/factory";
import type { ChartElement } from "@/lib/schema";
import ChartDataEditor, { parseValue } from "./ChartDataEditor";

function setup(chart: ChartElement = createChartElement("bar")) {
  const deck = seedDeck([slideWith(chart)]);
  const onClose = vi.fn();
  render(<ChartDataEditor slideId={deck.slides[0].id} chart={chart} onClose={onClose} />);
  return { onClose, chart };
}
const saved = () => currentDeck().slides[0].elements[0] as ChartElement;

describe("parseValue", () => {
  it("parses numbers, thousands separators and rejects junk", () => {
    expect(parseValue("12")).toBe(12);
    expect(parseValue(" -3.5 ")).toBe(-3.5);
    expect(parseValue("1,200")).toBe(1200);
    expect(parseValue("")).toBeNull();
    expect(parseValue("abc")).toBeNull();
    expect(parseValue("Infinity")).toBeNull();
  });
});

describe("ChartDataEditor", () => {
  it("shows the current data and saves edits as one undo step", async () => {
    const user = userEvent.setup();
    const { onClose } = setup();
    expect(screen.getByRole("textbox", { name: "Chart title" })).toHaveFocus();
    await user.type(screen.getByRole("textbox", { name: "Chart title" }), "Sales");
    await user.clear(screen.getByRole("textbox", { name: "Label 1" }));
    await user.type(screen.getByRole("textbox", { name: "Label 1" }), "Jan");
    const cell = screen.getByRole("textbox", { name: "Series 1, Q2" });
    await user.clear(cell);
    await user.type(cell, "1,500");
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(saved()).toMatchObject({ title: "Sales", categories: ["Jan", "Q2", "Q3", "Q4"] });
    expect(saved().series[0].values[1]).toBe(1500);
    expect(onClose).toHaveBeenCalled();
    expect(editor().past).toHaveLength(1);
  });

  it("blocks saving while any value isn't a number", async () => {
    const user = userEvent.setup();
    setup();
    const cell = screen.getByRole("textbox", { name: "Series 1, Q1" });
    await user.clear(cell);
    await user.type(cell, "ten");
    expect(cell).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByText("Every value must be a number.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
    await user.clear(cell);
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
    await user.type(cell, "10");
    expect(screen.getByRole("button", { name: "Save" })).toBeEnabled();
  });

  it("adds and removes rows and series", async () => {
    const user = userEvent.setup();
    setup();
    await user.click(screen.getByRole("button", { name: "Add row" }));
    await user.click(screen.getByRole("button", { name: "Add series" }));
    const name = screen.getByRole("textbox", { name: "Series 2 name" });
    await user.clear(name);
    await user.click(screen.getByRole("button", { name: "Remove row 1" }));
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(saved().categories).toEqual(["Q2", "Q3", "Q4", "Item 5"]);
    expect(saved().series).toHaveLength(2);
    expect(saved().series[1]).toEqual({ name: "Series 2", values: [0, 0, 0, 0] });
  });

  it("keeps at least one row and one series", () => {
    setup(createChartElement("bar", { categories: ["Only"], series: [{ name: "S", values: [1] }] }));
    expect(screen.getByRole("button", { name: "Remove row 1" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Remove series 1" })).toBeDisabled();
  });

  it("respects the row and series limits", () => {
    const categories = Array.from({ length: MAX_CHART_CATEGORIES }, (_, i) => `c${i}`);
    const series = Array.from({ length: MAX_CHART_SERIES }, (_, i) => ({ name: `s${i}`, values: categories.map(() => 1) }));
    setup(createChartElement("line", { categories, series }));
    expect(screen.getByRole("button", { name: "Add row" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Add series" })).toBeDisabled();
  });

  it("explains that pie charts use the first series", async () => {
    const user = userEvent.setup();
    setup(createChartElement("pie"));
    expect(screen.getByText(/Pie charts show only the first series/)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Remove series 1" }).closest("table")!.querySelector("input")!);
  });

  it("cancels without changes", async () => {
    const user = userEvent.setup();
    const { onClose, chart } = setup();
    await user.type(screen.getByRole("textbox", { name: "Chart title" }), "Nope");
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onClose).toHaveBeenCalled();
    expect(saved()).toEqual(chart);
  });
});
