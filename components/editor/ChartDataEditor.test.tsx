import { describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { currentDeck, editor, seedDeck, slideWith } from "@/test/utils";
import { MAX_CHART_CATEGORIES, MAX_CHART_SERIES } from "@/lib/constants";
import { createChartElement } from "@/lib/factory";
import type { ChartElement } from "@/lib/schema";
import ChartDataEditor, { parseValue } from "./ChartDataEditor";

type User = ReturnType<typeof userEvent.setup>;

function setup(chart: ChartElement = createChartElement("bar")) {
  const deck = seedDeck([slideWith(chart)]);
  const onClose = vi.fn();
  render(<ChartDataEditor slideId={deck.slides[0].id} chart={chart} onClose={onClose} />);
  return { onClose, chart };
}
const saved = () => currentDeck().slides[0].elements[0] as ChartElement;
const saveButton = () => screen.getByRole("button", { name: "Save" });
const pasteBox = () => screen.getByRole("textbox", { name: "Paste cells from a spreadsheet, or CSV text" });
const applyPasteButton = () => screen.getByRole("button", { name: "Use this data" });

async function pasteData(user: User, text: string) {
  await user.click(screen.getByRole("button", { name: "Paste data" }));
  await user.click(pasteBox());
  await user.paste(text);
  await user.click(applyPasteButton());
}

function labels() {
  return screen.getAllByRole("textbox", { name: /^(Label|X value) \d+$/ }).map((input) => (input as HTMLInputElement).value);
}

describe("parseValue", () => {
  it("parses numbers, thousands separators and rejects junk", () => {
    expect(parseValue("12")).toBe(12);
    expect(parseValue(" -3.5 ")).toBe(-3.5);
    expect(parseValue("1,200")).toBe(1200);
    expect(parseValue("1.5e3")).toBe(1500);
    expect(parseValue("")).toBeNull();
    expect(parseValue("   ")).toBeNull();
    expect(parseValue("abc")).toBeNull();
    expect(parseValue("12 apples")).toBeNull();
    expect(parseValue("Infinity")).toBeNull();
  });

  it("accepts currency and percent formatting from spreadsheets", () => {
    expect(parseValue("$1,200")).toBe(1200);
    expect(parseValue("12%")).toBe(12);
    expect(parseValue("€45")).toBe(45);
    expect(parseValue("£ 3.50")).toBe(3.5);
    expect(parseValue("-$7")).toBe(-7);
    expect(parseValue("$")).toBeNull();
    expect(parseValue("%")).toBeNull();
  });
});

describe("ChartDataEditor", () => {
  it("shows the current data and saves edits as one undo step", async () => {
    const user = userEvent.setup();
    const { onClose } = setup();
    expect(screen.getByRole("dialog", { name: "Edit chart data" })).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "Chart title" })).toHaveFocus();
    expect(screen.getByRole("columnheader", { name: "Label" })).toBeInTheDocument();
    await user.type(screen.getByRole("textbox", { name: "Chart title" }), "Sales");
    await user.clear(screen.getByRole("textbox", { name: "Label 1" }));
    await user.type(screen.getByRole("textbox", { name: "Label 1" }), "Jan");
    const cell = screen.getByRole("textbox", { name: "Series 1, Q2" });
    await user.clear(cell);
    await user.type(cell, "1,500");
    await user.click(saveButton());
    expect(saved()).toMatchObject({ title: "Sales", categories: ["Jan", "Q2", "Q3", "Q4"] });
    expect(saved().series[0].values[1]).toBe(1500);
    expect(onClose).toHaveBeenCalled();
    expect(editor().past).toHaveLength(1);
  });

  it("saves currency and percent values as numbers", async () => {
    const user = userEvent.setup();
    setup();
    const q1 = screen.getByRole("textbox", { name: "Series 1, Q1" });
    await user.clear(q1);
    await user.type(q1, "$1,200");
    const q2 = screen.getByRole("textbox", { name: "Series 1, Q2" });
    await user.clear(q2);
    await user.type(q2, "12%");
    expect(q1).toHaveAttribute("aria-invalid", "false");
    expect(q2).toHaveAttribute("aria-invalid", "false");
    expect(saveButton()).toBeEnabled();
    await user.click(saveButton());
    expect(saved().series[0].values).toEqual([1200, 12, 15, 23]);
  });

  it("trims the title and labels and names unnamed series on save", async () => {
    const user = userEvent.setup();
    setup(createChartElement("bar", { categories: ["A"], series: [{ name: "Revenue", values: [1] }] }));
    await user.type(screen.getByRole("textbox", { name: "Chart title" }), "  Spaced  ");
    await user.type(screen.getByRole("textbox", { name: "Label 1" }), "  ");
    await user.clear(screen.getByRole("textbox", { name: "Series 1 name" }));
    await user.type(screen.getByRole("textbox", { name: "Series 1 name" }), "   ");
    await user.click(saveButton());
    expect(saved()).toMatchObject({ title: "Spaced", categories: ["A"], series: [{ name: "Series 1", values: [1] }] });
  });

  it("blocks saving while any value isn't a number", async () => {
    const user = userEvent.setup();
    setup();
    const cell = screen.getByRole("textbox", { name: "Series 1, Q1" });
    await user.clear(cell);
    await user.type(cell, "ten");
    expect(cell).toHaveAttribute("aria-invalid", "true");
    expect(cell).toHaveClass("border-red-400");
    expect(screen.getByText("Every value must be a number.")).toBeInTheDocument();
    expect(saveButton()).toBeDisabled();
    await user.click(saveButton());
    expect(saved().series[0].values[0]).toBe(12);
    await user.clear(cell);
    expect(saveButton()).toBeDisabled();
    await user.type(cell, "10");
    expect(saveButton()).toBeEnabled();
    expect(screen.queryByText("Every value must be a number.")).not.toBeInTheDocument();
  });

  it("adds and removes rows and series", async () => {
    const user = userEvent.setup();
    setup();
    await user.click(screen.getByRole("button", { name: "Add row" }));
    expect(screen.getByRole("textbox", { name: "Label 5" })).toHaveValue("Item 5");
    expect(screen.getByRole("textbox", { name: "Series 1, Item 5" })).toHaveValue("0");
    await user.click(screen.getByRole("button", { name: "Add series" }));
    const name = screen.getByRole("textbox", { name: "Series 2 name" });
    expect(name).toHaveValue("Series 2");
    await user.clear(name);
    await user.click(screen.getByRole("button", { name: "Remove row 1" }));
    await user.click(saveButton());
    expect(saved().categories).toEqual(["Q2", "Q3", "Q4", "Item 5"]);
    expect(saved().series).toHaveLength(2);
    expect(saved().series[1]).toEqual({ name: "Series 2", values: [0, 0, 0, 0] });
  });

  it("removes a series", async () => {
    const user = userEvent.setup();
    setup(createChartElement("bar", { series: [{ name: "A", values: [1, 2, 3, 4] }, { name: "B", values: [5, 6, 7, 8] }] }));
    await user.click(screen.getByRole("button", { name: "Remove series 1" }));
    expect(screen.getByRole("textbox", { name: "Series 1 name" })).toHaveValue("B");
    expect(screen.getByRole("button", { name: "Remove series 1" })).toBeDisabled();
    await user.click(saveButton());
    expect(saved().series).toEqual([{ name: "B", values: [5, 6, 7, 8] }]);
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
    expect(screen.getByRole("button", { name: "Add row" })).toHaveAttribute("title", `Up to ${MAX_CHART_CATEGORIES} rows`);
    expect(screen.getByRole("button", { name: "Add series" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Add series" })).toHaveAttribute("title", `Up to ${MAX_CHART_SERIES} series`);
  });

  it("explains that pie charts use the first series", () => {
    setup(createChartElement("pie"));
    expect(screen.getByText("Pie charts show only the first series. Negative values are shown as empty slices.")).toBeInTheDocument();
  });

  it("explains that doughnut charts use the first series", () => {
    setup(createChartElement("doughnut"));
    expect(screen.getByText("Doughnut charts show only the first series. Negative values are shown as empty slices.")).toBeInTheDocument();
    expect(screen.queryByText(/^Pie charts/)).not.toBeInTheDocument();
  });

  it("shows no first-series note for other chart types", () => {
    setup(createChartElement("bar"));
    expect(screen.queryByText(/charts show only the first series/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Each row is a point/)).not.toBeInTheDocument();
  });

  it("cancels without changes", async () => {
    const user = userEvent.setup();
    const { onClose, chart } = setup();
    await user.type(screen.getByRole("textbox", { name: "Chart title" }), "Nope");
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onClose).toHaveBeenCalled();
    expect(saved()).toEqual(chart);
    expect(editor().past).toHaveLength(0);
  });

  it("closes with Escape without saving", async () => {
    const user = userEvent.setup();
    const { onClose, chart } = setup();
    await user.keyboard("{Escape}");
    expect(onClose).toHaveBeenCalled();
    expect(saved()).toEqual(chart);
  });

  describe("paste data", () => {
    it("opens a paste box whose button stays disabled until there is text", async () => {
      const user = userEvent.setup();
      setup();
      await user.click(screen.getByRole("button", { name: "Paste data" }));
      expect(pasteBox()).toHaveFocus();
      expect(screen.queryByRole("button", { name: "Paste data" })).not.toBeInTheDocument();
      expect(applyPasteButton()).toBeDisabled();
      await user.type(pasteBox(), "   ");
      expect(applyPasteButton()).toBeDisabled();
      await user.type(pasteBox(), "Q1,1");
      expect(applyPasteButton()).toBeEnabled();
    });

    it("replaces the data with tab-separated cells, using the header row as series names", async () => {
      const user = userEvent.setup();
      setup();
      await pasteData(user, "Quarter\tRevenue\tCost\nJan\t$1,200\t800\nFeb\t1500\t12%\n");
      expect(screen.queryByRole("textbox", { name: "Paste cells from a spreadsheet, or CSV text" })).not.toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Paste data" })).toBeInTheDocument();
      expect(screen.queryByRole("status")).not.toBeInTheDocument();
      expect(labels()).toEqual(["Jan", "Feb"]);
      expect(screen.getByRole("textbox", { name: "Series 1 name" })).toHaveValue("Revenue");
      expect(screen.getByRole("textbox", { name: "Series 2 name" })).toHaveValue("Cost");
      expect(screen.getByRole("textbox", { name: "Revenue, Jan" })).toHaveValue("$1,200");
      // Nothing is saved until Save.
      expect(saved().categories).toEqual(["Q1", "Q2", "Q3", "Q4"]);
      await user.click(saveButton());
      expect(saved().categories).toEqual(["Jan", "Feb"]);
      expect(saved().series).toEqual([
        { name: "Revenue", values: [1200, 1500] },
        { name: "Cost", values: [800, 12] },
      ]);
    });

    it("reads CSV text, including quoted cells", async () => {
      const user = userEvent.setup();
      setup();
      await pasteData(user, 'Region,Sales\n"North, East",10\nSouth,"1,500"');
      expect(labels()).toEqual(["North, East", "South"]);
      expect(screen.getByRole("textbox", { name: "Series 1 name" })).toHaveValue("Sales");
      await user.click(saveButton());
      expect(saved().series).toEqual([{ name: "Sales", values: [10, 1500] }]);
    });

    it("treats a first row of numbers as data and names the series", async () => {
      const user = userEvent.setup();
      setup();
      await pasteData(user, "2023,10,20\n2024,30,40");
      expect(labels()).toEqual(["2023", "2024"]);
      expect(screen.getByRole("textbox", { name: "Series 1 name" })).toHaveValue("Series 1");
      expect(screen.getByRole("textbox", { name: "Series 2 name" })).toHaveValue("Series 2");
      await user.click(saveButton());
      expect(saved().series).toEqual([
        { name: "Series 1", values: [10, 30] },
        { name: "Series 2", values: [20, 40] },
      ]);
    });

    it("flags pasted cells that aren't numbers and blocks saving", async () => {
      const user = userEvent.setup();
      setup();
      await pasteData(user, "Month\tVisits\nJan\tn/a\nFeb\t5");
      const bad = screen.getByRole("textbox", { name: "Visits, Jan" });
      expect(bad).toHaveValue("n/a");
      expect(bad).toHaveAttribute("aria-invalid", "true");
      expect(bad).toHaveClass("border-red-400", "bg-red-50");
      expect(screen.getByRole("textbox", { name: "Visits, Feb" })).toHaveAttribute("aria-invalid", "false");
      expect(screen.getByText("Every value must be a number.")).toBeInTheDocument();
      expect(saveButton()).toBeDisabled();
      await user.clear(bad);
      await user.type(bad, "7");
      expect(saveButton()).toBeEnabled();
      await user.click(saveButton());
      expect(saved().series).toEqual([{ name: "Visits", values: [7, 5] }]);
    });

    it("flags missing cells in short rows", async () => {
      const user = userEvent.setup();
      setup();
      await pasteData(user, "Jan\t1\t2\nFeb\t3");
      expect(screen.getByRole("textbox", { name: "Series 2, Feb" })).toHaveValue("");
      expect(screen.getByRole("textbox", { name: "Series 2, Feb" })).toHaveAttribute("aria-invalid", "true");
      expect(saveButton()).toBeDisabled();
    });

    it("explains when no data was found and keeps the current data", async () => {
      const user = userEvent.setup();
      setup();
      await pasteData(user, "just one column\nof words");
      expect(screen.getByRole("alert")).toHaveTextContent("No data found. Put labels in the first column and numbers in the columns next to it.");
      expect(pasteBox()).toBeInTheDocument();
      expect(labels()).toEqual(["Q1", "Q2", "Q3", "Q4"]);
    });

    it("finds no data in a header row alone", async () => {
      const user = userEvent.setup();
      setup();
      await pasteData(user, "Quarter\tRevenue");
      expect(screen.getByRole("alert")).toHaveTextContent("No data found.");
      expect(labels()).toEqual(["Q1", "Q2", "Q3", "Q4"]);
    });

    it("clears the error after a successful paste", async () => {
      const user = userEvent.setup();
      setup();
      await pasteData(user, "nothing useful");
      expect(screen.getByRole("alert")).toBeInTheDocument();
      await user.clear(pasteBox());
      await user.paste("A\t1");
      await user.click(applyPasteButton());
      expect(screen.queryByRole("alert")).not.toBeInTheDocument();
      expect(labels()).toEqual(["A"]);
    });

    it("tells when rows or series beyond the limits were left out", async () => {
      const user = userEvent.setup();
      setup();
      const columns = MAX_CHART_SERIES + 2;
      const header = ["Label", ...Array.from({ length: columns }, (_, c) => `S${c + 1}`)].join("\t");
      const rows = Array.from({ length: MAX_CHART_CATEGORIES + 6 }, (_, r) => [`Row ${r + 1}`, ...Array.from({ length: columns }, () => "1")].join("\t"));
      await pasteData(user, [header, ...rows].join("\n"));
      expect(screen.getByRole("status")).toHaveTextContent(`Only the first ${MAX_CHART_CATEGORIES} rows and ${MAX_CHART_SERIES} series were used.`);
      expect(labels()).toHaveLength(MAX_CHART_CATEGORIES);
      expect(labels().at(-1)).toBe(`Row ${MAX_CHART_CATEGORIES}`);
      expect(screen.getByRole("textbox", { name: `Series ${MAX_CHART_SERIES} name` })).toHaveValue(`S${MAX_CHART_SERIES}`);
      expect(screen.queryByRole("textbox", { name: `Series ${MAX_CHART_SERIES + 1} name` })).not.toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Add row" })).toBeDisabled();
      expect(screen.getByRole("button", { name: "Add series" })).toBeDisabled();
      await user.click(saveButton());
      expect(saved().categories).toHaveLength(MAX_CHART_CATEGORIES);
      expect(saved().series).toHaveLength(MAX_CHART_SERIES);
    });

    it("cancels pasting without changing the data", async () => {
      const user = userEvent.setup();
      const { onClose } = setup();
      await user.click(screen.getByRole("button", { name: "Paste data" }));
      await user.click(pasteBox());
      await user.paste("not used");
      await user.click(applyPasteButton());
      expect(screen.getByRole("alert")).toBeInTheDocument();
      const pasteArea = pasteBox().closest("label")!.parentElement!;
      await user.click(within(pasteArea).getByRole("button", { name: "Cancel" }));
      expect(screen.queryByRole("textbox", { name: "Paste cells from a spreadsheet, or CSV text" })).not.toBeInTheDocument();
      expect(screen.queryByRole("alert")).not.toBeInTheDocument();
      expect(labels()).toEqual(["Q1", "Q2", "Q3", "Q4"]);
      expect(onClose).not.toHaveBeenCalled();
      expect(screen.getByRole("dialog", { name: "Edit chart data" })).toBeInTheDocument();
    });
  });

  describe("scatter charts", () => {
    it("labels the first column as X values and explains the layout", () => {
      setup(createChartElement("scatter"));
      expect(screen.getByRole("columnheader", { name: "X value" })).toBeInTheDocument();
      expect(screen.queryByRole("columnheader", { name: "Label" })).not.toBeInTheDocument();
      expect(screen.getByText("Each row is a point: the first column is its X value, each series column its Y value.")).toBeInTheDocument();
      const x1 = screen.getByRole("textbox", { name: "X value 1" });
      expect(x1).toHaveValue("1");
      expect(x1).toHaveAttribute("inputmode", "decimal");
      expect(x1).toHaveAttribute("aria-invalid", "false");
    });

    it("flags X values that aren't numbers and blocks saving", async () => {
      const user = userEvent.setup();
      const { chart } = setup(createChartElement("scatter"));
      const x2 = screen.getByRole("textbox", { name: "X value 2" });
      await user.clear(x2);
      await user.type(x2, "two");
      expect(x2).toHaveAttribute("aria-invalid", "true");
      expect(x2).toHaveClass("border-red-400");
      expect(screen.getByRole("textbox", { name: "X value 1" })).toHaveAttribute("aria-invalid", "false");
      expect(screen.getByText("Every X value must be a number.")).toBeInTheDocument();
      expect(saveButton()).toBeDisabled();
      await user.click(saveButton());
      expect(saved()).toEqual(chart);
      await user.clear(x2);
      await user.type(x2, "2.5");
      expect(screen.queryByText("Every X value must be a number.")).not.toBeInTheDocument();
      await user.click(saveButton());
      expect(saved().categories).toEqual(["1", "2.5", "3", "4"]);
    });

    it("reports bad Y values before bad X values", async () => {
      const user = userEvent.setup();
      setup(createChartElement("scatter"));
      const x1 = screen.getByRole("textbox", { name: "X value 1" });
      await user.clear(x1);
      await user.type(x1, "a");
      const y = screen.getByRole("textbox", { name: "Series 1, 2" });
      await user.clear(y);
      await user.type(y, "b");
      expect(screen.getByText("Every value must be a number.")).toBeInTheDocument();
      expect(screen.queryByText("Every X value must be a number.")).not.toBeInTheDocument();
      expect(saveButton()).toBeDisabled();
    });

    it("gives new rows a numeric X value", async () => {
      const user = userEvent.setup();
      setup(createChartElement("scatter"));
      await user.click(screen.getByRole("button", { name: "Add row" }));
      expect(screen.getByRole("textbox", { name: "X value 5" })).toHaveValue("5");
      expect(screen.getByRole("textbox", { name: "X value 5" })).toHaveAttribute("aria-invalid", "false");
      expect(saveButton()).toBeEnabled();
      await user.click(saveButton());
      expect(saved().categories).toEqual(["1", "2", "3", "4", "5"]);
      expect(saved().series[0].values).toEqual([12, 19, 15, 23, 0]);
    });

    it("flags pasted X values that aren't numbers", async () => {
      const user = userEvent.setup();
      setup(createChartElement("scatter"));
      await pasteData(user, "x\ty\n1\t2\nthree\t4");
      expect(screen.getByRole("textbox", { name: "X value 2" })).toHaveAttribute("aria-invalid", "true");
      expect(screen.getByText("Every X value must be a number.")).toBeInTheDocument();
      expect(saveButton()).toBeDisabled();
    });
  });
});
