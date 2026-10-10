import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, render, screen } from "@testing-library/react";
import { currentDeck, editor, seedDeck, slideWith, toastMessages } from "@/test/utils";
import { MAX_ELEMENTS_PER_SLIDE, MAX_SLIDES, MAX_TABLE_ROWS } from "@/lib/constants";
import { createChartElement, createShapeElement, createSlide, createTableElement, createTextElement } from "@/lib/factory";
import type { Slide } from "@/lib/schema";
import { CLIPBOARD_MIME, CLIPBOARD_STORAGE_KEY, readClipboard } from "@/lib/store/clipboardStore";
import { LOCKED_MESSAGE } from "@/lib/store/editorStore";
import {
  copySelection,
  copySlides,
  cutSelection,
  matchInternalEntry,
  pasteEntry,
  pasteExternal,
  pasteFromApp,
  CATCHER_RELEASE_MS,
  CLIPBOARD_CATCHER_ATTR,
  useClipboard,
  writeSystemText,
} from "./useClipboard";

const { importImageFile } = vi.hoisted(() => ({ importImageFile: vi.fn() }));
vi.mock("@/lib/image", () => ({ importImageFile: (...args: unknown[]) => importImageFile(...args) }));

const NO_SLIDE = "Add a slide first, then paste.";
const NOTHING_TO_PASTE = "Nothing to paste yet. Copy elements or slides first.";
const PNG = "data:image/png;base64,AAAA";

beforeEach(() => {
  importImageFile.mockReset();
});

const slides = () => currentDeck().slides;
const els = (index = 0) => currentDeck().slides[index].elements;
const select = (...ids: string[]) => act(() => editor().selectElements(ids));

function seedTwo() {
  const text = createTextElement({ text: "Hello", x: 100, y: 100 });
  const shape = createShapeElement("rectangle", { x: 300, y: 300 });
  const deck = seedDeck([slideWith(text, shape)]);
  return { text, shape, slideId: deck.slides[0].id };
}

function imageFile(name = "photo.png", type = "image/png") {
  return new File(["x"], name, { type });
}

/** Pretends some page text is selected (then copy must stay native). */
function mockTextSelection() {
  return vi.spyOn(window, "getSelection").mockReturnValue({ isCollapsed: false, toString: () => "chat text" } as unknown as Selection);
}

describe("copySelection / cutSelection", () => {
  it("returns null when nothing is selected", () => {
    seedTwo();
    expect(copySelection()).toBeNull();
    expect(cutSelection()).toBeNull();
    expect(readClipboard()).toBeNull();
    expect(els()).toHaveLength(2);
  });

  it("copies the selected elements in slide order with their plain text", () => {
    const { text, shape } = seedTwo();
    select(shape.id, text.id);
    const entry = copySelection();
    expect(entry).not.toBeNull();
    expect(entry!.payload).toMatchObject({ kind: "elements", elements: [{ id: text.id }, { id: shape.id }] });
    expect(entry!.plainText).toBe("Hello");
    expect(entry!.token).toBeTruthy();
    expect(readClipboard()).toEqual(entry);
    // The slide itself is untouched.
    expect(els()).toHaveLength(2);
    expect(editor().past).toHaveLength(0);
  });

  it("stores a snapshot, not a live reference", () => {
    const { text, slideId } = seedTwo();
    select(text.id);
    copySelection();
    act(() => editor().updateElement(slideId, text.id, { text: "Changed" }));
    const entry = readClipboard()!;
    expect(entry.payload.kind === "elements" && entry.payload.elements[0]).toMatchObject({ type: "text", text: "Hello" });
  });

  it("joins the plain text of text, table and chart elements", () => {
    const text = createTextElement({ text: "Title" });
    const table = createTableElement({ rows: [["a", "b"], ["1", "2"]] });
    const chart = createChartElement("bar", { categories: ["Q1"], series: [{ name: "S", values: [5] }] });
    seedDeck([slideWith(text, table, chart, createShapeElement("ellipse"))]);
    act(() => editor().selectAllElements());
    expect(copySelection()!.plainText).toBe("Title\n\na\tb\n1\t2\n\n\tS\nQ1\t5");
  });

  it("cuts the selection: copies it and removes it as one undo step", () => {
    const { text, shape } = seedTwo();
    select(shape.id);
    const entry = cutSelection();
    expect(entry!.payload).toMatchObject({ kind: "elements", elements: [{ id: shape.id }] });
    expect(els().map((e) => e.id)).toEqual([text.id]);
    expect(editor().selectedElementIds).toEqual([]);
    expect(editor().past).toHaveLength(1);
  });

  it("refuses to cut when any selected element is locked", () => {
    const { text, shape, slideId } = seedTwo();
    act(() => editor().setElementsLocked(slideId, [shape.id], true));
    select(text.id, shape.id);
    expect(cutSelection()).toBeNull();
    expect(toastMessages()).toEqual([LOCKED_MESSAGE]);
    expect(els()).toHaveLength(2);
    expect(readClipboard()).toBeNull();
  });

  it("still copies locked elements", () => {
    const { shape, slideId } = seedTwo();
    act(() => editor().setElementsLocked(slideId, [shape.id], true));
    select(shape.id);
    expect(copySelection()!.payload).toMatchObject({ kind: "elements", elements: [{ id: shape.id, locked: true }] });
  });
});

describe("copySlides", () => {
  it("copies whole slides with their notes, in deck order", () => {
    const first: Slide = { ...slideWith(createTextElement({ text: "One" })), notes: "Say hi" };
    const second: Slide = slideWith(createTextElement({ text: "Two" }));
    seedDeck([first, second, createSlide()]);
    const entry = copySlides([second.id, first.id]);
    expect(entry!.payload).toMatchObject({ kind: "slides", slides: [{ id: first.id, notes: "Say hi" }, { id: second.id }] });
    expect(entry!.plainText).toBe("One\n\nTwo");
    expect(readClipboard()!.token).toBe(entry!.token);
  });

  it("returns null for unknown slides", () => {
    seedDeck([createSlide()]);
    expect(copySlides(["missing"])).toBeNull();
    expect(copySlides([])).toBeNull();
    expect(readClipboard()).toBeNull();
  });
});

describe("pasteEntry", () => {
  it("pastes elements onto the current slide as new, selected, unlocked copies", () => {
    const { text, shape, slideId } = seedTwo();
    act(() => editor().setElementsLocked(slideId, [shape.id], true));
    select(text.id, shape.id);
    const entry = copySelection()!;
    let ok = false;
    act(() => {
      ok = pasteEntry(entry);
    });
    expect(ok).toBe(true);
    expect(els()).toHaveLength(4);
    const copies = els().slice(2);
    expect(copies.map((e) => e.type)).toEqual(["text", "shape"]);
    expect(copies.map((e) => e.id)).not.toContain(text.id);
    expect(copies.every((e) => !e.locked)).toBe(true);
    expect(editor().selectedElementIds).toEqual(copies.map((e) => e.id));
    // Pasted on top of the originals, the copies are offset together.
    expect(copies[0].x).not.toBe(text.x);
    expect(copies[1].x - copies[0].x).toBe(shape.x - text.x);
  });

  it("pastes elements onto another slide", () => {
    const { text } = seedTwo();
    select(text.id);
    const entry = copySelection()!;
    const other = createSlide();
    act(() => {
      editor().insertSlides([other]);
    });
    act(() => {
      pasteEntry(entry);
    });
    expect(els(1)).toHaveLength(1);
    expect(els(1)[0]).toMatchObject({ type: "text", text: "Hello", x: text.x, y: text.y });
  });

  it("needs a slide to paste elements onto", () => {
    const { text } = seedTwo();
    select(text.id);
    const entry = copySelection()!;
    seedDeck([]);
    expect(pasteEntry(entry)).toBe(false);
    expect(toastMessages()).toEqual([NO_SLIDE]);
  });

  it("reports a full slide", () => {
    const full = slideWith(...Array.from({ length: MAX_ELEMENTS_PER_SLIDE }, () => createShapeElement("rectangle")));
    seedDeck([full]);
    act(() => editor().selectElement(full.elements[0].id));
    const entry = copySelection()!;
    expect(pasteEntry(entry)).toBe(false);
    expect(els()).toHaveLength(MAX_ELEMENTS_PER_SLIDE);
    expect(toastMessages()[0]).toMatch(/at most/);
  });

  it("inserts pasted slides after the current slide and selects the first one", () => {
    const a = createSlide("#111111");
    const b = createSlide("#222222");
    const c = createSlide("#333333");
    seedDeck([a, b, c]);
    const entry = copySlides([c.id])!;
    act(() => editor().selectSlide(a.id));
    act(() => {
      expect(pasteEntry(entry)).toBe(true);
    });
    expect(slides().map((s) => s.background)).toEqual(["#111111", "#333333", "#222222", "#333333"]);
    expect(slides()[1].id).not.toBe(c.id);
    expect(editor().selectedSlideId).toBe(slides()[1].id);
  });

  it("inserts pasted slides at a given index", () => {
    const a = createSlide("#111111");
    const b = createSlide("#222222");
    seedDeck([a, b]);
    const entry = copySlides([a.id, b.id])!;
    act(() => {
      pasteEntry(entry, 0);
    });
    expect(slides().map((s) => s.background)).toEqual(["#111111", "#222222", "#111111", "#222222"]);
    expect(editor().selectedSlideId).toBe(slides()[0].id);
  });

  it("pastes slides into an empty deck", () => {
    const a = { ...createSlide("#123456"), notes: "Notes" };
    seedDeck([a]);
    const entry = copySlides([a.id])!;
    seedDeck([]);
    act(() => {
      expect(pasteEntry(entry)).toBe(true);
    });
    expect(slides()).toHaveLength(1);
    expect(slides()[0]).toMatchObject({ background: "#123456", notes: "Notes" });
  });

  it("refuses slides beyond the deck limit", () => {
    seedDeck(Array.from({ length: MAX_SLIDES }, () => createSlide()));
    const entry = copySlides([slides()[0].id])!;
    expect(pasteEntry(entry)).toBe(false);
    expect(slides()).toHaveLength(MAX_SLIDES);
    expect(toastMessages()[0]).toMatch(/at most/);
  });
});

describe("pasteFromApp", () => {
  it("explains when nothing was copied yet", () => {
    seedTwo();
    expect(pasteFromApp()).toBe(false);
    expect(toastMessages()).toEqual([NOTHING_TO_PASTE]);
    expect(els()).toHaveLength(2);
  });

  it("pastes the most recent in-app copy", () => {
    const { shape } = seedTwo();
    select(shape.id);
    copySelection();
    act(() => {
      expect(pasteFromApp()).toBe(true);
    });
    expect(els()).toHaveLength(3);
  });

  it("passes the slide index through for slides", () => {
    const a = createSlide("#111111");
    const b = createSlide("#222222");
    seedDeck([a, b]);
    copySlides([b.id]);
    act(() => {
      pasteFromApp(0);
    });
    expect(slides().map((s) => s.background)).toEqual(["#222222", "#111111", "#222222"]);
  });

  it("pastes a copy made in another tab (stored in localStorage)", () => {
    seedTwo();
    const element = createShapeElement("triangle");
    const stored = { payload: { kind: "elements", elements: [element] }, token: "other-tab", plainText: "", at: Date.now() };
    window.localStorage.setItem(CLIPBOARD_STORAGE_KEY, JSON.stringify(stored));
    act(() => {
      expect(pasteFromApp()).toBe(true);
    });
    expect(els()[2]).toMatchObject({ type: "shape", shape: "triangle" });
  });
});

describe("pasteExternal", () => {
  it("does nothing for empty clipboard content", async () => {
    seedTwo();
    expect(await pasteExternal({ files: [], text: "" })).toBe(false);
    expect(await pasteExternal({ files: [], text: "  \n\t " })).toBe(false);
    expect(els()).toHaveLength(2);
    expect(toastMessages()).toEqual([]);
  });

  it("needs a slide", async () => {
    seedDeck([]);
    expect(await pasteExternal({ files: [], text: "Hello" })).toBe(false);
    expect(toastMessages()).toEqual([NO_SLIDE]);
  });

  it("pastes an image file as an image element", async () => {
    seedTwo();
    importImageFile.mockResolvedValue({ src: PNG, width: 400, height: 200 });
    const file = imageFile();
    let ok = false;
    await act(async () => {
      ok = await pasteExternal({ files: [file], text: "ignored text" });
    });
    expect(ok).toBe(true);
    expect(importImageFile).toHaveBeenCalledWith(file);
    expect(els()[2]).toMatchObject({ type: "image", src: PNG, width: 400, height: 200 });
    expect(editor().selectedElementIds).toEqual([els()[2].id]);
  });

  it("uses the first image among several files", async () => {
    seedTwo();
    importImageFile.mockResolvedValue({ src: PNG, width: 100, height: 100 });
    const image = imageFile("b.jpg", "image/jpeg");
    await act(async () => {
      await pasteExternal({ files: [new File(["x"], "a.pdf", { type: "application/pdf" }), image], text: "" });
    });
    expect(importImageFile).toHaveBeenCalledWith(image);
    expect(els()).toHaveLength(3);
  });

  it("reports images that can't be imported", async () => {
    seedTwo();
    importImageFile.mockRejectedValue(new Error("Images must be 10 MB or smaller."));
    expect(await pasteExternal({ files: [imageFile()], text: "" })).toBe(false);
    expect(toastMessages()).toEqual(["Images must be 10 MB or smaller."]);
    importImageFile.mockRejectedValue("weird");
    expect(await pasteExternal({ files: [imageFile()], text: "" })).toBe(false);
    expect(toastMessages()).toContain("The image couldn't be pasted.");
    expect(els()).toHaveLength(2);
  });

  it("only accepts image files", async () => {
    seedTwo();
    expect(await pasteExternal({ files: [new File(["x"], "doc.pdf", { type: "application/pdf" })], text: "" })).toBe(false);
    expect(toastMessages()).toEqual(["Only images can be pasted onto a slide."]);
    expect(importImageFile).not.toHaveBeenCalled();
    expect(els()).toHaveLength(2);
  });

  it("pastes the text of a non-image file paste", async () => {
    seedTwo();
    await act(async () => {
      await pasteExternal({ files: [new File(["x"], "doc.pdf", { type: "application/pdf" })], text: "doc.pdf" });
    });
    expect(els()[2]).toMatchObject({ type: "text", text: "doc.pdf" });
  });

  it("turns spreadsheet cells into a table", async () => {
    seedTwo();
    let ok = false;
    await act(async () => {
      ok = await pasteExternal({ files: [], text: "Name\tScore\nAda\t10\nBob\t7\n" });
    });
    expect(ok).toBe(true);
    expect(els()[2]).toMatchObject({ type: "table", rows: [["Name", "Score"], ["Ada", "10"], ["Bob", "7"]], headerRow: true });
    expect(toastMessages()).toEqual([]);
  });

  it("trims oversized spreadsheet pastes to the table limits and says so", async () => {
    seedTwo();
    const text = Array.from({ length: MAX_TABLE_ROWS + 5 }, (_, i) => `r${i}\tv${i}`).join("\n");
    await act(async () => {
      await pasteExternal({ files: [], text });
    });
    const table = els()[2];
    expect(table.type === "table" && table.rows).toHaveLength(MAX_TABLE_ROWS);
    expect(toastMessages()).toEqual(["The pasted cells were trimmed to fit the table limits."]);
  });

  it("falls back to a text box when the cells are all empty", async () => {
    seedTwo();
    await act(async () => {
      await pasteExternal({ files: [], text: '""\t""' });
    });
    expect(els()[2]).toMatchObject({ type: "text", text: '""\t""' });
  });

  it("turns other text into a text box, normalizing line endings", async () => {
    seedTwo();
    await act(async () => {
      await pasteExternal({ files: [], text: "First line\r\nSecond, with commas, line" });
    });
    expect(els()[2]).toMatchObject({ type: "text", text: "First line\nSecond, with commas, line" });
    expect(editor().selectedElementIds).toEqual([els()[2].id]);
  });
});

describe("matchInternalEntry", () => {
  function copyHello() {
    const { text } = seedTwo();
    select(text.id);
    return copySelection()!;
  }

  it("finds nothing without an in-app copy", () => {
    seedTwo();
    expect(matchInternalEntry({ token: "", text: "", hasFiles: false })).toBeNull();
    expect(matchInternalEntry({ token: "abc", text: "Hello", hasFiles: false })).toBeNull();
  });

  it("matches by token", () => {
    const entry = copyHello();
    expect(matchInternalEntry({ token: entry.token, text: "", hasFiles: false })).toEqual(entry);
    expect(matchInternalEntry({ token: entry.token, text: "anything", hasFiles: true })).toEqual(entry);
  });

  it("rejects a different token even when the text matches", () => {
    copyHello();
    expect(matchInternalEntry({ token: "older-copy", text: "Hello", hasFiles: false })).toBeNull();
  });

  it("treats file pastes without our token as external", () => {
    copyHello();
    expect(matchInternalEntry({ token: "", text: "Hello", hasFiles: true })).toBeNull();
    expect(matchInternalEntry({ token: "", text: "", hasFiles: true })).toBeNull();
  });

  it("matches by plain text when the browser dropped the token", () => {
    const entry = copyHello();
    expect(matchInternalEntry({ token: "", text: "Hello", hasFiles: false })).toEqual(entry);
    expect(matchInternalEntry({ token: "", text: "Hello world", hasFiles: false })).toBeNull();
  });

  it("falls back to the in-app copy when the system clipboard has no text", () => {
    const { shape } = seedTwo();
    select(shape.id);
    const entry = copySelection()!;
    expect(entry.plainText).toBe("");
    expect(matchInternalEntry({ token: "", text: "", hasFiles: false })).toEqual(entry);
    expect(matchInternalEntry({ token: "", text: "  \n", hasFiles: false })).toEqual(entry);
    expect(matchInternalEntry({ token: "", text: "From elsewhere", hasFiles: false })).toBeNull();
  });
});

describe("writeSystemText", () => {
  afterEach(() => {
    Reflect.deleteProperty(navigator, "clipboard");
  });

  it("ignores a missing, failing or throwing Clipboard API", async () => {
    expect(() => writeSystemText("a")).not.toThrow();
    const rejecting = vi.fn().mockRejectedValue(new Error("denied"));
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: rejecting } });
    expect(() => writeSystemText("b")).not.toThrow();
    expect(rejecting).toHaveBeenCalledWith("b");
    await Promise.resolve();
    const throwing = vi.fn(() => {
      throw new Error("insecure");
    });
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: throwing } });
    expect(() => writeSystemText("c")).not.toThrow();
  });
});

/* ------------------------------------------------------------------ */
/* The hook                                                            */
/* ------------------------------------------------------------------ */

function Harness({ enabled = true, thumbId }: { enabled?: boolean; thumbId?: string }) {
  useClipboard(enabled);
  return (
    <div>
      <input aria-label="field" />
      <div aria-label="canvas" tabIndex={-1} />
      {thumbId && (
        <button type="button" data-slide-thumb={thumbId}>
          Thumb
        </button>
      )}
    </div>
  );
}

interface FakeClipboardData {
  getData: (format: string) => string;
  setData: ReturnType<typeof vi.fn>;
  files: File[];
}

/** jsdom has no ClipboardEvent/DataTransfer: a plain cancelable event with a fake clipboardData. */
function clipboardEvent(type: "copy" | "cut" | "paste", data: { text?: string; token?: string; files?: File[] } | null = {}) {
  const event = new Event(type, { bubbles: true, cancelable: true });
  const store = new Map<string, string>();
  let clipboardData: FakeClipboardData | null = null;
  if (data) {
    if (data.text !== undefined) store.set("text/plain", data.text);
    if (data.token !== undefined) store.set(CLIPBOARD_MIME, data.token);
    clipboardData = {
      getData: (format: string) => store.get(format) ?? "",
      setData: vi.fn((format: string, value: string) => void store.set(format, value)),
      files: data.files ?? [],
    };
  }
  Object.defineProperty(event, "clipboardData", { value: clipboardData });
  return { event, store, clipboardData };
}

function dispatch(event: Event, target: EventTarget = document.body) {
  act(() => {
    target.dispatchEvent(event);
  });
  return event;
}

function keyDown(key: string, init: KeyboardEventInit = {}, target: EventTarget = document.body) {
  const event = new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ctrlKey: true, ...init });
  act(() => {
    target.dispatchEvent(event);
  });
  return event;
}

describe("useClipboard: copy and cut events", () => {
  it("copies the selection into the in-app and system clipboards", () => {
    const { shape, text } = seedTwo();
    render(<Harness />);
    select(text.id, shape.id);
    const { event, store } = clipboardEvent("copy");
    dispatch(event);
    expect(event.defaultPrevented).toBe(true);
    const entry = readClipboard()!;
    expect(entry.payload).toMatchObject({ kind: "elements", elements: [{ id: text.id }, { id: shape.id }] });
    expect(store.get("text/plain")).toBe("Hello");
    expect(store.get(CLIPBOARD_MIME)).toBe(entry.token);
    expect(els()).toHaveLength(2);
  });

  it("keeps native copy when nothing is selected", () => {
    seedTwo();
    render(<Harness />);
    const { event, clipboardData } = clipboardEvent("copy");
    dispatch(event);
    expect(event.defaultPrevented).toBe(false);
    expect(clipboardData!.setData).not.toHaveBeenCalled();
    expect(readClipboard()).toBeNull();
  });

  it("keeps native copy inside fields and when page text is selected", () => {
    const { text } = seedTwo();
    render(<Harness />);
    select(text.id);
    const inField = clipboardEvent("copy").event;
    dispatch(inField, screen.getByLabelText("field"));
    expect(inField.defaultPrevented).toBe(false);
    mockTextSelection();
    const withSelection = clipboardEvent("cut").event;
    dispatch(withSelection);
    expect(withSelection.defaultPrevented).toBe(false);
    expect(readClipboard()).toBeNull();
    expect(els()).toHaveLength(2);
  });

  it("still copies when the clipboard data is unavailable", () => {
    const { text } = seedTwo();
    render(<Harness />);
    select(text.id);
    const { event } = clipboardEvent("copy", null);
    dispatch(event);
    expect(event.defaultPrevented).toBe(true);
    expect(readClipboard()).not.toBeNull();
  });

  it("cuts the selection", () => {
    const { text, shape } = seedTwo();
    render(<Harness />);
    select(shape.id);
    const { event, store } = clipboardEvent("cut");
    dispatch(event);
    expect(event.defaultPrevented).toBe(true);
    expect(els().map((e) => e.id)).toEqual([text.id]);
    expect(store.get(CLIPBOARD_MIME)).toBe(readClipboard()!.token);
  });

  it("does not cut locked elements and leaves the event alone", () => {
    const { shape, slideId } = seedTwo();
    render(<Harness />);
    act(() => editor().setElementsLocked(slideId, [shape.id], true));
    select(shape.id);
    const { event } = clipboardEvent("cut");
    dispatch(event);
    expect(event.defaultPrevented).toBe(false);
    expect(els()).toHaveLength(2);
    expect(toastMessages()).toEqual([LOCKED_MESSAGE]);
    expect(readClipboard()).toBeNull();
  });

  it("copies the focused slide thumbnail instead of the element selection", () => {
    const first: Slide = { ...slideWith(createTextElement({ text: "One" })), notes: "N" };
    const second = slideWith(createTextElement({ text: "Two" }));
    seedDeck([first, second]);
    render(<Harness thumbId={second.id} />);
    act(() => editor().selectElement(first.elements[0].id));
    const thumb = screen.getByRole("button", { name: "Thumb" });
    act(() => thumb.focus());
    const { event, store } = clipboardEvent("copy");
    dispatch(event, thumb);
    expect(event.defaultPrevented).toBe(true);
    expect(readClipboard()!.payload).toMatchObject({ kind: "slides", slides: [{ id: second.id }] });
    expect(store.get("text/plain")).toBe("Two");
    expect(slides()).toHaveLength(2);
  });

  it("cuts the focused slide thumbnail", () => {
    const first = slideWith(createTextElement({ text: "One" }));
    const second = slideWith(createTextElement({ text: "Two" }));
    seedDeck([first, second]);
    render(<Harness thumbId={first.id} />);
    const thumb = screen.getByRole("button", { name: "Thumb" });
    act(() => thumb.focus());
    const { event } = clipboardEvent("cut");
    dispatch(event, thumb);
    expect(event.defaultPrevented).toBe(true);
    expect(slides().map((s) => s.id)).toEqual([second.id]);
    expect(readClipboard()!.payload).toMatchObject({ kind: "slides", slides: [{ id: first.id }] });
  });

  it("ignores a thumbnail of a slide that no longer exists", () => {
    seedTwo();
    render(<Harness thumbId="gone" />);
    const thumb = screen.getByRole("button", { name: "Thumb" });
    act(() => thumb.focus());
    const { event } = clipboardEvent("cut");
    dispatch(event, thumb);
    expect(event.defaultPrevented).toBe(false);
    expect(slides()).toHaveLength(1);
  });
});

describe("useClipboard: paste events", () => {
  it("pastes our own copy recognized by its token", () => {
    const { shape } = seedTwo();
    render(<Harness />);
    select(shape.id);
    const entry = copySelection()!;
    const { event } = clipboardEvent("paste", { text: "", token: entry.token });
    dispatch(event);
    expect(event.defaultPrevented).toBe(true);
    expect(els()).toHaveLength(3);
    expect(els()[2]).toMatchObject({ type: "shape", shape: "rectangle" });
  });

  it("pastes our own copy when the clipboard is empty or the event has no data", () => {
    const { shape } = seedTwo();
    render(<Harness />);
    select(shape.id);
    copySelection();
    dispatch(clipboardEvent("paste", { text: "" }).event);
    expect(els()).toHaveLength(3);
    dispatch(clipboardEvent("paste", null).event);
    expect(els()).toHaveLength(4);
  });

  it("pastes text from other apps instead of an older in-app copy", async () => {
    const { shape } = seedTwo();
    render(<Harness />);
    select(shape.id);
    copySelection();
    dispatch(clipboardEvent("paste", { text: "From the web" }).event);
    await vi.waitFor(() => expect(els()).toHaveLength(3));
    expect(els()[2]).toMatchObject({ type: "text", text: "From the web" });
  });

  it("pastes spreadsheet cells as a table", async () => {
    seedTwo();
    render(<Harness />);
    dispatch(clipboardEvent("paste", { text: "a\tb\n1\t2" }).event);
    await vi.waitFor(() => expect(els()).toHaveLength(3));
    expect(els()[2]).toMatchObject({ type: "table", rows: [["a", "b"], ["1", "2"]] });
  });

  it("pastes images from the clipboard", async () => {
    seedTwo();
    render(<Harness />);
    importImageFile.mockResolvedValue({ src: PNG, width: 300, height: 150 });
    const { event } = clipboardEvent("paste", { files: [imageFile()] });
    dispatch(event);
    expect(event.defaultPrevented).toBe(true);
    await vi.waitFor(() => expect(els()).toHaveLength(3));
    expect(els()[2]).toMatchObject({ type: "image", src: PNG, width: 300, height: 150 });
  });

  it("keeps native paste inside fields", () => {
    const { shape } = seedTwo();
    render(<Harness />);
    select(shape.id);
    copySelection();
    const { event } = clipboardEvent("paste", { text: "typed" });
    dispatch(event, screen.getByLabelText("field"));
    expect(event.defaultPrevented).toBe(false);
    expect(els()).toHaveLength(2);
  });

  it("pastes even while page text is selected", () => {
    const { shape } = seedTwo();
    render(<Harness />);
    select(shape.id);
    const entry = copySelection()!;
    mockTextSelection();
    dispatch(clipboardEvent("paste", { token: entry.token }).event);
    expect(els()).toHaveLength(3);
  });
});

describe("useClipboard: keyboard shortcuts", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  const catcher = () => document.querySelector<HTMLTextAreaElement>(`[${CLIPBOARD_CATCHER_ATTR}]`)!;
  const focusCanvas = () => {
    const stage = screen.getByLabelText("canvas");
    act(() => stage.focus());
    return stage;
  };

  it("moves focus to the hidden field with a selection, then copies once and restores focus", () => {
    const { text } = seedTwo();
    render(<Harness />);
    select(text.id);
    const stage = focusCanvas();
    keyDown("c", { ctrlKey: false, metaKey: true }, stage);
    expect(document.activeElement).toBe(catcher());
    expect(catcher().value).toBe(" ");
    expect(catcher().selectionStart).toBe(0);
    expect(catcher().selectionEnd).toBe(1);
    expect(readClipboard()).toBeNull();

    const { event, store } = clipboardEvent("copy");
    dispatch(event, catcher());
    expect(event.defaultPrevented).toBe(true);
    const entry = readClipboard()!;
    expect(entry.payload).toMatchObject({ kind: "elements", elements: [{ id: text.id }] });
    expect(store.get("text/plain")).toBe("Hello");
    expect(store.get(CLIPBOARD_MIME)).toBe(entry.token);
    expect(document.activeElement).toBe(stage);
    expect(catcher().value).toBe("");
  });

  it("cuts with Ctrl/Cmd+X through the hidden field", () => {
    const { text, shape } = seedTwo();
    render(<Harness />);
    select(shape.id);
    keyDown("x", {}, focusCanvas());
    dispatch(clipboardEvent("cut").event, catcher());
    expect(els().map((e) => e.id)).toEqual([text.id]);
    expect(readClipboard()!.payload).toMatchObject({ kind: "elements", elements: [{ id: shape.id }] });
  });

  it("pastes exactly once when the paste event arrives on the hidden field", () => {
    const { shape } = seedTwo();
    render(<Harness />);
    select(shape.id);
    const entry = copySelection()!;
    keyDown("v", { ctrlKey: false, metaKey: true }, focusCanvas());
    const { event } = clipboardEvent("paste", { token: entry.token });
    dispatch(event, catcher());
    expect(event.defaultPrevented).toBe(true);
    act(() => vi.runAllTimers());
    expect(els()).toHaveLength(3);
  });

  it("pastes exactly once when the event arrives late, after focus was given back (macOS menu shortcuts)", () => {
    const { shape } = seedTwo();
    render(<Harness />);
    select(shape.id);
    const entry = copySelection()!;
    const stage = focusCanvas();
    keyDown("v", { ctrlKey: false, metaKey: true }, stage);
    act(() => vi.advanceTimersByTime(CATCHER_RELEASE_MS));
    expect(document.activeElement).toBe(stage);
    expect(els()).toHaveLength(2);
    dispatch(clipboardEvent("paste", { token: entry.token }).event, stage);
    expect(els()).toHaveLength(3);
  });

  it("pastes content from other apps that arrives on the hidden field", () => {
    seedTwo();
    render(<Harness />);
    keyDown("v", {}, focusCanvas());
    dispatch(clipboardEvent("paste", { text: "Name\tScore\nAda\t10" }).event, catcher());
    expect(els()).toHaveLength(3);
    expect(els()[2]).toMatchObject({ type: "table", rows: [["Name", "Score"], ["Ada", "10"]] });
  });

  it("gives focus back and does nothing if no clipboard event follows", () => {
    const { text } = seedTwo();
    render(<Harness />);
    select(text.id);
    const stage = focusCanvas();
    keyDown("c", {}, stage);
    act(() => vi.advanceTimersByTime(CATCHER_RELEASE_MS - 1));
    expect(document.activeElement).toBe(catcher());
    act(() => vi.advanceTimersByTime(1));
    expect(document.activeElement).toBe(stage);
    expect(catcher().value).toBe("");
    expect(readClipboard()).toBeNull();
    expect(els()).toHaveLength(2);
  });

  it("never copies the hidden field's own text when there is nothing to copy", () => {
    const { text } = seedTwo();
    render(<Harness />);
    select(text.id);
    keyDown("c", {}, focusCanvas());
    act(() => editor().selectElement(null));
    const { event, clipboardData } = clipboardEvent("copy");
    dispatch(event, catcher());
    expect(event.defaultPrevented).toBe(true);
    expect(clipboardData!.setData).not.toHaveBeenCalled();
    expect(readClipboard()).toBeNull();
  });

  it("does not paste or complain when the clipboard is empty", () => {
    seedTwo();
    render(<Harness />);
    keyDown("v", {}, focusCanvas());
    dispatch(clipboardEvent("paste", { text: "" }).event, catcher());
    expect(els()).toHaveLength(2);
    expect(toastMessages()).toEqual([]);
  });

  it("copies and cuts the focused slide thumbnail, and gives focus back to it", () => {
    const first = slideWith(createTextElement({ text: "One" }));
    const second = slideWith(createTextElement({ text: "Two" }));
    seedDeck([first, second]);
    render(<Harness thumbId={second.id} />);
    const thumb = screen.getByRole("button", { name: "Thumb" });
    act(() => thumb.focus());
    keyDown("c", {}, thumb);
    const copy = clipboardEvent("copy");
    dispatch(copy.event, catcher());
    expect(readClipboard()!.payload).toMatchObject({ kind: "slides", slides: [{ id: second.id }] });
    expect(copy.store.get("text/plain")).toBe("Two");
    expect(document.activeElement).toBe(thumb);
    keyDown("x", {}, thumb);
    dispatch(clipboardEvent("cut").event, catcher());
    expect(slides().map((s) => s.id)).toEqual([first.id]);
  });

  it("leaves copy and cut native when nothing is selected or page text is selected", () => {
    const { text } = seedTwo();
    render(<Harness />);
    const stage = focusCanvas();
    keyDown("c", {}, stage);
    expect(document.activeElement).toBe(stage);
    select(text.id);
    mockTextSelection();
    keyDown("c", {}, stage);
    keyDown("x", {}, stage);
    expect(document.activeElement).toBe(stage);
    act(() => vi.runAllTimers());
    expect(readClipboard()).toBeNull();
    expect(els()).toHaveLength(2);
  });

  it("ignores other keys, extra modifiers, fields and prevented events", () => {
    const { text } = seedTwo();
    render(<Harness />);
    select(text.id);
    const stage = focusCanvas();
    keyDown("c", { ctrlKey: false }, stage);
    keyDown("c", { shiftKey: true }, stage);
    keyDown("c", { altKey: true }, stage);
    keyDown("b", {}, stage);
    expect(document.activeElement).toBe(stage);
    const field = screen.getByLabelText("field");
    act(() => field.focus());
    keyDown("v", {}, field);
    expect(document.activeElement).toBe(field);
    const prevented = new KeyboardEvent("keydown", { key: "x", ctrlKey: true, bubbles: true, cancelable: true });
    prevented.preventDefault();
    act(() => {
      stage.dispatchEvent(prevented);
    });
    expect(document.activeElement).toBe(field);
    expect(readClipboard()).toBeNull();
    expect(els()).toHaveLength(2);
  });
});

describe("useClipboard: enabling", () => {
  it("does nothing while disabled", () => {
    const { text } = seedTwo();
    render(<Harness enabled={false} />);
    select(text.id);
    const copy = clipboardEvent("copy").event;
    dispatch(copy);
    expect(copy.defaultPrevented).toBe(false);
    const paste = clipboardEvent("paste", { text: "Hi" }).event;
    dispatch(paste);
    expect(paste.defaultPrevented).toBe(false);
    expect(readClipboard()).toBeNull();
    expect(els()).toHaveLength(2);
  });

  it("stops listening when disabled later or unmounted", () => {
    const { text } = seedTwo();
    const { rerender, unmount } = render(<Harness />);
    select(text.id);
    rerender(<Harness enabled={false} />);
    dispatch(clipboardEvent("copy").event);
    expect(readClipboard()).toBeNull();
    rerender(<Harness />);
    dispatch(clipboardEvent("copy").event);
    expect(readClipboard()).not.toBeNull();
    unmount();
    const cut = clipboardEvent("cut").event;
    dispatch(cut);
    expect(cut.defaultPrevented).toBe(false);
    expect(els()).toHaveLength(2);
  });

  it("adds the hidden field only while enabled", () => {
    seedTwo();
    const { rerender, unmount } = render(<Harness enabled={false} />);
    expect(document.querySelector(`[${CLIPBOARD_CATCHER_ATTR}]`)).toBeNull();
    rerender(<Harness />);
    const field = document.querySelector(`[${CLIPBOARD_CATCHER_ATTR}]`);
    expect(field).toHaveAttribute("aria-hidden", "true");
    expect(field).toHaveAttribute("tabindex", "-1");
    unmount();
    expect(document.querySelector(`[${CLIPBOARD_CATCHER_ATTR}]`)).toBeNull();
  });
});
