import { IDBFactory } from "fake-indexeddb";
import { del, get, set, createStore } from "idb-keyval";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("idb-keyval", async (importOriginal) => {
  const actual = await importOriginal<typeof import("idb-keyval")>();
  return { ...actual, set: vi.fn(actual.set) };
});
import { createChartElement, createDeck, createSlide, createTextElement } from "./factory";
import {
  CHAT_KEY,
  createAutoSaver,
  createTabSync,
  DB_NAME,
  DECK_KEY,
  loadChat,
  loadDeck,
  recoverDeck,
  resetPersistenceForTests,
  saveChat,
  saveDeck,
  STORE_NAME,
  StorageFullError,
  type TabMessage,
} from "./persistence";
import type { ChatMessage } from "./store/chatStore";

const rawStore = () => createStore(DB_NAME, STORE_NAME);

describe("deck storage", () => {
  beforeEach(() => {
    globalThis.indexedDB = new IDBFactory();
    resetPersistenceForTests();
  });

  it("returns a fresh deck when nothing is saved", async () => {
    const result = await loadDeck();
    expect(result.status).toBe("empty");
    expect(result.deck.slides).toEqual([]);
  });

  it("round-trips a deck", async () => {
    const deck = { ...createDeck("Saved"), slides: [{ ...createSlide(), elements: [createTextElement(), createChartElement("pie")] }] };
    await saveDeck(deck);
    const result = await loadDeck();
    expect(result).toEqual({ status: "ok", deck });
  });

  it("recovers what it can from a partially invalid deck and keeps a backup", async () => {
    const good = createTextElement();
    await set(
      DECK_KEY,
      { version: 1, id: "d", title: "T", updatedAt: 1, slides: [{ id: "s", background: "nope", elements: [good, { type: "video" }] }, 42] },
      rawStore(),
    );
    const result = await loadDeck();
    expect(result.status).toBe("recovered");
    if (result.status !== "recovered") return;
    expect(result.dropped).toBe(2);
    expect(result.deck.slides).toHaveLength(1);
    expect(result.deck.slides[0]).toMatchObject({ id: "s", background: "#ffffff", elements: [good] });
    const { keys } = await import("idb-keyval");
    const allKeys = (await keys(rawStore())) as string[];
    expect(allKeys.some((k) => k.startsWith(`${DECK_KEY}-backup-`))).toBe(true);
  });

  it("starts over when the saved value is unusable", async () => {
    await set(DECK_KEY, "garbage", rawStore());
    const result = await loadDeck();
    expect(result.status).toBe("corrupt");
    expect(result.deck.slides).toEqual([]);
  });

  it("reports when IndexedDB is unavailable", async () => {
    globalThis.indexedDB = {
      open: () => {
        throw new Error("blocked");
      },
    } as unknown as IDBFactory;
    resetPersistenceForTests();
    const result = await loadDeck();
    expect(result.status).toBe("unavailable");
    await expect(loadChat()).resolves.toEqual([]);
  });

  it("maps quota errors to StorageFullError", async () => {
    vi.mocked(set).mockRejectedValueOnce(new DOMException("full", "QuotaExceededError"));
    await expect(saveDeck(createDeck())).rejects.toBeInstanceOf(StorageFullError);
    vi.mocked(set).mockRejectedValueOnce(new Error("other"));
    await expect(saveDeck(createDeck())).rejects.toThrow("other");
  });

  it("round-trips chat and drops invalid messages", async () => {
    const message: ChatMessage = { id: "1", role: "user", content: "hi", createdAt: 1, status: "ok" };
    await saveChat([message]);
    expect(await loadChat()).toEqual([message]);
    await set(CHAT_KEY, [message, { nope: true }], rawStore());
    expect(await loadChat()).toEqual([message]);
    await set(CHAT_KEY, "x", rawStore());
    expect(await loadChat()).toEqual([]);
    await del(CHAT_KEY, rawStore());
    expect(await loadChat()).toEqual([]);
    expect(await get(CHAT_KEY, rawStore())).toBeUndefined();
  });
});

describe("recoverDeck", () => {
  it("returns null for values without slides", () => {
    expect(recoverDeck(null)).toBeNull();
    expect(recoverDeck({ title: "x" })).toBeNull();
  });
  it("fills in missing ids and titles", () => {
    const result = recoverDeck({ slides: [{ elements: "bad" }] });
    expect(result?.deck.title).toBe("");
    expect(result?.deck.slides[0].id).toBeTruthy();
    expect(result?.deck.slides[0].elements).toEqual([]);
  });
});

describe("createAutoSaver", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("debounces and saves only the latest value", async () => {
    const save = vi.fn().mockResolvedValue(undefined);
    const statuses: string[] = [];
    const saver = createAutoSaver<number>({ save, delay: 100, onStatus: (s) => statuses.push(s) });
    saver.schedule(1);
    saver.schedule(2);
    saver.schedule(3);
    await vi.advanceTimersByTimeAsync(150);
    expect(save).toHaveBeenCalledTimes(1);
    expect(save).toHaveBeenCalledWith(3);
    expect(statuses).toEqual(["saving", "saved"]);
  });

  it("never runs two saves at once and writes the newest value last", async () => {
    let resolveFirst: () => void = () => undefined;
    const save = vi.fn().mockImplementationOnce(() => new Promise<void>((r) => (resolveFirst = r))).mockResolvedValue(undefined);
    const saver = createAutoSaver<number>({ save, delay: 10 });
    saver.schedule(1);
    await vi.advanceTimersByTimeAsync(20);
    saver.schedule(2);
    await vi.advanceTimersByTimeAsync(20);
    expect(save).toHaveBeenCalledTimes(1);
    resolveFirst();
    await vi.advanceTimersByTimeAsync(0);
    await vi.waitFor(() => expect(save).toHaveBeenCalledTimes(2));
    expect(save).toHaveBeenLastCalledWith(2);
  });

  it("reports errors and lets flush write immediately", async () => {
    const save = vi.fn().mockRejectedValue(new Error("nope"));
    const onStatus = vi.fn();
    const saver = createAutoSaver<number>({ save, delay: 10_000, onStatus });
    saver.schedule(7);
    await saver.flush();
    expect(save).toHaveBeenCalledWith(7);
    expect(onStatus).toHaveBeenLastCalledWith("error", expect.any(Error));
  });

  it("ignores schedules after dispose", async () => {
    const save = vi.fn().mockResolvedValue(undefined);
    const saver = createAutoSaver<number>({ save, delay: 10 });
    saver.schedule(1);
    saver.dispose();
    saver.schedule(2);
    await vi.advanceTimersByTimeAsync(50);
    expect(save).not.toHaveBeenCalled();
  });
});

describe("createTabSync", () => {
  it("notifies other tabs but not itself", async () => {
    const received: TabMessage[] = [];
    const a = createTabSync(() => received.push({ type: "deck-saved", tabId: "self", updatedAt: -1 }));
    const b = createTabSync((m) => received.push(m));
    a.notifySaved(123);
    await vi.waitFor(() => expect(received).toHaveLength(1));
    expect(received[0]).toMatchObject({ type: "deck-saved", tabId: a.tabId, updatedAt: 123 });
    a.close();
    b.close();
  });

  it("works without BroadcastChannel", () => {
    vi.stubGlobal("BroadcastChannel", undefined);
    const sync = createTabSync(() => undefined);
    expect(() => sync.notifySaved(1)).not.toThrow();
    sync.close();
    vi.unstubAllGlobals();
  });
});
