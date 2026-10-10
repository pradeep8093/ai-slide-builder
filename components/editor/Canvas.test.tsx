import { describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { currentDeck, editor, seedDeck, slideWith, toastMessages } from "@/test/utils";
import { CORNER_HANDLES, RESIZE_HANDLES } from "@/lib/geometry";
import { CHART_KINDS } from "@/lib/constants";
import { createChartElement, createImageElement, createShapeElement, createTableElement, createTextElement } from "@/lib/factory";
import type { SlideElement } from "@/lib/schema";
import { useChatStore } from "@/lib/store/chatStore";
import { LOCKED_MESSAGE, useEditorStore } from "@/lib/store/editorStore";
import { toast } from "@/lib/store/toastStore";
import Canvas, { computeScale, describeElement, DRAG_THRESHOLD, handlesFor, idsInMarquee } from "./Canvas";

const PNG = "data:image/png;base64,AAAA";

function setup(...elements: SlideElement[]) {
  const deck = seedDeck([slideWith(...elements)]);
  const onEditElement = vi.fn();
  const utils = render(<Canvas onEditElement={onEditElement} />);
  return { ...utils, onEditElement, slideId: deck.slides[0].id };
}

const box = (id: string) => document.querySelector(`[data-element-id="${id}"]`) as HTMLElement;
const handle = (name: string) => document.querySelector(`[data-handle="${name}"]`) as HTMLElement;
const handles = () => document.querySelectorAll("[data-handle]");
const elements = () => currentDeck().slides[0].elements;
const byId = (id: string) => elements().find((e) => e.id === id)!;
const selection = () => [...editor().selectedElementIds].sort();
const sorted = (...ids: string[]) => [...ids].sort();
const stage = () => screen.getByTestId("slide-canvas");

/** jsdom has no layout, so the canvas uses its fallback scale of 0.5 (1 screen px = 2 slide px). */
function drag(target: Element, from: [number, number], to: [number, number], init: { shiftKey?: boolean } = {}) {
  fireEvent.pointerDown(target, { button: 0, clientX: from[0], clientY: from[1], ...init });
  fireEvent.pointerMove(window, { clientX: to[0], clientY: to[1] });
  fireEvent.pointerUp(window, { clientX: to[0], clientY: to[1] });
}

function click(target: Element, init: { shiftKey?: boolean; ctrlKey?: boolean; metaKey?: boolean } = {}) {
  fireEvent.pointerDown(target, { button: 0, clientX: 0, clientY: 0, ...init });
  fireEvent.pointerUp(window);
}

describe("helpers", () => {
  it("computes the fit scale with padding and a safe fallback", () => {
    expect(computeScale(0, 0)).toBe(0.5);
    expect(computeScale(-10, 500)).toBe(0.5);
    expect(computeScale(1344, 784)).toBeCloseTo(1);
    expect(computeScale(100, 100)).toBe(0.1);
  });

  it("offers suitable resize handles", () => {
    expect(handlesFor(createShapeElement("line"))).toEqual(["w", "e"]);
    expect(handlesFor(createImageElement(PNG, 10, 10))).toEqual(CORNER_HANDLES);
    expect(handlesFor(createTextElement())).toEqual(RESIZE_HANDLES);
    expect(handlesFor(createTableElement())).toEqual(RESIZE_HANDLES);
    expect(handlesFor(createChartElement("bar"))).toEqual(RESIZE_HANDLES);
  });

  it("describes every element type for assistive technology", () => {
    expect(describeElement(createTextElement({ text: "Hi" }))).toBe("Text: Hi");
    expect(describeElement(createTextElement({ text: "" }))).toBe("Text: empty");
    expect(describeElement(createTextElement({ text: "x".repeat(60) }))).toBe(`Text: ${"x".repeat(40)}`);
    expect(describeElement(createShapeElement("rounded-rectangle"))).toBe("Shape: rounded rectangle");
    expect(describeElement(createImageElement(PNG, 1, 1, "Logo"))).toBe("Image: Logo");
    expect(describeElement(createImageElement(PNG, 1, 1))).toBe("Image");
    expect(describeElement(createChartElement("pie", { title: "Mix" }))).toBe("Pie chart: Mix");
    expect(describeElement(createChartElement("line"))).toBe("Line chart");
    expect(describeElement(createTableElement())).toBe("Table: 3 × 3");
    expect(describeElement(createTableElement({ rows: [["a", "b"]] }))).toBe("Table: 1 × 2");
  });

  it.each([
    [CHART_KINDS[0], "Bar"],
    [CHART_KINDS[1], "Line"],
    [CHART_KINDS[2], "Area"],
    [CHART_KINDS[3], "Pie"],
    [CHART_KINDS[4], "Doughnut"],
    [CHART_KINDS[5], "Scatter"],
  ])("names %s charts", (kind, name) => {
    expect(describeElement(createChartElement(kind))).toBe(`${name} chart`);
  });

  it("marks locked elements of every type", () => {
    expect(describeElement(createTextElement({ text: "Hi", locked: true }))).toBe("Text: Hi (locked)");
    expect(describeElement(createShapeElement("ellipse", { locked: true }))).toBe("Shape: ellipse (locked)");
    expect(describeElement({ ...createImageElement(PNG, 1, 1, "Logo"), locked: true })).toBe("Image: Logo (locked)");
    expect(describeElement({ ...createImageElement(PNG, 1, 1), locked: true })).toBe("Image (locked)");
    expect(describeElement(createChartElement("bar", { title: "Sales", locked: true }))).toBe("Bar chart: Sales (locked)");
    expect(describeElement(createTableElement({ locked: true }))).toBe("Table: 3 × 3 (locked)");
  });

  describe("idsInMarquee", () => {
    const a = createShapeElement("rectangle", { x: 100, y: 100, width: 100, height: 100 });
    const b = createShapeElement("rectangle", { x: 300, y: 100, width: 100, height: 100 });

    it("selects only elements that lie fully inside the box (edges may touch)", () => {
      const slide = slideWith(a, b);
      expect(idsInMarquee(slide, { x: 100, y: 100, width: 100, height: 100 })).toEqual([a.id]);
      expect(idsInMarquee(slide, { x: 0, y: 0, width: 350, height: 300 })).toEqual([a.id]);
      expect(idsInMarquee(slide, { x: 0, y: 0, width: 500, height: 300 })).toEqual([a.id, b.id]);
      expect(idsInMarquee(slide, { x: 150, y: 150, width: 10, height: 10 })).toEqual([]);
      expect(idsInMarquee(slideWith(), { x: 0, y: 0, width: 1280, height: 720 })).toEqual([]);
    });

    it("selects a group only when all of its members are inside, then all of them", () => {
      const ga = { ...a, groupId: "g" };
      const gb = { ...b, groupId: "g" };
      const c = createShapeElement("ellipse", { x: 120, y: 300, width: 50, height: 50 });
      const slide = slideWith(ga, c, gb);
      expect(idsInMarquee(slide, { x: 0, y: 0, width: 250, height: 400 })).toEqual([c.id]);
      expect(idsInMarquee(slide, { x: 0, y: 0, width: 500, height: 250 })).toEqual([ga.id, gb.id]);
      expect(idsInMarquee(slide, { x: 0, y: 0, width: 500, height: 400 })).toEqual([ga.id, gb.id, c.id]);
    });
  });
});

describe("Canvas rendering", () => {
  it("renders nothing without a selected slide", () => {
    seedDeck([]);
    const { container } = render(<Canvas onEditElement={() => undefined} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("renders the slide and its elements with accessible names", () => {
    const text = createTextElement({ text: "Hello" });
    const table = createTableElement({ locked: true });
    setup(text, table);
    expect(stage()).toHaveAccessibleName("Slide canvas");
    expect(box(text.id)).toHaveAttribute("aria-label", "Text: Hello");
    expect(box(text.id)).toHaveStyle({ left: `${text.x}px`, top: `${text.y}px`, width: `${text.width}px`, height: `${text.height}px` });
    expect(box(table.id)).toHaveAttribute("aria-label", "Table: 3 × 3 (locked)");
    expect(screen.queryByTestId("selection-box")).not.toBeInTheDocument();
  });
});

describe("Canvas selection", () => {
  it("selects on click without moving and deselects on a background press", () => {
    const shape = createShapeElement("rectangle");
    setup(shape);
    fireEvent.pointerDown(box(shape.id), { button: 0, clientX: 10, clientY: 10 });
    fireEvent.pointerMove(window, { clientX: 10 + DRAG_THRESHOLD - 1, clientY: 10 });
    fireEvent.pointerUp(window);
    expect(editor().selectedElementIds).toEqual([shape.id]);
    expect(byId(shape.id).x).toBe(shape.x);
    expect(editor().past).toHaveLength(0);
    expect(screen.getByTestId("selection-box")).toBeInTheDocument();
    expect(handles()).toHaveLength(8);
    expect(screen.queryByTestId("lock-badge")).not.toBeInTheDocument();
    fireEvent.pointerDown(stage(), { button: 0 });
    fireEvent.pointerUp(window);
    expect(editor().selectedElementIds).toEqual([]);
    expect(screen.queryByTestId("selection-box")).not.toBeInTheDocument();
  });

  it("ignores non-primary buttons on elements and on the background", () => {
    const shape = createShapeElement("rectangle");
    setup(shape);
    fireEvent.pointerDown(box(shape.id), { button: 2 });
    expect(editor().selectedElementIds).toEqual([]);
    act(() => editor().selectElement(shape.id));
    fireEvent.pointerDown(stage(), { button: 1 });
    expect(editor().selectedElementIds).toEqual([shape.id]);
  });

  it("selects the whole group when one member is clicked", () => {
    const a = createShapeElement("rectangle", { x: 100, y: 100, width: 100, height: 100, groupId: "g" });
    const b = createShapeElement("ellipse", { x: 300, y: 100, width: 100, height: 100, groupId: "g" });
    const c = createShapeElement("triangle", { x: 500, y: 400 });
    setup(a, b, c);
    click(box(b.id));
    expect(selection()).toEqual(sorted(a.id, b.id));
    expect(screen.getAllByTestId("selection-outline")).toHaveLength(2);
    expect(screen.getByTestId("selection-bounds")).toBeInTheDocument();
  });

  it.each([["shiftKey"], ["ctrlKey"], ["metaKey"]] as const)("toggles elements in the selection with %s-click", (modifier) => {
    const a = createShapeElement("rectangle", { x: 100, y: 100 });
    const b = createShapeElement("ellipse", { x: 400, y: 100 });
    setup(a, b);
    click(box(a.id));
    click(box(b.id), { [modifier]: true });
    expect(selection()).toEqual(sorted(a.id, b.id));
    click(box(a.id), { [modifier]: true });
    expect(editor().selectedElementIds).toEqual([b.id]);
  });

  it("does not start a drag on a modifier-click", () => {
    const a = createShapeElement("rectangle", { x: 100, y: 100 });
    setup(a);
    drag(box(a.id), [0, 0], [100, 100], { shiftKey: true });
    expect(editor().selectedElementIds).toEqual([a.id]);
    expect(byId(a.id)).toMatchObject({ x: 100, y: 100 });
    expect(editor().past).toHaveLength(0);
  });

  it("toggles a whole group with shift-click", () => {
    const a = createShapeElement("rectangle", { x: 100, y: 100, groupId: "g" });
    const b = createShapeElement("ellipse", { x: 400, y: 100, groupId: "g" });
    const c = createShapeElement("triangle", { x: 700, y: 100 });
    setup(a, b, c);
    click(box(c.id));
    click(box(a.id), { shiftKey: true });
    expect(selection()).toEqual(sorted(a.id, b.id, c.id));
    click(box(b.id), { shiftKey: true });
    expect(editor().selectedElementIds).toEqual([c.id]);
  });

  it("narrows a multi-selection to the clicked element on release when it wasn't dragged", () => {
    const a = createShapeElement("rectangle", { x: 100, y: 100 });
    const b = createShapeElement("ellipse", { x: 400, y: 100 });
    setup(a, b);
    act(() => editor().selectElements([a.id, b.id]));
    fireEvent.pointerDown(box(a.id), { button: 0, clientX: 0, clientY: 0 });
    // The selection only narrows on release, so a drag can still move everything.
    expect(selection()).toEqual(sorted(a.id, b.id));
    fireEvent.pointerUp(window);
    expect(editor().selectedElementIds).toEqual([a.id]);
    expect(editor().past).toHaveLength(0);
  });

  it("narrows to the clicked group, not just the clicked member", () => {
    const a = createShapeElement("rectangle", { x: 100, y: 100, groupId: "g" });
    const b = createShapeElement("ellipse", { x: 400, y: 100, groupId: "g" });
    const c = createShapeElement("triangle", { x: 700, y: 100 });
    setup(a, b, c);
    act(() => editor().selectAllElements());
    click(box(a.id));
    expect(selection()).toEqual(sorted(a.id, b.id));
    // Clicking a member of a selection that is exactly its group keeps the group.
    click(box(b.id));
    expect(selection()).toEqual(sorted(a.id, b.id));
  });

  it("keeps a multi-selection when its member is dragged", () => {
    const a = createShapeElement("rectangle", { x: 100, y: 100 });
    const b = createShapeElement("ellipse", { x: 400, y: 100 });
    setup(a, b);
    act(() => editor().selectElements([a.id, b.id]));
    drag(box(a.id), [0, 0], [10, 0]);
    expect(selection()).toEqual(sorted(a.id, b.id));
    expect(byId(a.id).x).toBe(120);
    expect(byId(b.id).x).toBe(420);
  });
});

describe("Canvas moving", () => {
  it("moves an element by dragging, as one undo step", () => {
    const shape = createShapeElement("rectangle", { x: 100, y: 100 });
    setup(shape);
    fireEvent.pointerDown(box(shape.id), { button: 0, clientX: 50, clientY: 50 });
    fireEvent.pointerMove(window, { clientX: 75, clientY: 60 });
    fireEvent.pointerMove(window, { clientX: 100, clientY: 75 });
    fireEvent.pointerUp(window);
    expect(byId(shape.id)).toMatchObject({ x: 200, y: 150 });
    expect(editor().past).toHaveLength(1);
    expect(editor().gestureBase).toBeNull();
    act(() => editor().undo());
    expect(byId(shape.id)).toMatchObject({ x: 100, y: 100 });
  });

  it("starts moving only once the pointer passed the drag threshold", () => {
    const shape = createShapeElement("rectangle", { x: 100, y: 100 });
    setup(shape);
    fireEvent.pointerDown(box(shape.id), { button: 0, clientX: 10, clientY: 10 });
    // hypot(2, 2) ≈ 2.83 < DRAG_THRESHOLD
    fireEvent.pointerMove(window, { clientX: 12, clientY: 12 });
    expect(byId(shape.id)).toMatchObject({ x: 100, y: 100 });
    fireEvent.pointerMove(window, { clientX: 10 + DRAG_THRESHOLD, clientY: 10 });
    expect(byId(shape.id)).toMatchObject({ x: 100 + DRAG_THRESHOLD * 2, y: 100 });
    // Once dragging, small movements count too.
    fireEvent.pointerMove(window, { clientX: 11, clientY: 10 });
    expect(byId(shape.id)).toMatchObject({ x: 102, y: 100 });
    fireEvent.pointerUp(window);
    expect(editor().past).toHaveLength(1);
  });

  it("moves an unselected group member together with its group", () => {
    const a = createShapeElement("rectangle", { x: 100, y: 100, groupId: "g" });
    const b = createShapeElement("ellipse", { x: 400, y: 300, groupId: "g" });
    setup(a, b);
    drag(box(b.id), [0, 0], [10, 20]);
    expect(byId(a.id)).toMatchObject({ x: 120, y: 140 });
    expect(byId(b.id)).toMatchObject({ x: 420, y: 340 });
  });

  it("moves the whole selection keeping the spacing, even at the slide edge", () => {
    const a = createShapeElement("rectangle", { x: 100, y: 100, width: 200, height: 100 });
    const b = createShapeElement("rectangle", { x: 400, y: 300, width: 200, height: 100 });
    const c = createShapeElement("ellipse", { x: 900, y: 500 });
    setup(a, b, c);
    act(() => editor().selectElements([a.id, b.id]));
    drag(box(a.id), [0, 0], [2000, 0]);
    // b can move at most until only 24px of it remain visible (1280 - 24 - 400 = 856); a follows by the same amount.
    expect(byId(b.id)).toMatchObject({ x: 1256, y: 300 });
    expect(byId(a.id)).toMatchObject({ x: 956, y: 100 });
    expect(byId(c.id)).toMatchObject({ x: 900, y: 500 });
    expect(editor().past).toHaveLength(1);
  });

  it("clamps dragging up and left so every element stays reachable", () => {
    const a = createShapeElement("rectangle", { x: 100, y: 100, width: 200, height: 100 });
    const b = createShapeElement("rectangle", { x: 400, y: 300, width: 200, height: 100 });
    setup(a, b);
    act(() => editor().selectElements([a.id, b.id]));
    drag(box(b.id), [1000, 1000], [0, 0]);
    // a limits the move: x ≥ 24 - 200 = -176, y ≥ 24 - 100 = -76.
    expect(byId(a.id)).toMatchObject({ x: -176, y: -76 });
    expect(byId(b.id)).toMatchObject({ x: 124, y: 124 });
  });

  it("does not move a locked element and warns only once per drag", () => {
    const info = vi.spyOn(toast, "info");
    const locked = createShapeElement("rectangle", { x: 100, y: 100, locked: true });
    setup(locked);
    fireEvent.pointerDown(box(locked.id), { button: 0, clientX: 0, clientY: 0 });
    fireEvent.pointerMove(window, { clientX: 50, clientY: 50 });
    fireEvent.pointerMove(window, { clientX: 80, clientY: 80 });
    fireEvent.pointerUp(window);
    expect(editor().selectedElementIds).toEqual([locked.id]);
    expect(byId(locked.id)).toMatchObject({ x: 100, y: 100 });
    expect(info).toHaveBeenCalledTimes(1);
    expect(info).toHaveBeenCalledWith(LOCKED_MESSAGE);
    expect(toastMessages()).toEqual([LOCKED_MESSAGE]);
    expect(editor().past).toHaveLength(0);
    expect(editor().gestureBase).toBeNull();
  });

  it("does not warn when a locked element is only clicked", () => {
    const info = vi.spyOn(toast, "info");
    const locked = createShapeElement("rectangle", { locked: true });
    setup(locked);
    click(box(locked.id));
    expect(info).not.toHaveBeenCalled();
  });

  it("keeps the whole selection in place when any selected element is locked", () => {
    const a = createShapeElement("rectangle", { x: 100, y: 100 });
    const b = createShapeElement("ellipse", { x: 400, y: 100, locked: true });
    setup(a, b);
    act(() => editor().selectElements([a.id, b.id]));
    drag(box(a.id), [0, 0], [50, 50]);
    expect(byId(a.id)).toMatchObject({ x: 100, y: 100 });
    expect(byId(b.id)).toMatchObject({ x: 400, y: 100 });
    expect(toastMessages()).toEqual([LOCKED_MESSAGE]);
    expect(selection()).toEqual(sorted(a.id, b.id));
  });

  it("ends the gesture when the pointer is cancelled", () => {
    const shape = createShapeElement("rectangle", { x: 100, y: 100 });
    setup(shape);
    fireEvent.pointerDown(box(shape.id), { button: 0, clientX: 0, clientY: 0 });
    fireEvent.pointerMove(window, { clientX: 10, clientY: 0 });
    fireEvent(window, new Event("pointercancel"));
    expect(editor().past).toHaveLength(1);
    fireEvent.pointerMove(window, { clientX: 100, clientY: 0 });
    expect(byId(shape.id).x).toBe(120);
  });
});

describe("Canvas resizing", () => {
  it("resizes from a handle as one undo step", () => {
    const shape = createShapeElement("rectangle", { x: 100, y: 100, width: 200, height: 100 });
    setup(shape);
    click(box(shape.id));
    drag(handle("se"), [0, 0], [50, 10]);
    expect(byId(shape.id)).toMatchObject({ x: 100, y: 100, width: 300, height: 120 });
    expect(editor().past).toHaveLength(1);
    expect(editor().selectedElementIds).toEqual([shape.id]);
  });

  it("anchors the opposite corner when resizing from the top-left", () => {
    const shape = createShapeElement("rectangle", { x: 100, y: 100, width: 200, height: 100 });
    setup(shape);
    click(box(shape.id));
    drag(handle("nw"), [0, 0], [-10, -10]);
    expect(byId(shape.id)).toMatchObject({ x: 80, y: 80, width: 220, height: 120 });
  });

  it("keeps image aspect ratio while resizing", () => {
    const image = { ...createImageElement(PNG, 400, 200), x: 0, y: 0, width: 400, height: 200 };
    setup(image);
    click(box(image.id));
    expect(handles()).toHaveLength(4);
    drag(handle("se"), [0, 0], [100, 0]);
    expect(byId(image.id).width / byId(image.id).height).toBeCloseTo(2);
    expect(byId(image.id).width).toBe(600);
  });

  it("keeps aspect ratio for other elements while Shift is held", () => {
    const shape = createShapeElement("rectangle", { x: 0, y: 0, width: 200, height: 100 });
    setup(shape);
    click(box(shape.id));
    fireEvent.pointerDown(handle("se"), { button: 0, clientX: 0, clientY: 0 });
    fireEvent.pointerMove(window, { clientX: 100, clientY: 0, shiftKey: true });
    fireEvent.pointerUp(window);
    expect(byId(shape.id)).toMatchObject({ width: 400, height: 200 });
  });

  it("offers only horizontal handles for lines", () => {
    const line = createShapeElement("line");
    setup(line);
    click(box(line.id));
    expect([...handles()].map((h) => h.getAttribute("data-handle"))).toEqual(["w", "e"]);
  });

  it("ignores non-primary buttons on handles", () => {
    const shape = createShapeElement("rectangle", { x: 100, y: 100, width: 200, height: 100 });
    setup(shape);
    click(box(shape.id));
    fireEvent.pointerDown(handle("se"), { button: 2, clientX: 0, clientY: 0 });
    fireEvent.pointerMove(window, { clientX: 50, clientY: 50 });
    fireEvent.pointerUp(window);
    expect(byId(shape.id)).toMatchObject({ width: 200, height: 100 });
    expect(editor().selectedElementIds).toEqual([shape.id]);
  });

  it("shows a lock badge and no resize handles for a locked element", () => {
    const locked = createTextElement({ text: "Fixed", locked: true });
    setup(locked);
    click(box(locked.id));
    expect(screen.getByTestId("selection-box")).toBeInTheDocument();
    expect(screen.getByTestId("lock-badge")).toHaveAttribute("title", "Locked");
    expect(handles()).toHaveLength(0);
    act(() => editor().setElementsLocked(currentDeck().slides[0].id, [locked.id], false));
    expect(screen.queryByTestId("lock-badge")).not.toBeInTheDocument();
    expect(handles()).toHaveLength(8);
  });
});

describe("Canvas multi-selection", () => {
  const a = () => createShapeElement("rectangle", { x: 100, y: 100, width: 200, height: 100 });
  const b = () => createShapeElement("ellipse", { x: 300, y: 200, width: 100, height: 100 });

  it("outlines each element and shows shared bounds with corner handles", () => {
    const first = a();
    const second = b();
    setup(first, second);
    act(() => editor().selectElements([first.id, second.id]));
    expect(screen.queryByTestId("selection-box")).not.toBeInTheDocument();
    const outlines = screen.getAllByTestId("selection-outline");
    expect(outlines).toHaveLength(2);
    expect(outlines[0]).toHaveStyle({ left: "100px", top: "100px", width: "200px", height: "100px" });
    expect(screen.getByTestId("selection-bounds")).toHaveStyle({ left: "100px", top: "100px", width: "300px", height: "200px" });
    expect([...handles()].map((h) => h.getAttribute("data-handle"))).toEqual(CORNER_HANDLES);
    expect(screen.queryByTestId("lock-badge")).not.toBeInTheDocument();
  });

  it("hides the group handles and shows a lock badge when any element is locked", () => {
    const first = a();
    const second = { ...b(), locked: true };
    setup(first, second);
    act(() => editor().selectElements([first.id, second.id]));
    expect(screen.getByTestId("selection-bounds")).toBeInTheDocument();
    expect(handles()).toHaveLength(0);
    expect(screen.getAllByTestId("lock-badge")).toHaveLength(1);
  });

  it("scales every selected element with the shared bounds, as one undo step", () => {
    const first = a();
    const second = b();
    setup(first, second);
    act(() => editor().selectElements([first.id, second.id]));
    // Bounds 300×200 at (100, 100); dragging "se" by 300 slide px doubles it uniformly.
    drag(handle("se"), [0, 0], [150, 0]);
    expect(byId(first.id)).toMatchObject({ x: 100, y: 100, width: 400, height: 200 });
    expect(byId(second.id)).toMatchObject({ x: 500, y: 300, width: 200, height: 200 });
    expect(editor().past).toHaveLength(1);
    expect(selection()).toEqual(sorted(first.id, second.id));
    act(() => editor().undo());
    expect(byId(first.id)).toMatchObject({ x: 100, y: 100, width: 200, height: 100 });
    expect(byId(second.id)).toMatchObject({ x: 300, y: 200, width: 100, height: 100 });
  });

  it("shrinks the selection towards the opposite corner from the top-left handle", () => {
    const first = a();
    const second = b();
    setup(first, second);
    act(() => editor().selectElements([first.id, second.id]));
    // Shrinking to half: the bottom-right corner (400, 300) stays put.
    drag(handle("nw"), [0, 0], [75, 50]);
    expect(byId(first.id)).toMatchObject({ x: 250, y: 200, width: 100, height: 50 });
    expect(byId(second.id)).toMatchObject({ x: 350, y: 250, width: 50, height: 50 });
  });
});

describe("Canvas marquee", () => {
  const inside = () => createShapeElement("rectangle", { x: 50, y: 50, width: 100, height: 100 });
  const partly = () => createShapeElement("ellipse", { x: 350, y: 250, width: 100, height: 100 });

  it("selects the elements fully inside a box dragged from the background", () => {
    const a = inside();
    const b = partly();
    setup(a, b);
    act(() => editor().selectElement(b.id));
    fireEvent.pointerDown(stage(), { button: 0, clientX: 10, clientY: 10 });
    // A background press clears the selection right away.
    expect(editor().selectedElementIds).toEqual([]);
    fireEvent.pointerMove(window, { clientX: 210, clientY: 160 });
    expect(screen.getByTestId("marquee")).toHaveStyle({ left: "20px", top: "20px", width: "400px", height: "300px" });
    expect(editor().selectedElementIds).toEqual([a.id]);
    fireEvent.pointerMove(window, { clientX: 250, clientY: 200 });
    expect(selection()).toEqual(sorted(a.id, b.id));
    fireEvent.pointerUp(window);
    expect(screen.queryByTestId("marquee")).not.toBeInTheDocument();
    expect(selection()).toEqual(sorted(a.id, b.id));
    expect(editor().past).toHaveLength(0);
  });

  it("works when dragged up and to the left", () => {
    const a = inside();
    setup(a);
    fireEvent.pointerDown(stage(), { button: 0, clientX: 100, clientY: 100 });
    fireEvent.pointerMove(window, { clientX: 0, clientY: 0 });
    expect(screen.getByTestId("marquee")).toHaveStyle({ left: "0px", top: "0px", width: "200px", height: "200px" });
    expect(editor().selectedElementIds).toEqual([a.id]);
    fireEvent.pointerUp(window);
  });

  it("does not draw a marquee for a click on the background", () => {
    setup(inside());
    fireEvent.pointerDown(stage(), { button: 0, clientX: 10, clientY: 10 });
    fireEvent.pointerMove(window, { clientX: 11, clientY: 11 });
    expect(screen.queryByTestId("marquee")).not.toBeInTheDocument();
    fireEvent.pointerUp(window);
  });

  it("adds to the existing selection with Shift", () => {
    const a = inside();
    const b = partly();
    setup(a, b);
    act(() => editor().selectElement(b.id));
    fireEvent.pointerDown(stage(), { button: 0, clientX: 0, clientY: 0, shiftKey: true });
    expect(editor().selectedElementIds).toEqual([b.id]);
    fireEvent.pointerMove(window, { clientX: 100, clientY: 100 });
    fireEvent.pointerUp(window);
    expect(selection()).toEqual(sorted(a.id, b.id));
  });

  it("selects groups only when all members are inside", () => {
    const a = { ...inside(), groupId: "g" };
    const b = { ...partly(), groupId: "g" };
    setup(a, b);
    fireEvent.pointerDown(stage(), { button: 0, clientX: 0, clientY: 0 });
    fireEvent.pointerMove(window, { clientX: 100, clientY: 100 });
    expect(editor().selectedElementIds).toEqual([]);
    fireEvent.pointerMove(window, { clientX: 300, clientY: 300 });
    expect(selection()).toEqual(sorted(a.id, b.id));
    fireEvent.pointerUp(window);
  });

  it("does not start a marquee from a resize handle", () => {
    const a = createShapeElement("rectangle", { x: 100, y: 100, width: 200, height: 100 });
    setup(a);
    click(box(a.id));
    fireEvent.pointerDown(handle("e"), { button: 0, clientX: 0, clientY: 0 });
    fireEvent.pointerMove(window, { clientX: 10, clientY: 0 });
    fireEvent.pointerUp(window);
    expect(screen.queryByTestId("marquee")).not.toBeInTheDocument();
    expect(editor().selectedElementIds).toEqual([a.id]);
    expect(byId(a.id).width).toBe(220);
  });
});

describe("Canvas text editing", () => {
  it("edits text in place on double click, growing the box, and commits on Escape", async () => {
    const user = userEvent.setup();
    const text = createTextElement({ text: "Old", height: 40 });
    const { onEditElement } = setup(text);
    fireEvent.doubleClick(box(text.id));
    expect(onEditElement).not.toHaveBeenCalled();
    const textarea = screen.getByRole("textbox", { name: "Edit text" });
    expect(textarea).toHaveFocus();
    Object.defineProperty(textarea, "scrollHeight", { configurable: true, get: () => 90 });
    await user.type(textarea, " and new");
    expect(byId(text.id)).toMatchObject({ text: "Old and new", height: 90 });
    expect(handles()).toHaveLength(0);
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("textbox", { name: "Edit text" })).not.toBeInTheDocument();
    expect(editor().editingElementId).toBeNull();
    expect(editor().past).toHaveLength(1);
    expect(handles()).toHaveLength(8);
  });

  it("selects all text of a newly inserted text box", () => {
    const text = createTextElement({ text: "Text" });
    setup(text);
    act(() => editor().setEditing(text.id, true));
    const textarea = screen.getByRole("textbox", { name: "Edit text" }) as HTMLTextAreaElement;
    expect([textarea.selectionStart, textarea.selectionEnd]).toEqual([0, 4]);
  });

  it("places the caret at the end otherwise", () => {
    const text = createTextElement({ text: "Text" });
    setup(text);
    act(() => editor().setEditing(text.id));
    const textarea = screen.getByRole("textbox", { name: "Edit text" }) as HTMLTextAreaElement;
    expect([textarea.selectionStart, textarea.selectionEnd]).toEqual([4, 4]);
  });

  it("removes a text box that was emptied", async () => {
    const user = userEvent.setup();
    const text = createTextElement({ text: "Bye" });
    setup(text);
    fireEvent.doubleClick(box(text.id));
    await user.clear(screen.getByRole("textbox", { name: "Edit text" }));
    await user.keyboard("{Escape}");
    expect(elements()).toHaveLength(0);
  });

  it("keeps an emptied text box when it is locked", async () => {
    const user = userEvent.setup();
    const text = createTextElement({ text: "Bye", locked: true });
    setup(text);
    fireEvent.doubleClick(box(text.id));
    await user.clear(screen.getByRole("textbox", { name: "Edit text" }));
    await user.keyboard("{Escape}");
    expect(elements()).toHaveLength(1);
    expect(byId(text.id)).toMatchObject({ text: "", locked: true });
  });

  it("finishes text editing when another element is pressed", async () => {
    const user = userEvent.setup();
    const text = createTextElement({ text: "A" });
    const shape = createShapeElement("ellipse", { x: 0, y: 0 });
    setup(text, shape);
    fireEvent.doubleClick(box(text.id));
    await user.type(screen.getByRole("textbox", { name: "Edit text" }), "B");
    click(box(shape.id));
    expect(editor().editingElementId).toBeNull();
    expect(editor().selectedElementIds).toEqual([shape.id]);
    expect(byId(text.id)).toMatchObject({ text: "AB" });
  });

  it("finishes text editing on a background press", async () => {
    const user = userEvent.setup();
    const text = createTextElement({ text: "A" });
    setup(text);
    fireEvent.doubleClick(box(text.id));
    await user.type(screen.getByRole("textbox", { name: "Edit text" }), "C");
    fireEvent.pointerDown(stage(), { button: 0 });
    fireEvent.pointerUp(window);
    expect(editor().editingElementId).toBeNull();
    expect(byId(text.id)).toMatchObject({ text: "AC" });
  });

  it("does not start a move when pressing inside the text being edited", async () => {
    const text = createTextElement({ text: "A", x: 100, y: 100 });
    setup(text);
    fireEvent.doubleClick(box(text.id));
    const textarea = screen.getByRole("textbox", { name: "Edit text" });
    drag(textarea, [0, 0], [50, 50]);
    expect(byId(text.id)).toMatchObject({ x: 100, y: 100 });
    expect(editor().editingElementId).toBe(text.id);
    expect(screen.queryByTestId("marquee")).not.toBeInTheDocument();
  });
});

describe("Canvas double click", () => {
  it.each([
    ["chart", () => createChartElement("bar")],
    ["table", () => createTableElement()],
    ["image", () => createImageElement(PNG, 400, 200)],
  ])("opens the %s editor and selects the element", (_name, make) => {
    const el = make();
    const other = createShapeElement("rectangle", { x: 0, y: 0 });
    const { onEditElement } = setup(el, other);
    act(() => editor().selectElement(other.id));
    fireEvent.doubleClick(box(el.id));
    expect(onEditElement).toHaveBeenCalledTimes(1);
    expect(onEditElement).toHaveBeenCalledWith(el.id);
    expect(editor().selectedElementIds).toEqual([el.id]);
    expect(editor().editingElementId).toBeNull();
  });

  it("shows a hint instead of cropping a locked image", () => {
    const image = { ...createImageElement(PNG, 400, 200), locked: true };
    const { onEditElement } = setup(image);
    fireEvent.doubleClick(box(image.id));
    expect(onEditElement).not.toHaveBeenCalled();
    expect(toastMessages()).toEqual(["Unlock the image to crop it."]);
  });

  it("still opens the data editor of a locked chart or table", () => {
    const chart = createChartElement("line", { locked: true });
    const table = createTableElement({ locked: true, x: 0, y: 0 });
    const { onEditElement } = setup(chart, table);
    fireEvent.doubleClick(box(chart.id));
    fireEvent.doubleClick(box(table.id));
    expect(onEditElement.mock.calls).toEqual([[chart.id], [table.id]]);
  });

  it("does nothing for shapes", () => {
    const shape = createShapeElement("rectangle");
    const { onEditElement } = setup(shape);
    fireEvent.doubleClick(box(shape.id));
    expect(onEditElement).not.toHaveBeenCalled();
    expect(editor().editingElementId).toBeNull();
    expect(screen.queryByRole("textbox", { name: "Edit text" })).not.toBeInTheDocument();
  });
});

describe("Canvas AI feedback", () => {
  it("shows a pending outline and status while the AI is editing", () => {
    setup(createShapeElement("rectangle"));
    expect(screen.queryByTestId("ai-pending")).not.toBeInTheDocument();
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    act(() => useChatStore.setState({ pending: true }));
    expect(screen.getByTestId("ai-pending")).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("AI is editing…");
    act(() => useChatStore.setState({ pending: false }));
    expect(screen.queryByTestId("ai-pending")).not.toBeInTheDocument();
    expect(screen.queryByText("AI is editing…")).not.toBeInTheDocument();
  });

  it("highlights the elements the AI touched on this slide", () => {
    const a = createShapeElement("rectangle", { x: 10, y: 20, width: 100, height: 50 });
    const b = createShapeElement("ellipse", { x: 300, y: 300 });
    const { slideId } = setup(a, b);
    act(() => useEditorStore.setState({ aiHighlight: { slideIds: [slideId], elementIds: [a.id, "elsewhere"], token: "t1" } }));
    const highlights = screen.getAllByTestId("ai-highlight");
    expect(highlights).toHaveLength(1);
    expect(highlights[0]).toHaveStyle({ left: "10px", top: "20px", width: "100px", height: "50px" });
    act(() => editor().clearAiHighlight());
    expect(screen.queryByTestId("ai-highlight")).not.toBeInTheDocument();
  });

  it("flashes the whole slide when only the slide itself was touched", () => {
    const a = createShapeElement("rectangle", { x: 10, y: 20 });
    const { slideId } = setup(a);
    act(() => useEditorStore.setState({ aiHighlight: { slideIds: [slideId], elementIds: [], token: "t1" } }));
    const highlights = screen.getAllByTestId("ai-highlight");
    expect(highlights).toHaveLength(1);
    expect(highlights[0].style.left).not.toBe("10px");
    expect(highlights[0]).toHaveClass("ai-flash");
  });

  it("shows no highlight for changes on other slides", () => {
    setup(createShapeElement("rectangle"));
    act(() => useEditorStore.setState({ aiHighlight: { slideIds: ["other-slide"], elementIds: ["other-element"], token: "t1" } }));
    expect(screen.queryByTestId("ai-highlight")).not.toBeInTheDocument();
  });

  it("flashes the slide after a real AI edit of the slide background", () => {
    const { slideId } = setup(createTextElement({ text: "Hello" }));
    act(() => {
      editor().applyAiOperations([{ op: "set_slide_background", slideId, background: "#112233" }]);
    });
    expect(currentDeck().slides[0].background).toBe("#112233");
    expect(screen.getAllByTestId("ai-highlight")).toHaveLength(1);
  });
});
