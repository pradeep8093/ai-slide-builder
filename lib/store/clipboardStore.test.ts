import { afterEach, describe, expect, it, vi } from "vitest";
import { createChartElement, createSlide, createTextElement } from "../factory";
import {
  CLIPBOARD_MIME,
  CLIPBOARD_STORAGE_KEY,
  clearClipboardForTests,
  readClipboard,
  writeClipboard,
  type ClipboardEntry,
  type ClipboardPayload,
} from "./clipboardStore";

afterEach(() => vi.useRealTimers());

function storedEntry(): unknown {
  const raw = window.localStorage.getItem(CLIPBOARD_STORAGE_KEY);
  return raw === null ? null : JSON.parse(raw);
}

/** Simulates another tab writing its copy to localStorage. */
function writeFromOtherTab(payload: ClipboardPayload, at: number, token = "other-tab"): ClipboardEntry {
  const entry: ClipboardEntry = { payload, token, plainText: "from another tab", at };
  window.localStorage.setItem(CLIPBOARD_STORAGE_KEY, JSON.stringify(entry));
  return entry;
}

describe("clipboardStore", () => {
  it("uses a custom MIME type and a namespaced storage key", () => {
    expect(CLIPBOARD_MIME).toBe("application/x-ai-slide-builder");
    expect(CLIPBOARD_STORAGE_KEY).toBe("ai-slide-builder:clipboard");
  });

  it("is empty until something is copied", () => {
    expect(readClipboard()).toBeNull();
  });

  it("stores copied elements in memory and mirrors them to localStorage", () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000);
    const elements = [createTextElement({ text: "Hello" }), createChartElement("bar")];
    const entry = writeClipboard({ kind: "elements", elements }, "Hello");
    expect(entry).toMatchObject({ payload: { kind: "elements", elements }, plainText: "Hello", at: 1_000 });
    expect(entry.token).toEqual(expect.any(String));
    expect(readClipboard()).toEqual(entry);
    expect(storedEntry()).toEqual(entry);
  });

  it("stores copied slides", () => {
    const slide = { ...createSlide("#000000", "Notes"), elements: [createTextElement()] };
    const entry = writeClipboard({ kind: "slides", slides: [slide] }, "");
    expect(readClipboard()?.payload).toEqual({ kind: "slides", slides: [slide] });
    expect(storedEntry()).toEqual(entry);
  });

  it("gives every copy a new token and keeps a snapshot of the payload", () => {
    const element = createTextElement({ text: "Original" });
    const first = writeClipboard({ kind: "elements", elements: [element] }, "Original");
    element.text = "Changed after copying";
    expect(readClipboard()?.payload).toEqual({ kind: "elements", elements: [{ ...element, text: "Original" }] });
    const second = writeClipboard({ kind: "elements", elements: [element] }, "Changed");
    expect(second.token).not.toBe(first.token);
    expect(readClipboard()?.token).toBe(second.token);
  });

  it("prefers a newer copy made in another tab", () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000);
    writeClipboard({ kind: "elements", elements: [createTextElement()] }, "mine");
    const theirs = writeFromOtherTab({ kind: "slides", slides: [createSlide()] }, 2_000);
    expect(readClipboard()).toEqual(theirs);
  });

  it("keeps this tab's copy when the stored one is older", () => {
    vi.useFakeTimers();
    vi.setSystemTime(5_000);
    const mine = writeClipboard({ kind: "elements", elements: [createTextElement()] }, "mine");
    writeFromOtherTab({ kind: "slides", slides: [createSlide()] }, 4_000);
    expect(readClipboard()).toEqual(mine);
  });

  it("reads a stored copy when this tab copied nothing", () => {
    const theirs = writeFromOtherTab({ kind: "elements", elements: [createTextElement()] }, 1);
    expect(readClipboard()).toEqual(theirs);
  });

  it("ignores stored values that aren't valid JSON or a valid copy", () => {
    window.localStorage.setItem(CLIPBOARD_STORAGE_KEY, "{not json");
    expect(readClipboard()).toBeNull();
    window.localStorage.setItem(CLIPBOARD_STORAGE_KEY, JSON.stringify({ payload: { kind: "elements", elements: [] }, token: "t", plainText: "", at: 9e15 }));
    expect(readClipboard()).toBeNull();
    window.localStorage.setItem(CLIPBOARD_STORAGE_KEY, JSON.stringify({ payload: { kind: "elements", elements: [{ type: "video" }] }, token: "t", plainText: "", at: 9e15 }));
    expect(readClipboard()).toBeNull();
    const mine = writeClipboard({ kind: "elements", elements: [createTextElement()] }, "mine");
    window.localStorage.setItem(CLIPBOARD_STORAGE_KEY, JSON.stringify({ ...mine, at: "later" }));
    expect(readClipboard()).toEqual(mine);
  });

  it("keeps the copy in memory when localStorage can't hold it", () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000);
    writeClipboard({ kind: "elements", elements: [createTextElement({ text: "older" })] }, "older");
    expect(storedEntry()).not.toBeNull();
    vi.setSystemTime(2_000);
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("full", "QuotaExceededError");
    });
    const big = writeClipboard({ kind: "elements", elements: [createTextElement({ text: "big" })] }, "big");
    // The stale stored copy is removed so it can't win over the newer in-memory one.
    expect(storedEntry()).toBeNull();
    expect(readClipboard()).toEqual(big);
  });

  it("keeps working when localStorage is blocked entirely", () => {
    const blocked = () => {
      throw new DOMException("denied", "SecurityError");
    };
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(blocked);
    vi.spyOn(Storage.prototype, "removeItem").mockImplementation(blocked);
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(blocked);
    const entry = writeClipboard({ kind: "slides", slides: [createSlide()] }, "");
    expect(readClipboard()).toEqual(entry);
    expect(() => clearClipboardForTests()).not.toThrow();
    expect(readClipboard()).toBeNull();
  });

  it("clearClipboardForTests forgets both the memory and the stored copy", () => {
    writeClipboard({ kind: "elements", elements: [createTextElement()] }, "x");
    clearClipboardForTests();
    expect(storedEntry()).toBeNull();
    expect(readClipboard()).toBeNull();
  });
});
