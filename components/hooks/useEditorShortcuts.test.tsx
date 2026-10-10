import { describe, expect, it, vi } from "vitest";
import { act, fireEvent, render } from "@testing-library/react";
import { COALESCE_MS } from "@/lib/store/editorStore";
import { currentDeck, editor, seedDeck, slideWith } from "@/test/utils";
import { createShapeElement, createTextElement } from "@/lib/factory";
import { useEditorShortcuts } from "./useEditorShortcuts";

function Harness({ enabled = true }: { enabled?: boolean }) {
  useEditorShortcuts(enabled);
  return (
    <div>
      <input aria-label="field" />
      <button>Button</button>
    </div>
  );
}

function setup(enabled = true) {
  const text = createTextElement({ x: 100, y: 100 });
  const shape = createShapeElement("rectangle", { x: 300, y: 300 });
  const deck = seedDeck([slideWith(text, shape)]);
  const utils = render(<Harness enabled={enabled} />);
  return { ...utils, text, shape, slideId: deck.slides[0].id };
}

const key = (k: string, init: KeyboardEventInit = {}, target: Element = document.body) => act(() => void fireEvent.keyDown(target, { key: k, ...init }));
const els = () => currentDeck().slides[0].elements;

describe("useEditorShortcuts", () => {
  it("undoes and redoes with Ctrl/Cmd+Z, Shift+Z and Ctrl+Y", () => {
    setup();
    act(() => editor().setTitle("Changed"));
    key("z", { ctrlKey: true });
    expect(currentDeck().title).toBe("Test deck");
    key("Z", { metaKey: true, shiftKey: true });
    expect(currentDeck().title).toBe("Changed");
    key("z", { metaKey: true });
    key("y", { ctrlKey: true });
    expect(currentDeck().title).toBe("Changed");
  });

  it("nudges the selected element with arrows (Shift = 10px) as one undo step", () => {
    const { shape } = setup();
    act(() => editor().selectElement(shape.id));
    key("ArrowRight");
    key("ArrowDown", { shiftKey: true });
    key("ArrowLeft");
    key("ArrowUp");
    expect(els()[1]).toMatchObject({ x: 300, y: 309 });
    expect(editor().past).toHaveLength(1);
  });

  it("starts a new undo step after a pause in nudging", () => {
    vi.useFakeTimers();
    const { shape } = setup();
    act(() => editor().selectElement(shape.id));
    key("ArrowRight");
    vi.advanceTimersByTime(COALESCE_MS + 1);
    key("ArrowRight");
    expect(editor().past).toHaveLength(2);
    vi.useRealTimers();
  });

  it("deletes, duplicates, deselects and edits", () => {
    const { text, shape } = setup();
    act(() => editor().selectElement(shape.id));
    key("d", { metaKey: true });
    expect(els()).toHaveLength(3);
    key("Delete");
    expect(els()).toHaveLength(2);
    act(() => editor().selectElement(shape.id));
    key("Backspace");
    expect(els()).toHaveLength(1);
    act(() => editor().selectElement(text.id));
    key("Enter");
    expect(editor().editingElementId).toBe(text.id);
    act(() => editor().setEditing(null));
    key("Escape");
    expect(editor().selectedElementId).toBeNull();
  });

  it("only enters text editing with Enter for text elements and not on buttons", () => {
    const { text, shape, getByRole } = setup();
    act(() => editor().selectElement(shape.id));
    key("Enter");
    expect(editor().editingElementId).toBeNull();
    act(() => editor().selectElement(text.id));
    key("Enter", {}, getByRole("button", { name: "Button" }));
    expect(editor().editingElementId).toBeNull();
  });

  it("copies and pastes elements but leaves native copy alone when text is selected", () => {
    const { shape } = setup();
    act(() => editor().selectElement(shape.id));
    key("c", { ctrlKey: true });
    key("v", { ctrlKey: true });
    expect(els()).toHaveLength(3);
    const selection = { isCollapsed: false, toString: () => "chat text" } as unknown as Selection;
    const spy = vi.spyOn(window, "getSelection").mockReturnValue(selection);
    key("v", { ctrlKey: true });
    expect(els()).toHaveLength(3);
    spy.mockRestore();
  });

  it("ignores keys typed into fields, prevented events and modifier combos", () => {
    const { shape, getByLabelText } = setup();
    act(() => editor().selectElement(shape.id));
    key("Delete", {}, getByLabelText("field"));
    key("ArrowRight", { altKey: true });
    key("x", { ctrlKey: true });
    const event = new KeyboardEvent("keydown", { key: "Delete", bubbles: true, cancelable: true });
    event.preventDefault();
    act(() => void document.body.dispatchEvent(event));
    expect(els()).toHaveLength(2);
    expect(els()[1].x).toBe(300);
  });

  it("does nothing without a selection or when disabled", () => {
    seedDeck([]);
    const { unmount } = render(<Harness />);
    key("Delete");
    key("v", { ctrlKey: true });
    unmount();
    const { shape } = setup(false);
    act(() => editor().selectElement(shape.id));
    key("Delete");
    expect(els()).toHaveLength(2);
  });
});
