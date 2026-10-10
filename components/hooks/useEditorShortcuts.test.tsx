import { describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { COALESCE_MS, LOCKED_MESSAGE } from "@/lib/store/editorStore";
import { readClipboard } from "@/lib/store/clipboardStore";
import { currentDeck, editor, seedDeck, slideWith, toastMessages } from "@/test/utils";
import { createShapeElement, createTextElement } from "@/lib/factory";
import { NUDGE_STEP, NUDGE_STEP_LARGE, useEditorShortcuts } from "./useEditorShortcuts";

function Harness({ enabled = true }: { enabled?: boolean }) {
  useEditorShortcuts(enabled);
  return (
    <div>
      <input aria-label="field" />
      <textarea aria-label="notes" />
      <div aria-label="rich" contentEditable suppressContentEditableWarning />
      <input type="checkbox" aria-label="toggle" />
      <button>Button</button>
      <button data-slide-thumb="thumb">
        <span>Thumb label</span>
      </button>
    </div>
  );
}

function setup(enabled = true) {
  const text = createTextElement({ x: 100, y: 100 });
  const shape = createShapeElement("rectangle", { x: 300, y: 300 });
  const ellipse = createShapeElement("ellipse", { x: 600, y: 300 });
  const deck = seedDeck([slideWith(text, shape, ellipse)]);
  const utils = render(<Harness enabled={enabled} />);
  return { ...utils, text, shape, ellipse, slideId: deck.slides[0].id };
}

/** Fires a keydown and returns whether the hook left the default action alone. */
function key(k: string, init: KeyboardEventInit = {}, target: Element = document.body): boolean {
  let notPrevented = true;
  act(() => {
    notPrevented = fireEvent.keyDown(target, { key: k, ...init });
  });
  return notPrevented;
}

const els = () => currentDeck().slides[0].elements;
const byId = (id: string) => els().find((e) => e.id === id)!;
const select = (...ids: string[]) => act(() => editor().selectElements(ids));

describe("useEditorShortcuts: history", () => {
  it("undoes and redoes with Ctrl/Cmd+Z, Shift+Z and Ctrl+Y", () => {
    setup();
    act(() => editor().setTitle("Changed"));
    expect(key("z", { ctrlKey: true })).toBe(false);
    expect(currentDeck().title).toBe("Test deck");
    key("Z", { metaKey: true, shiftKey: true });
    expect(currentDeck().title).toBe("Changed");
    key("z", { metaKey: true });
    expect(currentDeck().title).toBe("Test deck");
    expect(key("y", { ctrlKey: true })).toBe(false);
    expect(currentDeck().title).toBe("Changed");
  });

  it("undoes even when a slide thumbnail has focus", () => {
    setup();
    act(() => editor().setTitle("Changed"));
    key("z", { ctrlKey: true }, screen.getByText("Thumb label"));
    expect(currentDeck().title).toBe("Test deck");
  });

  it("leaves undo to the field while typing", () => {
    setup();
    act(() => editor().setTitle("Changed"));
    expect(key("z", { ctrlKey: true }, screen.getByLabelText("field"))).toBe(true);
    expect(currentDeck().title).toBe("Changed");
  });
});

describe("useEditorShortcuts: selection", () => {
  it("selects every element on the slide with Ctrl/Cmd+A", () => {
    const { text, shape, ellipse } = setup();
    expect(key("a", { metaKey: true })).toBe(false);
    expect(editor().selectedElementIds).toEqual([text.id, shape.id, ellipse.id]);
    act(() => editor().selectElement(null));
    key("A", { ctrlKey: true });
    expect(editor().selectedElementIds).toHaveLength(3);
  });

  it("deselects with Escape", () => {
    const { shape, ellipse } = setup();
    select(shape.id, ellipse.id);
    expect(key("Escape")).toBe(true);
    expect(editor().selectedElementIds).toEqual([]);
  });

  it("does not select all on an empty slide", () => {
    seedDeck([slideWith()]);
    render(<Harness />);
    key("a", { ctrlKey: true });
    expect(editor().selectedElementIds).toEqual([]);
  });
});

describe("useEditorShortcuts: group, duplicate, delete", () => {
  it("groups with Cmd+G and ungroups with Shift+Cmd+G", () => {
    const { shape, ellipse, text } = setup();
    select(shape.id, ellipse.id);
    expect(key("g", { metaKey: true })).toBe(false);
    const groupId = byId(shape.id).groupId;
    expect(groupId).toBeTruthy();
    expect(byId(ellipse.id).groupId).toBe(groupId);
    expect(byId(text.id).groupId).toBeUndefined();
    expect(editor().past).toHaveLength(1);
    key("G", { ctrlKey: true, shiftKey: true });
    expect(byId(shape.id).groupId).toBeUndefined();
    expect(byId(ellipse.id).groupId).toBeUndefined();
    expect(editor().past).toHaveLength(2);
  });

  it("does not group a single element", () => {
    const { shape } = setup();
    select(shape.id);
    key("g", { metaKey: true });
    expect(byId(shape.id).groupId).toBeUndefined();
    expect(editor().past).toHaveLength(0);
  });

  it("duplicates the whole selection with Cmd+D and selects the copies", () => {
    const { shape, ellipse } = setup();
    select(shape.id, ellipse.id);
    expect(key("d", { metaKey: true })).toBe(false);
    expect(els()).toHaveLength(5);
    const copies = els().slice(3);
    expect(copies.map((e) => e.type)).toEqual(["shape", "shape"]);
    expect(editor().selectedElementIds).toEqual(copies.map((e) => e.id));
    // Copies keep their arrangement relative to each other.
    expect(copies[1].x - copies[0].x).toBe(ellipse.x - shape.x);
  });

  it.each(["Delete", "Backspace"])("deletes the selection with %s", (k) => {
    const { text, shape, ellipse } = setup();
    select(shape.id, ellipse.id);
    expect(key(k)).toBe(false);
    expect(els().map((e) => e.id)).toEqual([text.id]);
    expect(editor().selectedElementIds).toEqual([]);
  });

  it("keeps locked elements when deleting and explains why", () => {
    const { text, shape, ellipse, slideId } = setup();
    act(() => editor().setElementsLocked(slideId, [shape.id], true));
    select(shape.id, ellipse.id);
    key("Delete");
    expect(els().map((e) => e.id)).toEqual([text.id, shape.id]);
    expect(editor().selectedElementIds).toEqual([shape.id]);
    expect(toastMessages()).toEqual([LOCKED_MESSAGE]);
  });

  it("does nothing without a selection", () => {
    setup();
    key("Delete");
    key("d", { metaKey: true });
    key("g", { metaKey: true });
    key("ArrowRight");
    expect(els()).toHaveLength(3);
    expect(editor().past).toHaveLength(0);
  });
});

describe("useEditorShortcuts: text editing", () => {
  it("starts editing a single selected text element with Enter", () => {
    const { text } = setup();
    select(text.id);
    expect(key("Enter")).toBe(false);
    expect(editor().editingElementId).toBe(text.id);
  });

  it("only enters text editing for one text element and not on buttons", () => {
    const { text, shape } = setup();
    select(shape.id);
    expect(key("Enter")).toBe(true);
    expect(editor().editingElementId).toBeNull();
    select(text.id, shape.id);
    key("Enter");
    expect(editor().editingElementId).toBeNull();
    select(text.id);
    key("Enter", {}, screen.getByRole("button", { name: "Button" }));
    expect(editor().editingElementId).toBeNull();
  });
});

describe("useEditorShortcuts: nudging", () => {
  it("uses 1px steps and 10px with Shift", () => {
    expect(NUDGE_STEP).toBe(1);
    expect(NUDGE_STEP_LARGE).toBe(10);
  });

  it("nudges the whole selection with arrows as one undo step", () => {
    const { shape, ellipse, text } = setup();
    select(shape.id, ellipse.id);
    expect(key("ArrowRight")).toBe(false);
    key("ArrowDown", { shiftKey: true });
    key("ArrowLeft");
    key("ArrowUp");
    key("ArrowRight", { shiftKey: true });
    // Right + Left cancel out, Shift+Right adds the large step; Shift+Down minus Up.
    const dx = NUDGE_STEP_LARGE;
    const dy = NUDGE_STEP_LARGE - NUDGE_STEP;
    expect(byId(shape.id)).toMatchObject({ x: 300 + dx, y: 300 + dy });
    expect(byId(ellipse.id)).toMatchObject({ x: 600 + dx, y: 300 + dy });
    expect(byId(text.id)).toMatchObject({ x: 100, y: 100 });
    expect(editor().past).toHaveLength(1);
    act(() => editor().undo());
    expect(byId(shape.id)).toMatchObject({ x: 300, y: 300 });
    expect(byId(ellipse.id)).toMatchObject({ x: 600, y: 300 });
  });

  it("starts a new undo step after a pause in nudging", () => {
    vi.useFakeTimers();
    try {
      const { shape } = setup();
      select(shape.id);
      key("ArrowRight");
      vi.advanceTimersByTime(COALESCE_MS + 1);
      key("ArrowRight");
      expect(byId(shape.id).x).toBe(302);
      expect(editor().past).toHaveLength(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it("refuses to nudge a selection that contains a locked element", () => {
    const { shape, ellipse, slideId } = setup();
    act(() => editor().setElementsLocked(slideId, [ellipse.id], true));
    select(shape.id, ellipse.id);
    key("ArrowLeft", { shiftKey: true });
    expect(byId(shape.id)).toMatchObject({ x: 300, y: 300 });
    expect(byId(ellipse.id)).toMatchObject({ x: 600, y: 300 });
    expect(toastMessages()).toEqual([LOCKED_MESSAGE]);
  });

  it("ignores arrows combined with Ctrl/Cmd or Alt", () => {
    const { shape } = setup();
    select(shape.id);
    expect(key("ArrowRight", { altKey: true })).toBe(true);
    expect(key("ArrowRight", { ctrlKey: true })).toBe(true);
    expect(key("ArrowRight", { metaKey: true })).toBe(true);
    expect(byId(shape.id).x).toBe(300);
  });
});

describe("useEditorShortcuts: where keys are ignored", () => {
  it.each(["field", "notes", "rich"])("ignores keys typed into %s", (label) => {
    const { shape } = setup();
    select(shape.id);
    const target = screen.getByLabelText(label);
    // jsdom doesn't implement isContentEditable.
    if (label === "rich") Object.defineProperty(target, "isContentEditable", { configurable: true, value: true });
    expect(key("Delete", {}, target)).toBe(true);
    key("ArrowRight", {}, target);
    key("a", { ctrlKey: true }, target);
    key("d", { metaKey: true }, target);
    expect(els()).toHaveLength(3);
    expect(byId(shape.id).x).toBe(300);
    expect(editor().selectedElementIds).toEqual([shape.id]);
  });

  it("still handles keys on non-text inputs such as checkboxes", () => {
    const { shape } = setup();
    select(shape.id);
    key("ArrowRight", {}, screen.getByLabelText("toggle"));
    expect(byId(shape.id).x).toBe(301);
  });

  it("leaves slide thumbnails their own keys", () => {
    const { shape } = setup();
    select(shape.id);
    const thumb = screen.getByText("Thumb label");
    expect(key("Delete", {}, thumb)).toBe(true);
    expect(key("ArrowDown", {}, thumb)).toBe(true);
    expect(key("a", { ctrlKey: true }, thumb)).toBe(true);
    key("d", { metaKey: true }, thumb);
    key("Escape", {}, thumb);
    expect(els()).toHaveLength(3);
    expect(byId(shape.id).y).toBe(300);
    expect(editor().selectedElementIds).toEqual([shape.id]);
  });

  it("ignores events another handler already prevented", () => {
    const { shape } = setup();
    select(shape.id);
    const event = new KeyboardEvent("keydown", { key: "Delete", bubbles: true, cancelable: true });
    event.preventDefault();
    act(() => void document.body.dispatchEvent(event));
    expect(els()).toHaveLength(3);
  });

  it("does not handle copy, cut or paste (useClipboard does)", () => {
    const { shape } = setup();
    select(shape.id);
    expect(key("c", { ctrlKey: true })).toBe(true);
    expect(key("x", { metaKey: true })).toBe(true);
    expect(key("v", { ctrlKey: true })).toBe(true);
    expect(els()).toHaveLength(3);
    expect(readClipboard()).toBeNull();
  });

  it("does nothing without a slide", () => {
    seedDeck([]);
    render(<Harness />);
    key("a", { ctrlKey: true });
    key("Delete");
    key("z", { ctrlKey: true });
    expect(editor().selectedElementIds).toEqual([]);
    expect(currentDeck().slides).toHaveLength(0);
  });

  it("does nothing while disabled and stops listening when disabled later", () => {
    const { shape, rerender } = setup(false);
    select(shape.id);
    expect(key("Delete")).toBe(true);
    expect(els()).toHaveLength(3);
    rerender(<Harness enabled />);
    key("ArrowRight");
    expect(byId(shape.id).x).toBe(301);
    rerender(<Harness enabled={false} />);
    key("ArrowRight");
    expect(byId(shape.id).x).toBe(301);
  });

  it("stops listening after unmount", () => {
    const { shape, unmount } = setup();
    select(shape.id);
    unmount();
    key("Delete");
    expect(els()).toHaveLength(3);
  });
});
