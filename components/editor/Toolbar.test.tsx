import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { currentDeck, editor, seedDeck, slideWith, toastMessages } from "@/test/utils";
import { CHART_KINDS, CHART_LABELS, FONT_SIZE_MAX, SHAPE_KINDS, SHAPE_LABELS } from "@/lib/constants";
import { createChartElement, createImageElement, createShapeElement, createTableElement, createTextElement } from "@/lib/factory";
import type { ChartElement, SlideElement } from "@/lib/schema";
import { readClipboard } from "@/lib/store/clipboardStore";
import { LOCKED_MESSAGE } from "@/lib/store/editorStore";
import Toolbar from "./Toolbar";

const { importImageFile } = vi.hoisted(() => ({ importImageFile: vi.fn() }));
vi.mock("@/lib/image", () => ({ importImageFile: (...args: unknown[]) => importImageFile(...args) }));

beforeEach(() => {
  importImageFile.mockReset();
});

const PNG = "data:image/png;base64,AAAA";
const TWO_SERIES: Pick<ChartElement, "series"> = {
  series: [
    { name: "A", values: [1, 2, 3, 4] },
    { name: "B", values: [4, 3, 2, 1] },
  ],
};

function setup(...elements: SlideElement[]) {
  const deck = seedDeck([slideWith(...elements)]);
  const onEditElement = vi.fn();
  render(<Toolbar onEditElement={onEditElement} />);
  return { slideId: deck.slides[0].id, onEditElement };
}

function select(...ids: string[]) {
  act(() => editor().selectElements(ids));
}

const elements = () => currentDeck().slides[0].elements;
const byId = (id: string) => elements().find((e) => e.id === id)!;
const button = (name: string) => screen.getByRole("button", { name });
const queryButton = (name: string) => screen.queryByRole("button", { name });

async function chooseMenu(user: ReturnType<typeof userEvent.setup>, menu: string, item: string) {
  await user.click(button(menu));
  await user.click(screen.getByRole("menuitem", { name: item }));
}

describe("Toolbar insert tools", () => {
  it("are disabled until there is a slide", () => {
    seedDeck([]);
    render(<Toolbar onEditElement={() => undefined} />);
    for (const name of ["Text", "Image", "Table", "Insert chart", "Insert shape"]) {
      expect(button(name)).toBeDisabled();
    }
    expect(queryButton("Paste")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Slide background")).not.toBeInTheDocument();
  });

  it("inserts a text box and opens it for editing with the text selected", async () => {
    const user = userEvent.setup();
    setup();
    await user.click(button("Text"));
    expect(elements()).toHaveLength(1);
    expect(editor()).toMatchObject({ editingElementId: elements()[0].id, editingSelectAll: true });
  });

  it("inserts a table and selects it", async () => {
    const user = userEvent.setup();
    setup();
    await user.click(button("Table"));
    expect(elements()[0]).toMatchObject({ type: "table", headerRow: true, rows: [["Header 1", "Header 2", "Header 3"], ["", "", ""], ["", "", ""]] });
    expect(editor().selectedElementIds).toEqual([elements()[0].id]);
    expect(editor().editingElementId).toBeNull();
  });

  it("offers all six chart kinds", async () => {
    const user = userEvent.setup();
    setup();
    await user.click(button("Insert chart"));
    expect(screen.getAllByRole("menuitem").map((item) => item.textContent)).toEqual(CHART_KINDS.map((kind) => CHART_LABELS[kind]));
    expect(CHART_KINDS).toHaveLength(6);
  });

  it.each(CHART_KINDS)("inserts a %s chart", async (kind) => {
    const user = userEvent.setup();
    setup();
    await chooseMenu(user, "Insert chart", CHART_LABELS[kind]);
    expect(elements()[0]).toMatchObject({ type: "chart", chartType: kind });
    expect(editor().selectedElementIds).toEqual([elements()[0].id]);
  });

  it.each(SHAPE_KINDS)("inserts a %s", async (kind) => {
    const user = userEvent.setup();
    setup();
    await chooseMenu(user, "Insert shape", SHAPE_LABELS[kind]);
    expect(elements()[0]).toMatchObject({ type: "shape", shape: kind });
  });

  it("inserts an uploaded image using the file name as alt text", async () => {
    const user = userEvent.setup();
    setup();
    importImageFile.mockResolvedValue({ src: PNG, width: 400, height: 200 });
    await user.upload(screen.getByTestId("insert-image-input"), new File(["x"], "team-photo.png", { type: "image/png" }));
    await vi.waitFor(() => expect(elements()).toHaveLength(1));
    expect(elements()[0]).toMatchObject({ type: "image", alt: "team-photo", width: 400, height: 200 });
  });

  it("reports images that can't be imported and ignores an empty file choice", async () => {
    const user = userEvent.setup();
    setup();
    importImageFile.mockRejectedValue(new Error("Unsupported image type. Use PNG, JPEG, WebP or GIF."));
    await user.upload(screen.getByTestId("insert-image-input"), new File(["x"], "a.png", { type: "image/png" }));
    await vi.waitFor(() => expect(toastMessages()[0]).toMatch(/Unsupported image type/));
    expect(elements()).toHaveLength(0);
    fireEvent.change(screen.getByTestId("insert-image-input"), { target: { files: [] } });
    expect(importImageFile).toHaveBeenCalledTimes(1);
  });

  it("uses a generic message for unexpected import failures", async () => {
    const user = userEvent.setup();
    setup();
    importImageFile.mockRejectedValue("boom");
    await user.upload(screen.getByTestId("insert-image-input"), new File(["x"], "a.png", { type: "image/png" }));
    await vi.waitFor(() => expect(toastMessages()).toEqual(["The image couldn't be added."]));
  });
});

describe("Toolbar layout", () => {
  it("shows insert labels until an element is selected, then icons only (names stay accessible)", () => {
    const shape = createShapeElement("rectangle");
    setup(shape);
    expect(screen.getByText("Text")).not.toHaveClass("sr-only");
    expect(screen.getByText("Table")).not.toHaveClass("sr-only");
    select(shape.id);
    expect(screen.getByText("Text")).toHaveClass("sr-only");
    expect(screen.getByText("Table")).toHaveClass("sr-only");
    expect(button("Text")).toBeInTheDocument();
    expect(button("Insert chart")).toBeInTheDocument();
  });

  it("shows the slide background and a Paste button only when nothing is selected", () => {
    const shape = createShapeElement("rectangle");
    setup(shape);
    expect(screen.getByLabelText("Slide background")).toBeInTheDocument();
    expect(button("Paste")).toBeInTheDocument();
    expect(queryButton("More actions")).not.toBeInTheDocument();
    select(shape.id);
    expect(screen.queryByLabelText("Slide background")).not.toBeInTheDocument();
    expect(queryButton("Paste")).not.toBeInTheDocument();
    expect(button("More actions")).toBeInTheDocument();
  });
});

describe("Toolbar formatting", () => {
  it("edits the slide background when nothing is selected", () => {
    setup();
    fireEvent.change(screen.getByLabelText("Slide background"), { target: { value: "#123456" } });
    expect(currentDeck().slides[0].background).toBe("#123456");
  });

  it("formats text", async () => {
    const user = userEvent.setup();
    const text = createTextElement({ fontSize: 40 });
    setup(text);
    select(text.id);
    expect(screen.getByTestId("format-text")).toBeInTheDocument();
    await user.selectOptions(screen.getByRole("combobox", { name: "Font" }), "Georgia");
    await user.click(button("Bold"));
    await user.click(button("Italic"));
    await user.click(button("Underline"));
    await user.click(button("Align center"));
    await user.click(button("Increase font size"));
    fireEvent.change(screen.getByLabelText("Text color"), { target: { value: "#ff0000" } });
    expect(elements()[0]).toMatchObject({ fontFamily: "Georgia", bold: true, italic: true, underline: true, align: "center", fontSize: 42, color: "#ff0000" });
    expect(button("Bold")).toHaveAttribute("aria-pressed", "true");
    expect(button("Align center")).toHaveAttribute("aria-pressed", "true");
    expect(button("Align left")).toHaveAttribute("aria-pressed", "false");
    await user.click(button("Decrease font size"));
    expect(elements()[0]).toMatchObject({ fontSize: 40 });
  });

  it("accepts typed font sizes, clamps them and rejects non-numbers", async () => {
    const user = userEvent.setup();
    const text = createTextElement({ fontSize: 40 });
    setup(text);
    select(text.id);
    const size = screen.getByRole("textbox", { name: "Font size" });
    await user.clear(size);
    await user.type(size, "999{Enter}");
    expect(elements()[0]).toMatchObject({ fontSize: FONT_SIZE_MAX });
    expect(button("Increase font size")).toBeDisabled();
    await user.clear(size);
    await user.type(size, "abc");
    await user.tab();
    expect(toastMessages()[0]).toMatch(/Font size must be a number/);
    expect(size).toHaveValue(String(FONT_SIZE_MAX));
    await user.clear(size);
    await user.type(size, "12{Escape}");
    expect(size).toHaveValue(String(FONT_SIZE_MAX));
  });

  it("formats shapes: fill, no fill, border color and width", async () => {
    const user = userEvent.setup();
    const shape = createShapeElement("rectangle", { stroke: null, strokeWidth: 0 });
    setup(shape);
    select(shape.id);
    fireEvent.change(screen.getByLabelText("Fill color"), { target: { value: "#00ff00" } });
    expect(elements()[0]).toMatchObject({ fill: "#00ff00" });
    await user.click(button("No fill"));
    expect(elements()[0]).toMatchObject({ fill: null });
    await user.click(button("No fill"));
    expect(elements()[0]).toMatchObject({ fill: "#4f6bed" });
    fireEvent.change(screen.getByLabelText("Border color"), { target: { value: "#ff0000" } });
    expect(elements()[0]).toMatchObject({ stroke: "#ff0000", strokeWidth: 2 });
    await user.selectOptions(screen.getByRole("combobox", { name: "Border width" }), "8");
    expect(elements()[0]).toMatchObject({ strokeWidth: 8 });
    fireEvent.change(screen.getByLabelText("Border color"), { target: { value: "#0000ff" } });
    expect(elements()[0]).toMatchObject({ stroke: "#0000ff", strokeWidth: 8 });
    await user.selectOptions(screen.getByRole("combobox", { name: "Border width" }), "0");
    expect(elements()[0]).toMatchObject({ stroke: null, strokeWidth: 0 });
    await user.selectOptions(screen.getByRole("combobox", { name: "Border width" }), "4");
    expect(elements()[0]).toMatchObject({ stroke: "#1f2937", strokeWidth: 4 });
  });

  it("shows a non-standard border width as an option", () => {
    const shape = createShapeElement("ellipse", { stroke: "#000000", strokeWidth: 3 });
    setup(shape);
    select(shape.id);
    expect(screen.getByRole("combobox", { name: "Border width" })).toHaveValue("3");
  });

  it("formats lines with line color and width only", async () => {
    const user = userEvent.setup();
    const line = createShapeElement("line");
    setup(line);
    select(line.id);
    expect(screen.queryByLabelText("Fill color")).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Line color"), { target: { value: "#ff00ff" } });
    await user.selectOptions(screen.getByRole("combobox", { name: "Line width" }), "12");
    expect(elements()[0]).toMatchObject({ stroke: "#ff00ff", strokeWidth: 12 });
  });
});

describe("Toolbar image controls", () => {
  const image = (overrides: Partial<SlideElement> = {}) => ({ ...createImageElement(PNG, 400, 200), width: 400, height: 200, ...overrides }) as SlideElement;

  it("edits image alt text", async () => {
    const user = userEvent.setup();
    const img = image();
    setup(img);
    select(img.id);
    expect(screen.getByTestId("format-image")).toBeInTheDocument();
    await user.type(screen.getByRole("textbox", { name: "Alt text" }), "  Our team {Enter}");
    expect(byId(img.id)).toMatchObject({ alt: "Our team" });
  });

  it("replaces the image keeping its width and dropping the crop", async () => {
    const user = userEvent.setup();
    const img = image({ crop: { x: 0.1, y: 0.1, width: 0.5, height: 0.5 } } as Partial<SlideElement>);
    setup(img);
    select(img.id);
    expect(byId(img.id)).toHaveProperty("crop");
    importImageFile.mockResolvedValue({ src: "data:image/png;base64,NEW", width: 100, height: 100 });
    await user.upload(screen.getByTestId("replace-image-input"), new File(["x"], "b.png", { type: "image/png" }));
    await vi.waitFor(() => expect(byId(img.id)).toMatchObject({ src: "data:image/png;base64,NEW", width: 400, height: 400 }));
    expect(byId(img.id)).not.toHaveProperty("crop");
    expect(editor().past).toHaveLength(1);
  });

  it("reports images that can't replace the current one", async () => {
    const user = userEvent.setup();
    const img = image();
    setup(img);
    select(img.id);
    importImageFile.mockRejectedValue(new Error("This file isn't a valid image."));
    await user.upload(screen.getByTestId("replace-image-input"), new File(["x"], "c.png", { type: "image/png" }));
    await vi.waitFor(() => expect(toastMessages()).toContain("This file isn't a valid image."));
    expect(byId(img.id)).toMatchObject({ src: PNG });
    fireEvent.change(screen.getByTestId("replace-image-input"), { target: { files: [] } });
    expect(importImageFile).toHaveBeenCalledTimes(1);
  });

  it("opens the crop editor", async () => {
    const user = userEvent.setup();
    const img = image();
    const { onEditElement } = setup(img);
    select(img.id);
    await user.click(button("Crop"));
    expect(onEditElement).toHaveBeenCalledWith(img.id);
  });

  it("disables Replace and Crop for a locked image", () => {
    const img = image({ locked: true });
    setup(img);
    select(img.id);
    expect(button("Replace")).toBeDisabled();
    expect(button("Crop")).toBeDisabled();
    expect(button("Crop")).toHaveAttribute("title", "Unlock the image first");
    expect(screen.getByRole("textbox", { name: "Alt text" })).toBeEnabled();
  });
});

describe("Toolbar chart controls", () => {
  it("changes chart type, opens the data editor and toggles the legend", async () => {
    const user = userEvent.setup();
    const chart = createChartElement("bar", TWO_SERIES);
    const { onEditElement } = setup(chart);
    select(chart.id);
    expect(screen.getByTestId("format-chart")).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "Chart type" })).toHaveValue("bar");
    await user.selectOptions(screen.getByRole("combobox", { name: "Chart type" }), "line");
    expect(byId(chart.id)).toMatchObject({ chartType: "line" });
    await user.click(button("Edit data"));
    expect(onEditElement).toHaveBeenCalledWith(chart.id);
    const legend = button("Legend");
    expect(legend).toHaveAttribute("aria-pressed", "true");
    await user.click(legend);
    expect(byId(chart.id)).toMatchObject({ showLegend: false });
    expect(button("Legend")).toHaveAttribute("aria-pressed", "false");
  });

  it("lists all six chart types", () => {
    const chart = createChartElement("scatter");
    setup(chart);
    select(chart.id);
    const options = screen.getAllByRole("option").map((o) => (o as HTMLOptionElement).value);
    expect(options).toEqual([...CHART_KINDS]);
  });

  it("disables the legend toggle for single-series bar charts but not for pie charts", () => {
    const bar = createChartElement("bar");
    const pie = createChartElement("pie", { x: 0, y: 0 });
    setup(bar, pie);
    select(bar.id);
    expect(button("Legend")).toBeDisabled();
    expect(button("Legend")).toHaveAttribute("aria-pressed", "false");
    select(pie.id);
    expect(button("Legend")).toBeEnabled();
    expect(button("Legend")).toHaveAttribute("aria-pressed", "true");
  });

  it("toggles data labels", async () => {
    const user = userEvent.setup();
    const chart = createChartElement("area");
    setup(chart);
    select(chart.id);
    expect(button("Data labels")).toHaveAttribute("aria-pressed", "false");
    await user.click(button("Data labels"));
    expect(byId(chart.id)).toMatchObject({ showValues: true });
    expect(button("Data labels")).toHaveAttribute("aria-pressed", "true");
    await user.click(button("Data labels"));
    expect(byId(chart.id)).toMatchObject({ showValues: false });
  });

  it("stacks bar charts with two or more series", async () => {
    const user = userEvent.setup();
    const chart = createChartElement("bar", TWO_SERIES);
    setup(chart);
    select(chart.id);
    expect(button("Stacked")).toBeEnabled();
    expect(button("Stacked")).toHaveAttribute("aria-pressed", "false");
    await user.click(button("Stacked"));
    expect(byId(chart.id)).toMatchObject({ stacked: true });
    expect(button("Stacked")).toHaveAttribute("aria-pressed", "true");
  });

  it("disables stacking with a single series and doesn't show it as pressed", () => {
    const chart = createChartElement("bar", { stacked: true, dualAxis: true });
    setup(chart);
    select(chart.id);
    expect(button("Stacked")).toBeDisabled();
    expect(button("Stacked")).toHaveAttribute("aria-pressed", "false");
    expect(button("Dual axis")).toBeDisabled();
    expect(button("Dual axis")).toHaveAttribute("aria-pressed", "false");
  });

  it("puts the last series on a second axis for line charts", async () => {
    const user = userEvent.setup();
    const chart = createChartElement("line", TWO_SERIES);
    setup(chart);
    select(chart.id);
    expect(queryButton("Stacked")).not.toBeInTheDocument();
    await user.click(button("Dual axis"));
    expect(byId(chart.id)).toMatchObject({ dualAxis: true });
    expect(button("Dual axis")).toHaveAttribute("aria-pressed", "true");
  });

  it.each(["area", "pie", "doughnut", "scatter"] as const)("offers neither stacking nor a second axis for %s charts", (kind) => {
    const chart = createChartElement(kind, TWO_SERIES);
    setup(chart);
    select(chart.id);
    expect(queryButton("Stacked")).not.toBeInTheDocument();
    expect(queryButton("Dual axis")).not.toBeInTheDocument();
    expect(button("Data labels")).toBeInTheDocument();
  });
});

describe("Toolbar table controls", () => {
  it("opens the table editor and toggles the header row", async () => {
    const user = userEvent.setup();
    const table = createTableElement();
    const { onEditElement } = setup(table);
    select(table.id);
    expect(screen.getByTestId("format-table")).toBeInTheDocument();
    await user.click(button("Edit table"));
    expect(onEditElement).toHaveBeenCalledWith(table.id);
    expect(button("Header row")).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByLabelText("Header fill")).toBeEnabled();
    await user.click(button("Header row"));
    expect(byId(table.id)).toMatchObject({ headerRow: false });
    expect(button("Header row")).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByLabelText("Header fill")).toBeDisabled();
  });

  it("formats the table text", async () => {
    const user = userEvent.setup();
    const table = createTableElement({ fontSize: 20 });
    setup(table);
    select(table.id);
    await user.selectOptions(screen.getByRole("combobox", { name: "Font" }), "Verdana");
    await user.click(button("Increase font size"));
    fireEvent.change(screen.getByLabelText("Text color"), { target: { value: "#00aa00" } });
    expect(byId(table.id)).toMatchObject({ fontFamily: "Verdana", fontSize: 22, color: "#00aa00" });
    const size = screen.getByRole("textbox", { name: "Font size" });
    await user.clear(size);
    await user.type(size, "1{Enter}");
    expect(byId(table.id)).toMatchObject({ fontSize: 8 });
    expect(button("Decrease font size")).toBeDisabled();
  });

  it("sets header fill and border colors and removes borders", async () => {
    const user = userEvent.setup();
    const table = createTableElement();
    setup(table);
    select(table.id);
    fireEvent.change(screen.getByLabelText("Header fill"), { target: { value: "#ffeecc" } });
    fireEvent.change(screen.getByLabelText("Border color"), { target: { value: "#333333" } });
    expect(byId(table.id)).toMatchObject({ headerFill: "#ffeecc", borderColor: "#333333" });
    expect(button("No borders")).toHaveAttribute("aria-pressed", "false");
    await user.click(button("No borders"));
    expect(byId(table.id)).toMatchObject({ borderColor: null });
    expect(button("No borders")).toHaveAttribute("aria-pressed", "true");
    await user.click(button("No borders"));
    expect(byId(table.id)).toMatchObject({ borderColor: "#d1d5db" });
  });
});

describe("Toolbar multi-selection", () => {
  it("shows how many elements are selected and no formatting controls", () => {
    const text = createTextElement();
    const shape = createShapeElement("rectangle");
    const chart = createChartElement("bar");
    setup(text, shape, chart);
    select(text.id, shape.id, chart.id);
    expect(screen.getByTestId("multi-selection")).toHaveTextContent("3 elements selected");
    expect(screen.queryByTestId(/^format-/)).not.toBeInTheDocument();
    expect(queryButton("Bold")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Fill color")).not.toBeInTheDocument();
    expect(queryButton("Edit data")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Slide background")).not.toBeInTheDocument();
    for (const name of ["Lock", "Group", "Arrange", "Duplicate", "Delete", "More actions"]) expect(button(name)).toBeInTheDocument();
  });

  it("does not show the count for a single element", () => {
    const shape = createShapeElement("rectangle");
    setup(shape);
    select(shape.id);
    expect(screen.queryByTestId("multi-selection")).not.toBeInTheDocument();
  });

  it("locks and unlocks the whole selection", async () => {
    const user = userEvent.setup();
    const a = createShapeElement("rectangle");
    const b = createShapeElement("ellipse", { locked: true });
    setup(a, b);
    select(a.id, b.id);
    // Not everything is locked yet, so the button offers to lock.
    expect(button("Lock")).toHaveAttribute("aria-pressed", "false");
    await user.click(button("Lock"));
    expect(elements().every((e) => e.locked)).toBe(true);
    expect(button("Unlock")).toHaveAttribute("aria-pressed", "true");
    expect(queryButton("Lock")).not.toBeInTheDocument();
    await user.click(button("Unlock"));
    expect(elements().some((e) => e.locked)).toBe(false);
    expect(button("Lock")).toBeInTheDocument();
  });

  it("groups two or more units and ungroups them again", async () => {
    const user = userEvent.setup();
    const a = createShapeElement("rectangle");
    const b = createShapeElement("ellipse");
    setup(a, b);
    select(a.id);
    expect(queryButton("Group")).not.toBeInTheDocument();
    expect(queryButton("Ungroup")).not.toBeInTheDocument();
    select(a.id, b.id);
    expect(queryButton("Ungroup")).not.toBeInTheDocument();
    await user.click(button("Group"));
    expect(byId(a.id).groupId).toBeTruthy();
    expect(byId(b.id).groupId).toBe(byId(a.id).groupId);
    // The selection is now one group: nothing more to group.
    expect(queryButton("Group")).not.toBeInTheDocument();
    await user.click(button("Ungroup"));
    expect(byId(a.id).groupId).toBeUndefined();
    expect(byId(b.id).groupId).toBeUndefined();
    expect(queryButton("Ungroup")).not.toBeInTheDocument();
    expect(button("Group")).toBeInTheDocument();
  });

  it("offers both Group and Ungroup when a group is selected with another element", () => {
    const a = createShapeElement("rectangle", { groupId: "g" });
    const b = createShapeElement("ellipse", { groupId: "g" });
    const c = createShapeElement("triangle");
    setup(a, b, c);
    select(a.id, c.id);
    expect(button("Group")).toBeInTheDocument();
    expect(button("Ungroup")).toBeInTheDocument();
  });

  it("arranges, duplicates and deletes the whole selection", async () => {
    const user = userEvent.setup();
    const a = createShapeElement("rectangle");
    const b = createShapeElement("ellipse");
    const c = createShapeElement("triangle");
    setup(a, b, c);
    select(a.id, b.id);
    await chooseMenu(user, "Arrange", "Bring to front");
    expect(elements().map((e) => e.id)).toEqual([c.id, a.id, b.id]);
    await chooseMenu(user, "Arrange", "Send to back");
    expect(elements().map((e) => e.id)).toEqual([a.id, b.id, c.id]);
    await chooseMenu(user, "Arrange", "Bring forward");
    expect(elements().map((e) => e.id)).toEqual([c.id, a.id, b.id]);
    await chooseMenu(user, "Arrange", "Send backward");
    expect(elements().map((e) => e.id)).toEqual([a.id, b.id, c.id]);
    await user.click(button("Duplicate"));
    expect(elements()).toHaveLength(5);
    expect(editor().selectedElementIds).toEqual(elements().slice(3).map((e) => e.id));
    await user.click(button("Delete"));
    expect(elements().map((e) => e.id)).toEqual([a.id, b.id, c.id]);
    expect(screen.getByLabelText("Slide background")).toBeInTheDocument();
  });

  it("disables Delete when everything selected is locked", () => {
    const a = createShapeElement("rectangle", { locked: true });
    const b = createShapeElement("ellipse", { locked: true });
    setup(a, b);
    select(a.id, b.id);
    expect(button("Delete")).toBeDisabled();
    expect(button("Delete")).toHaveAttribute("title", "Locked elements can't be deleted");
  });

  it("deletes only the unlocked part of a partly locked selection", async () => {
    const user = userEvent.setup();
    const a = createShapeElement("rectangle", { locked: true });
    const b = createShapeElement("ellipse");
    setup(a, b);
    select(a.id, b.id);
    expect(button("Delete")).toBeEnabled();
    await user.click(button("Delete"));
    expect(elements().map((e) => e.id)).toEqual([a.id]);
    expect(toastMessages()).toEqual([LOCKED_MESSAGE]);
  });
});

describe("Toolbar clipboard actions", () => {
  it("copies and pastes the selection from the More actions menu", async () => {
    const user = userEvent.setup();
    const text = createTextElement({ text: "Copy me" });
    setup(text);
    select(text.id);
    await chooseMenu(user, "More actions", "Copy");
    expect(readClipboard()!.payload).toMatchObject({ kind: "elements", elements: [{ id: text.id }] });
    expect(elements()).toHaveLength(1);
    await chooseMenu(user, "More actions", "Paste");
    expect(elements()).toHaveLength(2);
    expect(elements()[1]).toMatchObject({ type: "text", text: "Copy me" });
    expect(editor().selectedElementIds).toEqual([elements()[1].id]);
  });

  it("puts the copied text on the system clipboard", async () => {
    const user = userEvent.setup();
    const writeText = vi.spyOn(navigator.clipboard, "writeText");
    const text = createTextElement({ text: "System" });
    setup(text);
    select(text.id);
    await chooseMenu(user, "More actions", "Copy");
    expect(writeText).toHaveBeenCalledWith("System");
  });

  it("cuts the selection from the More actions menu", async () => {
    const user = userEvent.setup();
    const a = createShapeElement("rectangle");
    const b = createShapeElement("ellipse");
    setup(a, b);
    select(a.id);
    await chooseMenu(user, "More actions", "Cut");
    expect(elements().map((e) => e.id)).toEqual([b.id]);
    expect(readClipboard()!.payload).toMatchObject({ kind: "elements", elements: [{ id: a.id }] });
  });

  it("does not cut locked elements", async () => {
    const user = userEvent.setup();
    const a = createShapeElement("rectangle", { locked: true });
    setup(a);
    select(a.id);
    await chooseMenu(user, "More actions", "Cut");
    expect(elements()).toHaveLength(1);
    expect(readClipboard()).toBeNull();
    expect(toastMessages()).toEqual([LOCKED_MESSAGE]);
  });

  it("pastes with the Paste button when nothing is selected", async () => {
    const user = userEvent.setup();
    const shape = createShapeElement("rectangle");
    setup(shape);
    await user.click(button("Paste"));
    expect(toastMessages()).toEqual(["Nothing to paste yet. Copy elements or slides first."]);
    expect(elements()).toHaveLength(1);
    select(shape.id);
    await chooseMenu(user, "More actions", "Copy");
    act(() => editor().selectElement(null));
    await user.click(button("Paste"));
    expect(elements()).toHaveLength(2);
    expect(elements()[1]).toMatchObject({ type: "shape", shape: "rectangle" });
  });
});
