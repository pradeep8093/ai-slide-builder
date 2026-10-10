import { afterEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { currentDeck, editor, seedDeck, slideWith, toastMessages } from "@/test/utils";
import { CHART_KINDS, CHART_LABELS, FONT_SIZE_MAX, SHAPE_KINDS, SHAPE_LABELS } from "@/lib/constants";
import { createChartElement, createImageElement, createShapeElement, createTextElement } from "@/lib/factory";
import type { SlideElement } from "@/lib/schema";
import Toolbar from "./Toolbar";

const importImageFile = vi.fn();
vi.mock("@/lib/image", () => ({ importImageFile: (...a: unknown[]) => importImageFile(...a) }));

afterEach(() => importImageFile.mockReset());

function setup(...elements: SlideElement[]) {
  const deck = seedDeck([slideWith(...elements)]);
  const onEditChartData = vi.fn();
  render(<Toolbar onEditChartData={onEditChartData} />);
  return { slideId: deck.slides[0].id, onEditChartData };
}

function select(id: string) {
  act(() => editor().selectElement(id));
}

const elements = () => currentDeck().slides[0].elements;

describe("Toolbar insert tools", () => {
  it("are disabled until there is a slide", () => {
    seedDeck([]);
    render(<Toolbar onEditChartData={() => undefined} />);
    for (const name of ["Text", "Image", "Insert chart", "Insert shape"]) {
      expect(screen.getByRole("button", { name })).toBeDisabled();
    }
  });

  it("inserts a text box and opens it for editing with the text selected", async () => {
    const user = userEvent.setup();
    setup();
    await user.click(screen.getByRole("button", { name: "Text" }));
    expect(elements()).toHaveLength(1);
    expect(editor()).toMatchObject({ editingElementId: elements()[0].id, editingSelectAll: true });
  });

  it.each(CHART_KINDS)("inserts a %s chart", async (kind) => {
    const user = userEvent.setup();
    setup();
    await user.click(screen.getByRole("button", { name: "Insert chart" }));
    await user.click(screen.getByRole("menuitem", { name: CHART_LABELS[kind] }));
    expect(elements()[0]).toMatchObject({ type: "chart", chartType: kind });
    expect(editor().selectedElementId).toBe(elements()[0].id);
  });

  it.each(SHAPE_KINDS)("inserts a %s", async (kind) => {
    const user = userEvent.setup();
    setup();
    await user.click(screen.getByRole("button", { name: "Insert shape" }));
    await user.click(screen.getByRole("menuitem", { name: SHAPE_LABELS[kind] }));
    expect(elements()[0]).toMatchObject({ type: "shape", shape: kind });
  });

  it("inserts an uploaded image using the file name as alt text", async () => {
    const user = userEvent.setup();
    setup();
    importImageFile.mockResolvedValue({ src: "data:image/png;base64,AAAA", width: 400, height: 200 });
    await user.upload(screen.getByTestId("insert-image-input"), new File(["x"], "team-photo.png", { type: "image/png" }));
    await vi.waitFor(() => expect(elements()).toHaveLength(1));
    expect(elements()[0]).toMatchObject({ type: "image", alt: "team-photo", width: 400, height: 200 });
  });

  it("reports images that can't be imported", async () => {
    const user = userEvent.setup();
    setup();
    importImageFile.mockRejectedValue(new Error("Unsupported image type. Use PNG, JPEG, WebP or GIF."));
    await user.upload(screen.getByTestId("insert-image-input"), new File(["x"], "a.png", { type: "image/png" }));
    await vi.waitFor(() => expect(toastMessages()[0]).toMatch(/Unsupported image type/));
    expect(elements()).toHaveLength(0);
    fireEvent.change(screen.getByTestId("insert-image-input"), { target: { files: [] } });
  });
});

describe("Toolbar layout", () => {
  it("shows insert labels until an element is selected, then icons only (names stay accessible)", () => {
    const shape = createShapeElement("rectangle");
    setup(shape);
    expect(screen.getByText("Text")).not.toHaveClass("sr-only");
    select(shape.id);
    expect(screen.getByText("Text")).toHaveClass("sr-only");
    expect(screen.getByRole("button", { name: "Text" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Insert chart" })).toBeInTheDocument();
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
    await user.click(screen.getByRole("button", { name: "Bold" }));
    await user.click(screen.getByRole("button", { name: "Italic" }));
    await user.click(screen.getByRole("button", { name: "Underline" }));
    await user.click(screen.getByRole("button", { name: "Align center" }));
    await user.click(screen.getByRole("button", { name: "Increase font size" }));
    fireEvent.change(screen.getByLabelText("Text color"), { target: { value: "#ff0000" } });
    expect(elements()[0]).toMatchObject({ fontFamily: "Georgia", bold: true, italic: true, underline: true, align: "center", fontSize: 42, color: "#ff0000" });
    expect(screen.getByRole("button", { name: "Bold" })).toHaveAttribute("aria-pressed", "true");
    await user.click(screen.getByRole("button", { name: "Decrease font size" }));
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
    expect(screen.getByRole("button", { name: "Increase font size" })).toBeDisabled();
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
    await user.click(screen.getByRole("button", { name: "No fill" }));
    expect(elements()[0]).toMatchObject({ fill: null });
    await user.click(screen.getByRole("button", { name: "No fill" }));
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

  it("edits image alt text and replaces the image keeping its width", async () => {
    const user = userEvent.setup();
    const image = { ...createImageElement("data:image/png;base64,AAAA", 400, 200), width: 400, height: 200 };
    setup(image);
    select(image.id);
    const alt = screen.getByRole("textbox", { name: "Alt text" });
    await user.type(alt, "  Our team {Enter}");
    expect(elements()[0]).toMatchObject({ alt: "Our team" });
    importImageFile.mockResolvedValue({ src: "data:image/png;base64,NEW", width: 100, height: 100 });
    await user.upload(screen.getByTestId("replace-image-input"), new File(["x"], "b.png", { type: "image/png" }));
    await vi.waitFor(() => expect(elements()[0]).toMatchObject({ src: "data:image/png;base64,NEW", width: 400, height: 400 }));
    importImageFile.mockRejectedValue(new Error("This file isn't a valid image."));
    await user.upload(screen.getByTestId("replace-image-input"), new File(["x"], "c.png", { type: "image/png" }));
    await vi.waitFor(() => expect(toastMessages()).toContain("This file isn't a valid image."));
  });

  it("changes chart type, opens the data editor and toggles the legend", async () => {
    const user = userEvent.setup();
    const chart = createChartElement("bar", { series: [{ name: "A", values: [1, 2, 3, 4] }, { name: "B", values: [1, 2, 3, 4] }] });
    const { onEditChartData } = setup(chart);
    select(chart.id);
    await user.selectOptions(screen.getByRole("combobox", { name: "Chart type" }), "line");
    expect(elements()[0]).toMatchObject({ chartType: "line" });
    await user.click(screen.getByRole("button", { name: "Edit data" }));
    expect(onEditChartData).toHaveBeenCalledWith(chart.id);
    const legend = screen.getByRole("button", { name: "Legend" });
    expect(legend).toHaveAttribute("aria-pressed", "true");
    await user.click(legend);
    expect(elements()[0]).toMatchObject({ showLegend: false });
  });

  it("disables the legend toggle for single-series bar charts", () => {
    const chart = createChartElement("bar");
    setup(chart);
    select(chart.id);
    expect(screen.getByRole("button", { name: "Legend" })).toBeDisabled();
  });

  it("arranges, duplicates and deletes the selected element", async () => {
    const user = userEvent.setup();
    const a = createShapeElement("rectangle");
    const b = createShapeElement("ellipse");
    setup(a, b);
    select(a.id);
    await user.click(screen.getByRole("button", { name: "Arrange" }));
    await user.click(screen.getByRole("menuitem", { name: "Bring to front" }));
    expect(elements().map((e) => e.id)).toEqual([b.id, a.id]);
    await user.click(screen.getByRole("button", { name: "Arrange" }));
    await user.click(screen.getByRole("menuitem", { name: "Send backward" }));
    expect(elements().map((e) => e.id)).toEqual([a.id, b.id]);
    await user.click(screen.getByRole("button", { name: "Arrange" }));
    await user.click(screen.getByRole("menuitem", { name: "Bring forward" }));
    await user.click(screen.getByRole("button", { name: "Arrange" }));
    await user.click(screen.getByRole("menuitem", { name: "Send to back" }));
    expect(elements().map((e) => e.id)).toEqual([a.id, b.id]);
    await user.click(screen.getByRole("button", { name: "Duplicate element" }));
    expect(elements()).toHaveLength(3);
    await user.click(screen.getByRole("button", { name: "Delete element" }));
    expect(elements()).toHaveLength(2);
    expect(screen.getByLabelText("Slide background")).toBeInTheDocument();
  });
});
