import { afterEach, describe, expect, it, vi } from "vitest";
import { currentDeck, editor, seedDeck, slideWith, toastMessages } from "@/test/utils";
import { HISTORY_LIMIT, MAX_ELEMENTS_PER_SLIDE, MAX_SLIDES, MAX_TITLE_LENGTH } from "../constants";
import { createChartElement, createShapeElement, createSlide, createTextElement } from "../factory";
import { getTemplates } from "../templates";
import { COALESCE_MS, reconcileSelection, selectCurrentElement, selectCurrentSlide, useEditorStore } from "./editorStore";

afterEach(() => vi.useRealTimers());

describe("loading", () => {
  it("loads a deck, selects the first slide and clears history", () => {
    const deck = seedDeck([createSlide(), createSlide()]);
    const s = editor();
    expect(s.hydrated).toBe(true);
    expect(s.selectedSlideId).toBe(deck.slides[0].id);
    expect(s.past).toEqual([]);
    expect(s.future).toEqual([]);
  });

  it("selects nothing for an empty deck", () => {
    seedDeck([]);
    expect(editor().selectedSlideId).toBeNull();
  });
});

describe("slides", () => {
  it("adds a slide after the current one, using its background, and selects it", () => {
    seedDeck([createSlide("#112233"), createSlide()]);
    const id = editor().addSlide();
    const slides = currentDeck().slides;
    expect(slides[1].id).toBe(id);
    expect(slides[1].background).toBe("#112233");
    expect(editor().selectedSlideId).toBe(id);
  });

  it("adds the first slide to an empty deck", () => {
    seedDeck([]);
    const id = editor().addSlide();
    expect(currentDeck().slides.map((s) => s.id)).toEqual([id]);
  });

  it("enforces the slide limit", () => {
    seedDeck(Array.from({ length: MAX_SLIDES }, () => createSlide()));
    expect(editor().addSlide()).toBeNull();
    expect(editor().duplicateSlide(currentDeck().slides[0].id)).toBeNull();
    expect(currentDeck().slides).toHaveLength(MAX_SLIDES);
    expect(toastMessages()[0]).toMatch(/at most/);
  });

  it("duplicates a slide with new ids right after the original", () => {
    const deck = seedDeck([slideWith(createTextElement()), createSlide()]);
    const copyId = editor().duplicateSlide(deck.slides[0].id);
    const slides = currentDeck().slides;
    expect(slides[1].id).toBe(copyId);
    expect(slides[1].elements[0].id).not.toBe(slides[0].elements[0].id);
    expect(editor().duplicateSlide("missing")).toBeNull();
  });

  it("deletes a slide and selects its neighbour", () => {
    const deck = seedDeck([createSlide(), createSlide(), createSlide()]);
    editor().selectSlide(deck.slides[2].id);
    editor().deleteSlide(deck.slides[2].id);
    expect(editor().selectedSlideId).toBe(deck.slides[1].id);
    editor().deleteSlide(deck.slides[0].id);
    expect(editor().selectedSlideId).toBe(deck.slides[1].id);
    editor().deleteSlide(deck.slides[1].id);
    expect(editor().selectedSlideId).toBeNull();
    expect(currentDeck().slides).toEqual([]);
    editor().deleteSlide("missing");
  });

  it("moves slides and clamps the target index", () => {
    const deck = seedDeck([createSlide(), createSlide(), createSlide()]);
    editor().moveSlide(deck.slides[0].id, 2);
    expect(currentDeck().slides.map((s) => s.id)).toEqual([deck.slides[1].id, deck.slides[2].id, deck.slides[0].id]);
    editor().moveSlide(deck.slides[0].id, -10);
    expect(currentDeck().slides[0].id).toBe(deck.slides[0].id);
    const pastLength = editor().past.length;
    editor().moveSlide(deck.slides[0].id, 0);
    editor().moveSlide("missing", 1);
    expect(editor().past).toHaveLength(pastLength);
  });

  it("ignores selecting unknown slides", () => {
    const deck = seedDeck();
    editor().selectSlide("missing");
    expect(editor().selectedSlideId).toBe(deck.slides[0].id);
    editor().selectSlide(null);
    expect(editor().selectedSlideId).toBeNull();
  });

  it("sets valid backgrounds only", () => {
    const deck = seedDeck();
    editor().setSlideBackground(deck.slides[0].id, "#ABC");
    expect(currentDeck().slides[0].background).toBe("#aabbcc");
    editor().setSlideBackground(deck.slides[0].id, "blue");
    expect(currentDeck().slides[0].background).toBe("#aabbcc");
  });

  it("limits the title length", () => {
    seedDeck();
    editor().setTitle("x".repeat(MAX_TITLE_LENGTH + 20));
    expect(currentDeck().title).toHaveLength(MAX_TITLE_LENGTH);
  });
});

describe("elements", () => {
  it("adds an element, cascading its position and selecting it", () => {
    const deck = seedDeck();
    const a = createTextElement();
    const b = { ...createTextElement(), x: a.x, y: a.y };
    expect(editor().addElement(deck.slides[0].id, a)).toBe(true);
    expect(editor().addElement(deck.slides[0].id, b)).toBe(true);
    const els = currentDeck().slides[0].elements;
    expect(els[1].x).toBe(a.x + 20);
    expect(editor().selectedElementId).toBe(b.id);
    expect(editor().addElement("missing", createTextElement())).toBe(false);
  });

  it("enforces the per-slide element limit", () => {
    const deck = seedDeck([slideWith(...Array.from({ length: MAX_ELEMENTS_PER_SLIDE }, () => createShapeElement("rectangle")))]);
    expect(editor().addElement(deck.slides[0].id, createTextElement())).toBe(false);
    expect(toastMessages()[0]).toMatch(/at most/);
  });

  it("updates an element and records history only for real changes", () => {
    const el = createTextElement();
    const deck = seedDeck([slideWith(el)]);
    editor().updateElement(deck.slides[0].id, el.id, { text: "Hello" });
    expect(currentDeck().slides[0].elements[0]).toMatchObject({ text: "Hello" });
    expect(editor().past).toHaveLength(1);
    editor().updateElement(deck.slides[0].id, el.id, { text: "Hello" });
    editor().updateElement(deck.slides[0].id, "missing", { text: "x" });
    editor().updateElement("missing", el.id, { text: "x" });
    expect(editor().past).toHaveLength(1);
  });

  it("deletes elements and clears their selection", () => {
    const el = createTextElement();
    const deck = seedDeck([slideWith(el)]);
    editor().setEditing(el.id);
    editor().deleteElement(deck.slides[0].id, el.id);
    expect(currentDeck().slides[0].elements).toEqual([]);
    expect(editor().selectedElementId).toBeNull();
    expect(editor().editingElementId).toBeNull();
  });

  it("duplicates elements", () => {
    const el = createTextElement();
    const deck = seedDeck([slideWith(el)]);
    editor().duplicateElement(deck.slides[0].id, el.id);
    const els = currentDeck().slides[0].elements;
    expect(els).toHaveLength(2);
    expect(els[1].id).not.toBe(el.id);
    expect(editor().selectedElementId).toBe(els[1].id);
    editor().duplicateElement(deck.slides[0].id, "missing");
    expect(currentDeck().slides[0].elements).toHaveLength(2);
  });

  it("reorders layers", () => {
    const [a, b, c] = [createTextElement(), createTextElement(), createTextElement()];
    const deck = seedDeck([slideWith(a, b, c)]);
    const sid = deck.slides[0].id;
    const order = () => currentDeck().slides[0].elements.map((e) => e.id);
    editor().reorderElement(sid, a.id, "front");
    expect(order()).toEqual([b.id, c.id, a.id]);
    editor().reorderElement(sid, a.id, "back");
    expect(order()).toEqual([a.id, b.id, c.id]);
    editor().reorderElement(sid, a.id, "forward");
    expect(order()).toEqual([b.id, a.id, c.id]);
    editor().reorderElement(sid, a.id, "backward");
    expect(order()).toEqual([a.id, b.id, c.id]);
    const past = editor().past.length;
    editor().reorderElement(sid, a.id, "backward");
    editor().reorderElement(sid, "missing", "front");
    expect(editor().past).toHaveLength(past);
  });

  it("copies and pastes elements onto the selected slide", () => {
    const el = createChartElement("bar");
    const deck = seedDeck([slideWith(el), createSlide()]);
    expect(editor().pasteElement()).toBe(false);
    editor().copyElement(deck.slides[0].id, el.id);
    editor().selectSlide(deck.slides[1].id);
    expect(editor().pasteElement()).toBe(true);
    const pasted = currentDeck().slides[1].elements[0];
    expect(pasted.id).not.toBe(el.id);
    expect(pasted.type).toBe("chart");
    editor().selectSlide(null);
    expect(editor().pasteElement()).toBe(false);
  });

  it("tracks selection and editing state", () => {
    const el = createTextElement();
    seedDeck([slideWith(el)]);
    editor().setEditing(el.id, true);
    expect(editor()).toMatchObject({ editingElementId: el.id, selectedElementId: el.id, editingSelectAll: true });
    editor().selectElement(el.id);
    expect(editor().editingElementId).toBe(el.id);
    editor().selectElement(null);
    expect(editor().editingElementId).toBeNull();
    editor().setEditing(el.id);
    editor().setEditing(null);
    expect(editor()).toMatchObject({ editingElementId: null, editingSelectAll: false, selectedElementId: el.id });
    editor().selectElement(null);
    expect(selectCurrentElement(editor())).toBeNull();
    editor().selectElement(el.id);
    expect(selectCurrentElement(editor())?.id).toBe(el.id);
    expect(selectCurrentSlide(editor())?.elements).toHaveLength(1);
  });
});

describe("history", () => {
  it("undoes and redoes changes", () => {
    const deck = seedDeck();
    editor().setTitle("One");
    vi.useFakeTimers();
    vi.advanceTimersByTime(COALESCE_MS + 1);
    editor().addSlide();
    expect(currentDeck().slides).toHaveLength(2);
    editor().undo();
    expect(currentDeck().slides).toHaveLength(1);
    expect(currentDeck().title).toBe("One");
    editor().undo();
    expect(currentDeck().title).toBe(deck.title);
    editor().undo();
    editor().redo();
    editor().redo();
    expect(currentDeck().slides).toHaveLength(2);
    editor().redo();
    expect(editor().future).toEqual([]);
  });

  it("clears the redo stack on a new change", () => {
    seedDeck();
    editor().addSlide();
    editor().undo();
    expect(editor().future).toHaveLength(1);
    editor().addSlide();
    expect(editor().future).toEqual([]);
  });

  it("coalesces rapid changes with the same key into one step", () => {
    vi.useFakeTimers();
    const deck = seedDeck();
    const id = deck.slides[0].id;
    editor().setSlideBackground(id, "#111111");
    editor().setSlideBackground(id, "#222222");
    editor().setSlideBackground(id, "#333333");
    expect(editor().past).toHaveLength(1);
    vi.advanceTimersByTime(COALESCE_MS + 1);
    editor().setSlideBackground(id, "#444444");
    expect(editor().past).toHaveLength(2);
    editor().undo();
    expect(currentDeck().slides[0].background).toBe("#333333");
    editor().undo();
    expect(currentDeck().slides[0].background).toBe("#ffffff");
  });

  it("records a whole gesture (drag) as a single step", () => {
    const el = createShapeElement("rectangle");
    const deck = seedDeck([slideWith(el)]);
    const sid = deck.slides[0].id;
    editor().beginGesture();
    editor().beginGesture();
    for (let i = 1; i <= 5; i += 1) editor().updateElementLive(sid, el.id, { x: el.x + i * 10 });
    expect(editor().past).toHaveLength(0);
    editor().endGesture();
    expect(editor().past).toHaveLength(1);
    expect(currentDeck().slides[0].elements[0].x).toBe(el.x + 50);
    editor().undo();
    expect(currentDeck().slides[0].elements[0].x).toBe(el.x);
  });

  it("records nothing for a gesture without changes", () => {
    const el = createShapeElement("rectangle");
    const deck = seedDeck([slideWith(el)]);
    editor().beginGesture();
    editor().updateElementLive(deck.slides[0].id, el.id, { x: el.x });
    editor().updateElementLive(deck.slides[0].id, "missing", { x: 1 });
    editor().endGesture();
    editor().endGesture();
    expect(editor().past).toHaveLength(0);
  });

  it("starts a gesture implicitly on live updates and finishes it before undo", () => {
    const el = createShapeElement("rectangle");
    const deck = seedDeck([slideWith(el)]);
    editor().updateElementLive(deck.slides[0].id, el.id, { x: 300 });
    expect(editor().gestureBase).not.toBeNull();
    editor().undo();
    expect(currentDeck().slides[0].elements[0].x).toBe(el.x);
    expect(editor().gestureBase).toBeNull();
  });

  it("keeps tracking a gesture after a commit happens in the middle of it", () => {
    const el = createShapeElement("rectangle");
    const deck = seedDeck([slideWith(el)]);
    const sid = deck.slides[0].id;
    editor().beginGesture();
    editor().updateElementLive(sid, el.id, { x: 200 });
    editor().setTitle("During gesture");
    editor().updateElementLive(sid, el.id, { x: 300 });
    editor().endGesture();
    expect(editor().past).toHaveLength(2);
    editor().undo();
    expect(currentDeck().slides[0].elements[0].x).toBe(200);
    editor().undo();
    expect(currentDeck().slides[0].elements[0].x).toBe(el.x);
  });

  it("caps the history length", () => {
    const deck = seedDeck();
    for (let i = 0; i < HISTORY_LIMIT + 10; i += 1) editor().setSlideBackground(deck.slides[0].id, i % 2 ? "#000000" : "#ffffff");
    // Coalescing merges these, so use distinct keys instead.
    for (let i = 0; i < HISTORY_LIMIT + 10; i += 1) editor().addSlide();
    expect(editor().past.length).toBeLessThanOrEqual(HISTORY_LIMIT);
  });

  it("keeps the selection valid after undo removes the selected slide", () => {
    seedDeck();
    const added = editor().addSlide();
    expect(editor().selectedSlideId).toBe(added);
    editor().undo();
    expect(currentDeck().slides.some((s) => s.id === editor().selectedSlideId)).toBe(true);
  });
});

describe("templates and AI", () => {
  it("replaces the deck with a template copy, sets the title and is undoable", () => {
    seedDeck([slideWith(createTextElement())], "Mine");
    const template = getTemplates()[0];
    editor().applyTemplate(template);
    expect(currentDeck().title).toBe(template.name);
    expect(currentDeck().slides).toHaveLength(template.slides.length);
    expect(currentDeck().slides[0].id).not.toBe(template.slides[0].id);
    expect(editor().selectedSlideId).toBe(currentDeck().slides[0].id);
    editor().undo();
    expect(currentDeck().title).toBe("Mine");
  });

  it("applies AI operations as one undoable step and focuses the changed slide", () => {
    seedDeck([createSlide()]);
    const report = editor().applyAiOperations([
      { op: "set_title", title: "AI deck" },
      { op: "add_slide", position: null, background: "#000000", elements: [] },
    ]);
    expect(report.applied).toBe(2);
    expect(currentDeck().slides).toHaveLength(2);
    expect(editor().selectedSlideId).toBe(currentDeck().slides[1].id);
    expect(editor().past).toHaveLength(1);
    editor().undo();
    expect(currentDeck().slides).toHaveLength(1);
  });

  it("does not record history when no AI operation applies", () => {
    seedDeck();
    const report = editor().applyAiOperations([{ op: "delete_slide", slideId: "S9" }]);
    expect(report.applied).toBe(0);
    expect(editor().past).toHaveLength(0);
  });
});

describe("reconcileSelection", () => {
  it("falls back to the slide at the previous index", () => {
    const a = createSlide();
    const b = createSlide();
    const c = createSlide();
    const before = { version: 1 as const, id: "d", title: "", updatedAt: 0, slides: [a, b, c] };
    const after = { ...before, slides: [a, c] };
    expect(reconcileSelection(after, b.id, "el", before)).toEqual({ selectedSlideId: c.id, selectedElementId: null });
    expect(reconcileSelection({ ...before, slides: [] }, b.id, null, before).selectedSlideId).toBeNull();
  });
});

describe("misc", () => {
  it("tracks save status and hydration", () => {
    editor().setSaveStatus("saving");
    editor().setHydrated();
    expect(useEditorStore.getState()).toMatchObject({ saveStatus: "saving", hydrated: true });
  });
});
