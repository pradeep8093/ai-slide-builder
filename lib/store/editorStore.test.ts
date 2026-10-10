import { afterEach, describe, expect, it, vi } from "vitest";
import { currentDeck, editor, seedDeck, slideWith, toastMessages } from "@/test/utils";
import type { AiElementChanges } from "../ai/schema";
import { HISTORY_LIMIT, MAX_ELEMENTS_PER_SLIDE, MAX_NOTES_LENGTH, MAX_SLIDES, MAX_TITLE_LENGTH } from "../constants";
import { createChartElement, createImageElement, createShapeElement, createSlide, createTextElement } from "../factory";
import type { Deck, ImageElement, Slide } from "../schema";
import { getTemplates } from "../templates";
import {
  COALESCE_MS,
  expandToGroups,
  LOCKED_MESSAGE,
  reconcileSelection,
  selectCurrentElement,
  selectCurrentSlide,
  selectSelectedElements,
  useEditorStore,
} from "./editorStore";

const PNG = "data:image/png;base64,iVBORw0KGgo=";

const NO_CHANGES: AiElementChanges = {
  x: null, y: null, width: null, height: null, text: null, fontSize: null, fontFamily: null, color: null, bold: null, italic: null,
  underline: null, align: null, shape: null, fill: null, stroke: null, strokeWidth: null, chartType: null, title: null, categories: null,
  series: null, showLegend: null, stacked: null, showValues: null, dualAxis: null, rows: null, headerRow: null, headerFill: null,
  borderColor: null, alt: null,
};

afterEach(() => vi.useRealTimers());

function elements(slideIndex = 0) {
  return currentDeck().slides[slideIndex].elements;
}

function ids(list: { id: string }[]) {
  return list.map((e) => e.id);
}

function rect(x: number, y: number) {
  return createShapeElement("rectangle", { x, y, width: 100, height: 100 });
}

/** Three rectangles; a and b form group "g". */
function groupedSlide() {
  const a = { ...rect(0, 0), groupId: "g" };
  const b = { ...rect(200, 0), groupId: "g" };
  const c = rect(400, 0);
  const deck = seedDeck([slideWith(a, b, c)]);
  return { a, b, c, sid: deck.slides[0].id };
}

describe("loading", () => {
  it("loads a deck, selects the first slide and resets editor state but keeps the save status", () => {
    editor().setSaveStatus("saving");
    useEditorStore.setState({ past: [currentDeck()], selectedElementIds: ["x"], aiHighlight: { slideIds: [], elementIds: [], token: "t" } });
    const deck = seedDeck([createSlide(), createSlide()]);
    const s = editor();
    expect(s.deck).toBe(deck);
    expect(s.hydrated).toBe(true);
    expect(s.saveStatus).toBe("saving");
    expect(s.selectedSlideId).toBe(deck.slides[0].id);
    expect(s.selectedElementIds).toEqual([]);
    expect(s.aiHighlight).toBeNull();
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
    useEditorStore.setState({ selectedElementIds: ["x"] });
    const id = editor().addSlide();
    const slides = currentDeck().slides;
    expect(slides[1].id).toBe(id);
    expect(slides[1].background).toBe("#112233");
    expect(slides[1].notes).toBe("");
    expect(editor().selectedSlideId).toBe(id);
    expect(editor().selectedElementIds).toEqual([]);
  });

  it("adds a slide at any position, clamping the index", () => {
    const deck = seedDeck([createSlide("#111111"), createSlide("#222222")]);
    editor().selectSlide(deck.slides[1].id);
    const first = editor().addSlide(0);
    expect(currentDeck().slides[0].id).toBe(first);
    // Nothing precedes index 0, so it takes the selected slide's background.
    expect(currentDeck().slides[0].background).toBe("#222222");
    const middle = editor().addSlide(2.9);
    expect(currentDeck().slides[2]).toMatchObject({ id: middle, background: "#111111" });
    const last = editor().addSlide(99);
    expect(currentDeck().slides.at(-1)?.id).toBe(last);
    const negative = editor().addSlide(-5);
    expect(currentDeck().slides[0].id).toBe(negative);
    expect(editor().selectedSlideId).toBe(negative);
    expect(currentDeck().slides).toHaveLength(6);
  });

  it("adds the first slide to an empty deck", () => {
    seedDeck([]);
    const id = editor().addSlide();
    expect(currentDeck().slides.map((s) => s.id)).toEqual([id]);
    expect(currentDeck().slides[0].background).toBe("#ffffff");
  });

  it("enforces the slide limit", () => {
    seedDeck(Array.from({ length: MAX_SLIDES }, () => createSlide()));
    expect(editor().addSlide()).toBeNull();
    expect(editor().addSlide(0)).toBeNull();
    expect(editor().duplicateSlide(currentDeck().slides[0].id)).toBeNull();
    expect(editor().insertSlides([createSlide()])).toEqual([]);
    expect(currentDeck().slides).toHaveLength(MAX_SLIDES);
    expect(editor().past).toEqual([]);
    expect(toastMessages()).toEqual([`A deck can have at most ${MAX_SLIDES} slides.`]);
  });

  it("inserts copies of slides after the selected one and selects the first copy", () => {
    const deck = seedDeck([createSlide(), createSlide()]);
    const locked = createTextElement({ locked: true });
    const g1 = { ...rect(0, 0), groupId: "g" };
    const g2 = { ...rect(200, 0), groupId: "g" };
    const source: Slide = { ...createSlide("#abcdef", "Say hello"), elements: [locked, g1, g2] };
    const inserted = editor().insertSlides([source]);
    expect(inserted).toHaveLength(1);
    const copy = currentDeck().slides[1];
    expect(copy.id).toBe(inserted[0]);
    expect(copy.id).not.toBe(source.id);
    expect(copy).toMatchObject({ background: "#abcdef", notes: "Say hello" });
    expect(ids(copy.elements)).not.toContain(locked.id);
    expect(copy.elements[0]).toMatchObject({ text: locked.text, locked: true });
    expect(copy.elements[1].groupId).toBeTruthy();
    expect(copy.elements[1].groupId).not.toBe("g");
    expect(copy.elements[2].groupId).toBe(copy.elements[1].groupId);
    expect(currentDeck().slides[2].id).toBe(deck.slides[1].id);
    expect(editor().selectedSlideId).toBe(inserted[0]);
    expect(editor().past).toHaveLength(1);
  });

  it("inserts several slides at an index as one undo step", () => {
    const deck = seedDeck([createSlide(), createSlide()]);
    const a = createSlide("#000001");
    const b = createSlide("#000002");
    const inserted = editor().insertSlides([a, b], 0);
    expect(currentDeck().slides.map((s) => s.id)).toEqual([...inserted, ...deck.slides.map((s) => s.id)]);
    expect(currentDeck().slides.slice(0, 2).map((s) => s.background)).toEqual(["#000001", "#000002"]);
    expect(editor().selectedSlideId).toBe(inserted[0]);
    const atEnd = editor().insertSlides([a], 99);
    expect(currentDeck().slides.at(-1)?.id).toBe(atEnd[0]);
    expect(editor().past).toHaveLength(2);
    editor().undo();
    editor().undo();
    expect(currentDeck().slides.map((s) => s.id)).toEqual(deck.slides.map((s) => s.id));
  });

  it("ignores empty inserts and allows filling the deck up to the limit exactly", () => {
    seedDeck(Array.from({ length: MAX_SLIDES - 1 }, () => createSlide()));
    expect(editor().insertSlides([])).toEqual([]);
    expect(editor().insertSlides([createSlide(), createSlide()])).toEqual([]);
    expect(toastMessages()).toEqual([`A deck can have at most ${MAX_SLIDES} slides.`]);
    expect(editor().insertSlides([createSlide()])).toHaveLength(1);
    expect(currentDeck().slides).toHaveLength(MAX_SLIDES);
  });

  it("duplicates a slide with new ids right after the original, keeping notes and locks", () => {
    const original: Slide = { ...slideWith(createTextElement({ locked: true })), notes: "Notes" };
    const deck = seedDeck([original, createSlide()]);
    const copyId = editor().duplicateSlide(deck.slides[0].id);
    const slides = currentDeck().slides;
    expect(slides[1].id).toBe(copyId);
    expect(slides[1].notes).toBe("Notes");
    expect(slides[1].elements[0].id).not.toBe(slides[0].elements[0].id);
    expect(slides[1].elements[0].locked).toBe(true);
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

  it("selecting a slide clears the element selection and ignores unknown slides", () => {
    const el = createTextElement();
    const deck = seedDeck([slideWith(el), createSlide()]);
    editor().setEditing(el.id);
    editor().selectSlide("missing");
    expect(editor().selectedSlideId).toBe(deck.slides[0].id);
    expect(editor().selectedElementIds).toEqual([el.id]);
    editor().selectSlide(deck.slides[1].id);
    expect(editor()).toMatchObject({ selectedSlideId: deck.slides[1].id, selectedElementIds: [], editingElementId: null });
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

  it("sets speaker notes, coalescing typing into one undo step and limiting the length", () => {
    vi.useFakeTimers();
    const deck = seedDeck();
    const sid = deck.slides[0].id;
    editor().setSlideNotes(sid, "H");
    editor().setSlideNotes(sid, "He");
    editor().setSlideNotes(sid, "Hello");
    expect(currentDeck().slides[0].notes).toBe("Hello");
    expect(editor().past).toHaveLength(1);
    vi.advanceTimersByTime(COALESCE_MS + 1);
    editor().setSlideNotes(sid, "n".repeat(MAX_NOTES_LENGTH + 10));
    expect(currentDeck().slides[0].notes).toHaveLength(MAX_NOTES_LENGTH);
    expect(editor().past).toHaveLength(2);
    editor().setSlideNotes(sid, "n".repeat(MAX_NOTES_LENGTH));
    editor().setSlideNotes("missing", "x");
    expect(editor().past).toHaveLength(2);
    editor().undo();
    expect(currentDeck().slides[0].notes).toBe("Hello");
    editor().undo();
    expect(currentDeck().slides[0].notes).toBe("");
  });

  it("limits the title length", () => {
    seedDeck();
    editor().setTitle("x".repeat(MAX_TITLE_LENGTH + 20));
    expect(currentDeck().title).toHaveLength(MAX_TITLE_LENGTH);
  });
});

describe("adding elements", () => {
  it("adds an element, cascading its position and selecting it", () => {
    const deck = seedDeck();
    const a = createTextElement();
    const b = { ...createTextElement(), x: a.x, y: a.y };
    expect(editor().addElement(deck.slides[0].id, a)).toBe(true);
    expect(editor().addElement(deck.slides[0].id, b)).toBe(true);
    const els = elements();
    expect(els[1].x).toBe(a.x + 20);
    expect(editor().selectedElementIds).toEqual([b.id]);
    expect(editor().addElement("missing", createTextElement())).toBe(false);
  });

  it("enforces the per-slide element limit", () => {
    const deck = seedDeck([slideWith(...Array.from({ length: MAX_ELEMENTS_PER_SLIDE - 1 }, () => createShapeElement("rectangle")))]);
    const sid = deck.slides[0].id;
    expect(editor().addElements(sid, [createTextElement(), createTextElement()])).toBe(false);
    expect(toastMessages()).toEqual([`A slide can have at most ${MAX_ELEMENTS_PER_SLIDE} elements.`]);
    expect(editor().addElement(sid, createTextElement())).toBe(true);
    expect(editor().addElement(sid, createTextElement())).toBe(false);
    expect(elements()).toHaveLength(MAX_ELEMENTS_PER_SLIDE);
  });

  it("adds copies of several elements keeping their arrangement and selects them", () => {
    const deck = seedDeck([createSlide(), createSlide()]);
    const a = rect(100, 100);
    const b = { ...rect(300, 150), locked: true };
    expect(editor().addElements(deck.slides[1].id, [a, b])).toBe(true);
    const els = elements(1);
    expect(els).toHaveLength(2);
    expect(ids(els)).not.toContain(a.id);
    expect(ids(els)).not.toContain(b.id);
    expect(els.map((e) => [e.x, e.y])).toEqual([
      [100, 100],
      [300, 150],
    ]);
    expect(els[1].locked).toBeUndefined();
    expect(editor().selectedSlideId).toBe(deck.slides[1].id);
    expect(editor().selectedElementIds).toEqual(ids(els));
    expect(editor().past).toHaveLength(1);
  });

  it("offsets pasted elements together when they would land on top of existing ones", () => {
    const existing = rect(100, 100);
    const deck = seedDeck([slideWith(existing)]);
    editor().addElements(deck.slides[0].id, [rect(100, 100), rect(300, 150)]);
    expect(elements().slice(1).map((e) => [e.x, e.y])).toEqual([
      [120, 120],
      [320, 170],
    ]);
  });

  it("gives copied groups a new group id and ungroups lone group members", () => {
    const deck = seedDeck();
    const g1 = { ...rect(0, 0), groupId: "g" };
    const g2 = { ...rect(200, 0), groupId: "g" };
    const lone = { ...rect(400, 0), groupId: "other" };
    editor().addElements(deck.slides[0].id, [g1, g2, lone]);
    const [c1, c2, c3] = elements();
    expect(c1.groupId).toBeTruthy();
    expect(c1.groupId).not.toBe("g");
    expect(c2.groupId).toBe(c1.groupId);
    expect(c3.groupId).toBeUndefined();
  });

  it("ignores empty lists and unknown slides", () => {
    seedDeck();
    expect(editor().addElements(currentDeck().slides[0].id, [])).toBe(false);
    expect(editor().addElements("missing", [createTextElement()])).toBe(false);
    expect(editor().past).toEqual([]);
  });

  it("duplicates elements, keeping groups together and selecting the copies", () => {
    const { a, b, c, sid } = groupedSlide();
    editor().duplicateElements(sid, [a.id, b.id]);
    const els = elements();
    expect(els).toHaveLength(5);
    const copies = els.slice(3);
    expect(copies[0].groupId).toBeTruthy();
    expect(copies[0].groupId).not.toBe("g");
    expect(copies[1].groupId).toBe(copies[0].groupId);
    expect(editor().selectedElementIds).toEqual(ids(copies));
    editor().duplicateElement(sid, c.id);
    expect(elements()).toHaveLength(6);
    expect(editor().selectedElementIds).toEqual([elements()[5].id]);
    editor().duplicateElements(sid, ["missing"]);
    editor().duplicateElements("missing", [a.id]);
    expect(elements()).toHaveLength(6);
  });

  it("duplicates locked elements as unlocked copies", () => {
    const locked = createTextElement({ locked: true });
    const deck = seedDeck([slideWith(locked)]);
    editor().duplicateElement(deck.slides[0].id, locked.id);
    expect(elements()[1].locked).toBeUndefined();
    expect(elements()[0].locked).toBe(true);
  });
});

describe("updating elements", () => {
  it("updates an element and records history only for real changes", () => {
    const el = createTextElement();
    const deck = seedDeck([slideWith(el)]);
    editor().updateElement(deck.slides[0].id, el.id, { text: "Hello" });
    expect(elements()[0]).toMatchObject({ text: "Hello" });
    expect(editor().past).toHaveLength(1);
    editor().updateElement(deck.slides[0].id, el.id, { text: "Hello" });
    editor().updateElement(deck.slides[0].id, "missing", { text: "x" });
    editor().updateElement("missing", el.id, { text: "x" });
    expect(editor().past).toHaveLength(1);
  });

  it("keeps the position and size of locked elements but allows other changes", () => {
    const el = createTextElement({ locked: true });
    const deck = seedDeck([slideWith(el)]);
    const sid = deck.slides[0].id;
    editor().updateElement(sid, el.id, { x: 0, y: 0, width: 50, height: 50 });
    expect(editor().past).toEqual([]);
    editor().updateElement(sid, el.id, { x: 0, text: "Still editable", color: "#FF0000" });
    expect(elements()[0]).toMatchObject({ x: el.x, y: el.y, width: el.width, height: el.height, text: "Still editable", color: "#ff0000", locked: true });
  });

  it("keeps the crop of locked images", () => {
    const crop = { x: 0.1, y: 0.1, width: 0.5, height: 0.5 };
    const locked: ImageElement = { ...createImageElement(PNG, 400, 200), crop, locked: true };
    const free: ImageElement = { ...createImageElement(PNG, 400, 200), crop };
    const deck = seedDeck([slideWith(locked, free)]);
    const sid = deck.slides[0].id;
    editor().updateElement(sid, locked.id, { crop: null });
    editor().updateElement(sid, locked.id, { crop: { x: 0, y: 0, width: 0.2, height: 0.2 } });
    expect(elements()[0]).toEqual(locked);
    editor().updateElement(sid, locked.id, { alt: "Logo" });
    expect(elements()[0]).toMatchObject({ alt: "Logo", crop });
    editor().updateElement(sid, free.id, { crop: null });
    expect((elements()[1] as ImageElement).crop).toBeUndefined();
  });

  it("updates several elements live as one gesture, skipping locked geometry", () => {
    const a = rect(0, 0);
    const b = rect(200, 0);
    const locked = { ...rect(400, 0), locked: true };
    const deck = seedDeck([slideWith(a, b, locked)]);
    const sid = deck.slides[0].id;
    editor().updateElementsLive(sid, { [locked.id]: { x: 10 } });
    expect(editor().gestureBase).toBeNull();
    editor().updateElementsLive(sid, { [a.id]: { x: 10 }, [b.id]: { x: 210 }, [locked.id]: { x: 410 } });
    editor().updateElementsLive(sid, { [a.id]: { x: 20 }, [b.id]: { x: 220 } });
    expect(editor().past).toEqual([]);
    editor().endGesture();
    expect(elements().map((e) => e.x)).toEqual([20, 220, 400]);
    expect(editor().past).toHaveLength(1);
    editor().updateElementsLive("missing", { [a.id]: { x: 1 } });
    expect(editor().gestureBase).toBeNull();
  });
});

describe("deleting elements", () => {
  it("deletes elements, returns how many and clears their selection and editing", () => {
    const a = createTextElement();
    const b = rect(0, 0);
    const c = rect(200, 0);
    const deck = seedDeck([slideWith(a, b, c)]);
    const sid = deck.slides[0].id;
    editor().selectElements([a.id, b.id, c.id]);
    useEditorStore.setState({ editingElementId: a.id });
    expect(editor().deleteElements(sid, [a.id, b.id, "missing"])).toBe(2);
    expect(ids(elements())).toEqual([c.id]);
    expect(editor().selectedElementIds).toEqual([c.id]);
    expect(editor().editingElementId).toBeNull();
    expect(editor().past).toHaveLength(1);
    editor().deleteElement(sid, c.id);
    expect(elements()).toEqual([]);
    expect(editor().deleteElements("missing", [a.id])).toBe(0);
    expect(editor().deleteElements(sid, [])).toBe(0);
  });

  it("skips locked elements with a message", () => {
    const locked = createTextElement({ locked: true });
    const free = rect(0, 0);
    const deck = seedDeck([slideWith(locked, free)]);
    const sid = deck.slides[0].id;
    expect(editor().deleteElements(sid, [locked.id])).toBe(0);
    expect(editor().past).toEqual([]);
    expect(toastMessages()).toEqual([LOCKED_MESSAGE]);
    expect(editor().deleteElements(sid, [locked.id, free.id])).toBe(1);
    expect(ids(elements())).toEqual([locked.id]);
  });
});

describe("arranging elements", () => {
  it("reorders a layer", () => {
    const [a, b, c] = [createTextElement(), createTextElement(), createTextElement()];
    const deck = seedDeck([slideWith(a, b, c)]);
    const sid = deck.slides[0].id;
    const order = () => ids(elements());
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
    editor().reorderElement("missing", a.id, "front");
    expect(editor().past).toHaveLength(past);
  });

  it("reorders several layers, keeping their relative order", () => {
    const [a, b, c, d] = [rect(0, 0), rect(10, 0), rect(20, 0), rect(30, 0)];
    const deck = seedDeck([slideWith(a, b, c, d)]);
    const sid = deck.slides[0].id;
    const order = () => ids(elements());
    editor().reorderElements(sid, [c.id, a.id], "front");
    expect(order()).toEqual([b.id, d.id, a.id, c.id]);
    const past = editor().past.length;
    editor().reorderElements(sid, [a.id, c.id], "front");
    expect(editor().past).toHaveLength(past);
    editor().reorderElements(sid, [a.id, c.id], "back");
    expect(order()).toEqual([a.id, c.id, b.id, d.id]);
    editor().reorderElements(sid, [a.id, c.id], "forward");
    expect(order()).toEqual([b.id, a.id, c.id, d.id]);
    editor().reorderElements(sid, [a.id, c.id], "backward");
    expect(order()).toEqual([a.id, c.id, b.id, d.id]);
  });

  it("nudges elements and coalesces repeated nudges into one undo step", () => {
    vi.useFakeTimers();
    const a = rect(100, 100);
    const b = rect(300, 100);
    const deck = seedDeck([slideWith(a, b)]);
    const sid = deck.slides[0].id;
    expect(editor().nudgeElements(sid, [a.id, b.id], 1, 0)).toBe(true);
    expect(editor().nudgeElements(sid, [b.id, a.id], 0, 10)).toBe(true);
    expect(elements().map((e) => [e.x, e.y])).toEqual([
      [101, 110],
      [301, 110],
    ]);
    expect(editor().past).toHaveLength(1);
    vi.advanceTimersByTime(COALESCE_MS + 1);
    editor().nudgeElements(sid, [a.id, b.id], -10, 0);
    expect(editor().past).toHaveLength(2);
    editor().nudgeElements(sid, [a.id], -1, 0);
    expect(editor().past).toHaveLength(3);
    editor().undo();
    editor().undo();
    expect(elements()[0]).toMatchObject({ x: 101, y: 110 });
    editor().undo();
    expect(elements()[0]).toMatchObject({ x: 100, y: 100 });
  });

  it("refuses to nudge when any of the elements is locked", () => {
    const free = rect(100, 100);
    const locked = { ...rect(300, 100), locked: true };
    const deck = seedDeck([slideWith(free, locked)]);
    const sid = deck.slides[0].id;
    expect(editor().nudgeElements(sid, [free.id, locked.id], 10, 0)).toBe(false);
    expect(elements().map((e) => e.x)).toEqual([100, 300]);
    expect(editor().past).toEqual([]);
    expect(toastMessages()).toEqual([LOCKED_MESSAGE]);
    expect(editor().nudgeElements(sid, ["missing"], 10, 0)).toBe(false);
    expect(editor().nudgeElements("missing", [free.id], 10, 0)).toBe(false);
  });

  it("groups at least two elements, merging existing groups, and selects the group", () => {
    const a = rect(0, 0);
    const b = rect(200, 0);
    const c = rect(400, 0);
    const deck = seedDeck([slideWith(a, b, c)]);
    const sid = deck.slides[0].id;
    expect(editor().groupElements(sid, [a.id])).toBe(false);
    expect(editor().groupElements(sid, [a.id, "missing"])).toBe(false);
    expect(editor().groupElements("missing", [a.id, b.id])).toBe(false);
    expect(editor().past).toEqual([]);

    expect(editor().groupElements(sid, [a.id, b.id])).toBe(true);
    const first = elements()[0].groupId;
    expect(first).toBeTruthy();
    expect(elements()[1].groupId).toBe(first);
    expect(elements()[2].groupId).toBeUndefined();
    expect(editor().selectedElementIds).toEqual([a.id, b.id]);

    // Grouping one member of a group with another element takes the whole group along.
    expect(editor().groupElements(sid, [c.id, a.id])).toBe(true);
    const merged = elements().map((e) => e.groupId);
    expect(new Set(merged).size).toBe(1);
    expect(merged[0]).not.toBe(first);
    expect(editor().selectedElementIds).toEqual([a.id, b.id, c.id]);
    expect(editor().past).toHaveLength(2);
  });

  it("ungroups the whole group of any member", () => {
    const { a, b, c, sid } = groupedSlide();
    expect(editor().ungroupElements(sid, [c.id])).toBe(false);
    expect(editor().ungroupElements(sid, [b.id])).toBe(true);
    expect(elements().every((e) => e.groupId === undefined)).toBe(true);
    expect("groupId" in elements()[0]).toBe(false);
    expect(editor().ungroupElements(sid, [a.id, b.id])).toBe(false);
    expect(editor().past).toHaveLength(1);
  });

  it("locks and unlocks whole groups", () => {
    const { a, c, sid } = groupedSlide();
    editor().setElementsLocked(sid, [a.id], true);
    expect(elements().map((e) => e.locked)).toEqual([true, true, undefined]);
    editor().setElementsLocked(sid, [a.id], true);
    expect(editor().past).toHaveLength(1);
    editor().setElementsLocked(sid, [a.id, c.id], false);
    expect(elements().some((e) => "locked" in e)).toBe(false);
    expect(editor().past).toHaveLength(2);
    editor().setElementsLocked("missing", [a.id], true);
    expect(editor().past).toHaveLength(2);
  });
});

describe("selection", () => {
  it("selects whole groups and clears the selection with null", () => {
    const { a, b, c } = groupedSlide();
    editor().selectElement(b.id);
    expect(editor().selectedElementIds).toEqual([a.id, b.id]);
    editor().selectElement(c.id);
    expect(editor().selectedElementIds).toEqual([c.id]);
    editor().selectElement("missing");
    expect(editor().selectedElementIds).toEqual([]);
    editor().selectElement(c.id);
    editor().selectElement(null);
    expect(editor().selectedElementIds).toEqual([]);
  });

  it("selects nothing when no slide is selected", () => {
    const { a } = groupedSlide();
    editor().selectSlide(null);
    editor().selectElement(a.id);
    editor().toggleElementSelection(a.id);
    editor().selectElements([a.id]);
    editor().selectAllElements();
    expect(editor().selectedElementIds).toEqual([]);
  });

  it("toggles elements (and whole groups) in and out of the selection", () => {
    const { a, b, c } = groupedSlide();
    editor().selectElement(c.id);
    editor().setEditing(c.id);
    editor().toggleElementSelection(a.id);
    expect(editor().selectedElementIds).toEqual([c.id, a.id, b.id]);
    expect(editor().editingElementId).toBeNull();
    editor().toggleElementSelection(b.id);
    expect(editor().selectedElementIds).toEqual([c.id]);
    editor().toggleElementSelection(c.id);
    expect(editor().selectedElementIds).toEqual([]);
  });

  it("selects several elements, replacing or adding to the selection", () => {
    const { a, b, c } = groupedSlide();
    editor().selectElements([c.id, a.id]);
    expect(editor().selectedElementIds).toEqual([a.id, b.id, c.id]);
    editor().selectElements([b.id]);
    expect(editor().selectedElementIds).toEqual([a.id, b.id]);
    editor().selectElements([c.id], { add: true });
    expect(editor().selectedElementIds).toEqual([a.id, b.id, c.id]);
    editor().selectElements(["missing"]);
    expect(editor().selectedElementIds).toEqual([]);
  });

  it("selects all elements on the current slide", () => {
    const { a, b, c } = groupedSlide();
    editor().selectAllElements();
    expect(editor().selectedElementIds).toEqual([a.id, b.id, c.id]);
  });

  it("tracks editing state", () => {
    const el = createTextElement();
    const other = rect(0, 0);
    seedDeck([slideWith(el, other)]);
    editor().selectAllElements();
    editor().setEditing(el.id, true);
    expect(editor()).toMatchObject({ editingElementId: el.id, selectedElementIds: [el.id], editingSelectAll: true });
    editor().selectElement(el.id);
    expect(editor().editingElementId).toBe(el.id);
    editor().selectElement(other.id);
    expect(editor().editingElementId).toBeNull();
    editor().setEditing(el.id);
    expect(editor().editingSelectAll).toBe(false);
    editor().setEditing(null);
    expect(editor()).toMatchObject({ editingElementId: null, editingSelectAll: false, selectedElementIds: [el.id] });
  });

  it("selectors return the current slide and selected elements in stacking order", () => {
    const { a, b, c } = groupedSlide();
    expect(selectCurrentSlide(editor())?.elements).toHaveLength(3);
    expect(selectSelectedElements(editor())).toEqual([]);
    expect(selectCurrentElement(editor())).toBeNull();
    useEditorStore.setState({ selectedElementIds: [c.id, a.id] });
    expect(ids(selectSelectedElements(editor()))).toEqual([a.id, c.id]);
    expect(selectCurrentElement(editor())).toBeNull();
    useEditorStore.setState({ selectedElementIds: [b.id] });
    expect(selectCurrentElement(editor())?.id).toBe(b.id);
    useEditorStore.setState({ selectedElementIds: ["missing"] });
    expect(selectCurrentElement(editor())).toBeNull();
    editor().selectSlide(null);
    expect(selectCurrentSlide(editor())).toBeNull();
    expect(selectSelectedElements(editor())).toEqual([]);
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
    expect(elements()[0].x).toBe(el.x + 50);
    editor().undo();
    expect(elements()[0].x).toBe(el.x);
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
    expect(elements()[0].x).toBe(el.x);
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
    expect(elements()[0].x).toBe(200);
    editor().undo();
    expect(elements()[0].x).toBe(el.x);
  });

  it("caps the history length", () => {
    seedDeck();
    for (let i = 0; i < HISTORY_LIMIT + 10; i += 1) editor().addSlide();
    expect(editor().past).toHaveLength(HISTORY_LIMIT);
  });

  it("drops elements that no longer exist from the selection on undo and redo", () => {
    const a = rect(0, 0);
    const deck = seedDeck([slideWith(a)]);
    const sid = deck.slides[0].id;
    const b = rect(300, 0);
    editor().addElement(sid, b);
    expect(editor().selectedElementIds).toEqual([b.id]);
    editor().undo();
    expect(editor().selectedElementIds).toEqual([]);
    editor().selectElements([a.id]);
    editor().redo();
    expect(editor().selectedElementIds).toEqual([a.id]);
    editor().selectAllElements();
    editor().undo();
    expect(editor().selectedElementIds).toEqual([a.id]);
    expect(editor().selectedSlideId).toBe(sid);
  });

  it("selects the slide at the same position when undo/redo removes the selected slide", () => {
    const deck = seedDeck([createSlide(), createSlide(), createSlide()]);
    const [s0, s1, s2] = deck.slides.map((s) => s.id);
    const added = editor().addSlide();
    expect(editor().selectedSlideId).toBe(added);
    editor().undo();
    expect(editor().selectedSlideId).toBe(s1);
    editor().deleteSlide(s1);
    expect(editor().selectedSlideId).toBe(s2);
    editor().undo();
    editor().selectSlide(s1);
    editor().redo();
    expect(currentDeck().slides.map((s) => s.id)).toEqual([s0, s2]);
    expect(editor().selectedSlideId).toBe(s2);
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
      { op: "add_slide", position: null, background: "#000000", notes: "Talk track", elements: [] },
    ]);
    expect(report.applied).toBe(2);
    expect(currentDeck().slides).toHaveLength(2);
    expect(currentDeck().slides[1].notes).toBe("Talk track");
    expect(editor().selectedSlideId).toBe(currentDeck().slides[1].id);
    expect(editor().past).toHaveLength(1);
    editor().undo();
    expect(currentDeck().slides).toHaveLength(1);
  });

  it("highlights what the AI changed until the highlight is cleared", () => {
    const el = createTextElement();
    const deck = seedDeck([slideWith(el)]);
    editor().applyAiOperations([{ op: "update_element", elementId: el.id, changes: { ...NO_CHANGES, text: "AI text" } }]);
    const first = editor().aiHighlight;
    expect(first).toEqual({ slideIds: [deck.slides[0].id], elementIds: [el.id], token: expect.any(String) });
    editor().applyAiOperations([{ op: "update_element", elementId: el.id, changes: { ...NO_CHANGES, text: "Again" } }]);
    expect(editor().aiHighlight?.token).not.toBe(first?.token);
    editor().clearAiHighlight();
    expect(editor().aiHighlight).toBeNull();
  });

  it("does not record history or highlight when no AI operation applies", () => {
    seedDeck();
    const report = editor().applyAiOperations([{ op: "delete_slide", slideId: "S9" }]);
    expect(report.applied).toBe(0);
    expect(editor().past).toHaveLength(0);
    expect(editor().aiHighlight).toBeNull();
  });

  it("never lets the AI change locked elements", () => {
    const locked = createTextElement({ locked: true, text: "Fixed" });
    seedDeck([slideWith(locked)]);
    const report = editor().applyAiOperations([
      { op: "update_element", elementId: locked.id, changes: { ...NO_CHANGES, text: "Changed" } },
      { op: "delete_element", elementId: locked.id },
    ]);
    expect(report.applied).toBe(0);
    expect(report.skipped).toHaveLength(2);
    expect(elements()).toEqual([locked]);
    expect(editor().past).toEqual([]);
  });

  it("drops deleted elements from the selection and finishes a running gesture first", () => {
    const a = rect(0, 0);
    const b = rect(300, 0);
    const deck = seedDeck([slideWith(a, b)]);
    const sid = deck.slides[0].id;
    editor().selectAllElements();
    editor().setEditing(a.id);
    editor().selectAllElements();
    editor().updateElementLive(sid, b.id, { x: 500 });
    editor().applyAiOperations([{ op: "delete_element", elementId: a.id }]);
    expect(editor().gestureBase).toBeNull();
    expect(editor().selectedElementIds).toEqual([b.id]);
    expect(editor().editingElementId).toBeNull();
    expect(editor().past).toHaveLength(2);
    editor().undo();
    expect(ids(elements())).toEqual([a.id, b.id]);
    expect(elements()[1].x).toBe(500);
    editor().undo();
    expect(elements()[1].x).toBe(300);
  });
});

describe("expandToGroups", () => {
  it("adds every member of the selected groups, in slide order", () => {
    const a = { ...rect(0, 0), groupId: "g" };
    const b = rect(100, 0);
    const c = { ...rect(200, 0), groupId: "g" };
    const slide = slideWith(a, b, c);
    expect(expandToGroups(slide, [c.id])).toEqual([a.id, c.id]);
    expect(expandToGroups(slide, [b.id, c.id])).toEqual([a.id, b.id, c.id]);
    expect(expandToGroups(slide, ["missing"])).toEqual([]);
    expect(expandToGroups(slide, [])).toEqual([]);
    expect(expandToGroups(undefined, [a.id])).toEqual([]);
  });
});

describe("reconcileSelection", () => {
  const deckOf = (...slides: Slide[]): Deck => ({ version: 1, id: "d", title: "", updatedAt: 0, slides });

  it("falls back to the slide at the previous index", () => {
    const a = createSlide();
    const b = createSlide();
    const c = createSlide();
    const before = deckOf(a, b, c);
    expect(reconcileSelection(deckOf(a, c), b.id, ["el"], before)).toEqual({ selectedSlideId: c.id, selectedElementIds: [] });
    expect(reconcileSelection(deckOf(a), c.id, [], before)).toEqual({ selectedSlideId: a.id, selectedElementIds: [] });
    expect(reconcileSelection(deckOf(), b.id, [], before)).toEqual({ selectedSlideId: null, selectedElementIds: [] });
  });

  it("selects the first slide when nothing (or something unknown) was selected", () => {
    const a = createSlide();
    const b = createSlide();
    expect(reconcileSelection(deckOf(a, b), null, [])).toEqual({ selectedSlideId: a.id, selectedElementIds: [] });
    expect(reconcileSelection(deckOf(a, b), "missing", ["x"])).toEqual({ selectedSlideId: a.id, selectedElementIds: [] });
  });

  it("keeps selected elements that still exist on the same slide", () => {
    const keep = rect(0, 0);
    const slide = slideWith(keep, rect(100, 0));
    expect(reconcileSelection(deckOf(slide), slide.id, [keep.id, "gone"])).toEqual({ selectedSlideId: slide.id, selectedElementIds: [keep.id] });
  });
});

describe("misc", () => {
  it("tracks save status and hydration", () => {
    editor().setSaveStatus("saving");
    editor().setHydrated();
    expect(useEditorStore.getState()).toMatchObject({ saveStatus: "saving", hydrated: true });
  });

  it("keeps chart data rectangular when an update changes only the categories or series", () => {
    const chart = createChartElement("bar");
    const deck = seedDeck([slideWith(chart)]);
    const sid = deck.slides[0].id;
    editor().updateElement(sid, chart.id, { categories: ["A"], series: [{ name: "S", values: [1, 2, 3] }] });
    expect(elements()[0]).toMatchObject({ categories: ["A"], series: [{ name: "S", values: [1] }] });
  });
});
