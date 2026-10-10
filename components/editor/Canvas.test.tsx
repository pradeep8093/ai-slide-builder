import { describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { currentDeck, editor, seedDeck, slideWith } from "@/test/utils";
import { CORNER_HANDLES, RESIZE_HANDLES } from "@/lib/geometry";
import { createChartElement, createImageElement, createShapeElement, createTextElement } from "@/lib/factory";
import type { SlideElement } from "@/lib/schema";
import Canvas, { computeScale, describeElement, DRAG_THRESHOLD, handlesFor } from "./Canvas";

function setup(...elements: SlideElement[]) {
  seedDeck([slideWith(...elements)]);
  const onEditChartData = vi.fn();
  const utils = render(<Canvas onEditChartData={onEditChartData} />);
  return { ...utils, onEditChartData };
}

const box = (id: string) => document.querySelector(`[data-element-id="${id}"]`) as HTMLElement;
const element = (i = 0) => currentDeck().slides[0].elements[i];

/** jsdom has no layout, so the canvas uses its fallback scale of 0.5 (1 screen px = 2 slide px). */
function drag(target: Element, from: [number, number], to: [number, number]) {
  fireEvent.pointerDown(target, { button: 0, clientX: from[0], clientY: from[1] });
  fireEvent.pointerMove(window, { clientX: to[0], clientY: to[1] });
  fireEvent.pointerUp(window, { clientX: to[0], clientY: to[1] });
}

describe("helpers", () => {
  it("computes the fit scale with padding and a safe fallback", () => {
    expect(computeScale(0, 0)).toBe(0.5);
    expect(computeScale(1344, 784)).toBeCloseTo(1);
    expect(computeScale(100, 100)).toBe(0.1);
  });
  it("offers suitable resize handles", () => {
    expect(handlesFor(createShapeElement("line"))).toEqual(["w", "e"]);
    expect(handlesFor(createImageElement("data:image/png;base64,AAAA", 10, 10))).toEqual(CORNER_HANDLES);
    expect(handlesFor(createTextElement())).toEqual(RESIZE_HANDLES);
  });
  it("describes elements for assistive technology", () => {
    expect(describeElement(createTextElement({ text: "Hi" }))).toBe("Text: Hi");
    expect(describeElement(createTextElement({ text: "" }))).toBe("Text: empty");
    expect(describeElement(createShapeElement("rounded-rectangle"))).toBe("Shape: rounded rectangle");
    expect(describeElement(createImageElement("data:image/png;base64,AAAA", 1, 1, "Logo"))).toBe("Image: Logo");
    expect(describeElement(createImageElement("data:image/png;base64,AAAA", 1, 1))).toBe("Image");
    expect(describeElement(createChartElement("pie", { title: "Mix" }))).toBe("Pie chart: Mix");
  });
});

describe("Canvas", () => {
  it("renders nothing without a selected slide", () => {
    seedDeck([]);
    const { container } = render(<Canvas onEditChartData={() => undefined} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("renders the slide background and its elements", () => {
    const text = createTextElement({ text: "Hello" });
    setup(text);
    expect(screen.getByTestId("slide-canvas")).toBeInTheDocument();
    expect(box(text.id)).toHaveAttribute("aria-label", "Text: Hello");
    expect(box(text.id)).toHaveStyle({ left: `${text.x}px`, top: `${text.y}px` });
  });

  it("selects on click without moving and deselects on background click", () => {
    const shape = createShapeElement("rectangle");
    setup(shape);
    fireEvent.pointerDown(box(shape.id), { button: 0, clientX: 10, clientY: 10 });
    fireEvent.pointerMove(window, { clientX: 10 + DRAG_THRESHOLD - 1, clientY: 10 });
    fireEvent.pointerUp(window);
    expect(editor().selectedElementId).toBe(shape.id);
    expect(element().x).toBe(shape.x);
    expect(editor().past).toHaveLength(0);
    expect(screen.getByTestId("selection-box")).toBeInTheDocument();
    expect(document.querySelectorAll("[data-handle]")).toHaveLength(8);
    fireEvent.pointerDown(screen.getByTestId("slide-canvas").parentElement!.parentElement!, { button: 0 });
    expect(editor().selectedElementId).toBeNull();
  });

  it("ignores non-primary buttons", () => {
    const shape = createShapeElement("rectangle");
    setup(shape);
    fireEvent.pointerDown(box(shape.id), { button: 2 });
    expect(editor().selectedElementId).toBeNull();
  });

  it("moves an element by dragging, as one undo step", () => {
    const shape = createShapeElement("rectangle", { x: 100, y: 100 });
    setup(shape);
    drag(box(shape.id), [50, 50], [100, 75]);
    expect(element()).toMatchObject({ x: 200, y: 150 });
    expect(editor().past).toHaveLength(1);
    act(() => editor().undo());
    expect(element()).toMatchObject({ x: 100, y: 100 });
  });

  it("resizes from a handle and keeps image proportions", () => {
    const shape = createShapeElement("rectangle", { x: 100, y: 100, width: 200, height: 100 });
    setup(shape);
    fireEvent.pointerDown(box(shape.id), { button: 0, clientX: 0, clientY: 0 });
    fireEvent.pointerUp(window);
    drag(document.querySelector('[data-handle="se"]')!, [0, 0], [50, 10]);
    expect(element()).toMatchObject({ x: 100, y: 100, width: 300, height: 120 });
  });

  it("keeps image aspect ratio while resizing", () => {
    const image = { ...createImageElement("data:image/png;base64,AAAA", 400, 200), x: 0, y: 0, width: 400, height: 200 };
    setup(image);
    fireEvent.pointerDown(box(image.id), { button: 0, clientX: 0, clientY: 0 });
    fireEvent.pointerUp(window);
    expect(document.querySelectorAll("[data-handle]")).toHaveLength(4);
    drag(document.querySelector('[data-handle="se"]')!, [0, 0], [100, 0]);
    expect(element().width / element().height).toBeCloseTo(2);
    expect(element().width).toBe(600);
  });

  it("keeps aspect ratio for other elements while Shift is held", () => {
    const shape = createShapeElement("rectangle", { x: 0, y: 0, width: 200, height: 100 });
    setup(shape);
    fireEvent.pointerDown(box(shape.id), { button: 0, clientX: 0, clientY: 0 });
    fireEvent.pointerUp(window);
    fireEvent.pointerDown(document.querySelector('[data-handle="se"]')!, { button: 0, clientX: 0, clientY: 0 });
    fireEvent.pointerMove(window, { clientX: 100, clientY: 0, shiftKey: true });
    fireEvent.pointerUp(window);
    expect(element()).toMatchObject({ width: 400, height: 200 });
  });

  it("edits text in place, growing the box, and commits on Escape", async () => {
    const user = userEvent.setup();
    const text = createTextElement({ text: "Old", height: 40 });
    setup(text);
    fireEvent.doubleClick(box(text.id));
    const textarea = screen.getByRole("textbox", { name: "Edit text" });
    expect(textarea).toHaveFocus();
    Object.defineProperty(textarea, "scrollHeight", { configurable: true, get: () => 90 });
    await user.type(textarea, " and new");
    expect(element()).toMatchObject({ text: "Old and new", height: 90 });
    expect(document.querySelectorAll("[data-handle]")).toHaveLength(0);
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("textbox", { name: "Edit text" })).not.toBeInTheDocument();
    expect(editor().editingElementId).toBeNull();
    expect(editor().past).toHaveLength(1);
  });

  it("selects all text of a newly inserted text box", () => {
    const text = createTextElement({ text: "Text" });
    setup(text);
    act(() => editor().setEditing(text.id, true));
    const textarea = screen.getByRole("textbox", { name: "Edit text" }) as HTMLTextAreaElement;
    expect([textarea.selectionStart, textarea.selectionEnd]).toEqual([0, 4]);
  });

  it("removes a text box that was emptied", async () => {
    const user = userEvent.setup();
    const text = createTextElement({ text: "Bye" });
    setup(text);
    fireEvent.doubleClick(box(text.id));
    await user.clear(screen.getByRole("textbox", { name: "Edit text" }));
    await user.keyboard("{Escape}");
    expect(currentDeck().slides[0].elements).toHaveLength(0);
  });

  it("finishes text editing when another element is pressed", async () => {
    const user = userEvent.setup();
    const text = createTextElement({ text: "A" });
    const shape = createShapeElement("ellipse", { x: 0, y: 0 });
    setup(text, shape);
    fireEvent.doubleClick(box(text.id));
    await user.type(screen.getByRole("textbox", { name: "Edit text" }), "B");
    fireEvent.pointerDown(box(shape.id), { button: 0, clientX: 0, clientY: 0 });
    fireEvent.pointerUp(window);
    expect(editor().editingElementId).toBeNull();
    expect(editor().selectedElementId).toBe(shape.id);
    expect(element()).toMatchObject({ text: "AB" });
  });

  it("finishes text editing on a background click", async () => {
    const user = userEvent.setup();
    const text = createTextElement({ text: "A" });
    setup(text);
    fireEvent.doubleClick(box(text.id));
    await user.type(screen.getByRole("textbox", { name: "Edit text" }), "C");
    fireEvent.pointerDown(screen.getByTestId("slide-canvas").parentElement!.parentElement!, { button: 0 });
    expect(editor().editingElementId).toBeNull();
    expect(element()).toMatchObject({ text: "AC" });
  });

  it("opens the chart data editor on double click", () => {
    const chart = createChartElement("bar");
    const { onEditChartData } = setup(chart);
    fireEvent.doubleClick(box(chart.id));
    expect(onEditChartData).toHaveBeenCalledWith(chart.id);
    const shape = createShapeElement("rectangle");
    act(() => {
      editor().addElement(currentDeck().slides[0].id, shape);
    });
    fireEvent.doubleClick(box(shape.id));
    expect(editor().editingElementId).toBeNull();
  });
});
