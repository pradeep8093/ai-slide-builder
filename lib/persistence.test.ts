import { IDBFactory } from "fake-indexeddb";
import { createStore, del, get, keys, set, update, type UseStore } from "idb-keyval";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("idb-keyval", async (importOriginal) => {
  const actual = await importOriginal<typeof import("idb-keyval")>();
  return { ...actual, set: vi.fn(actual.set), get: vi.fn(actual.get), update: vi.fn(actual.update) };
});
import { MAX_ELEMENTS_PER_SLIDE, MAX_NOTES_LENGTH, MAX_SLIDES, MAX_TITLE_LENGTH } from "./constants";
import { createChartElement, createDeck, createImageElement, createShapeElement, createSlide, createTableElement, createTextElement } from "./factory";
import {
  CHANNEL_NAME,
  chatKey,
  createAutoSaver,
  createDeckRecord,
  createTabSync,
  DB_NAME,
  deckKey,
  deleteDeckRecord,
  duplicateDeckRecord,
  INDEX_KEY,
  isPersistent,
  LEGACY_CHAT_KEY,
  LEGACY_DECK_KEY,
  listDecks,
  loadChat,
  loadDeckById,
  recoverDeck,
  renameDeckRecord,
  resetPersistenceForTests,
  saveChat,
  saveDeck,
  STORE_NAME,
  StorageFullError,
  summarizeDeck,
  type DeckSummary,
  type TabMessage,
} from "./persistence";
import type { Deck, Slide, SlideElement } from "./schema";
import type { ChatMessage } from "./store/chatStore";

const PNG = "data:image/png;base64,iVBORw0KGgo=";

let db: UseStore;
const raw = {
  get: (key: string) => get<unknown>(key, db),
  set: (key: string, value: unknown) => set(key, value, db),
  del: (key: string) => del(key, db),
  keys: async () => (await keys(db)).map(String),
};

function useFreshIndexedDb() {
  globalThis.indexedDB = new IDBFactory();
  resetPersistenceForTests();
  db = createStore(DB_NAME, STORE_NAME);
}

function breakIndexedDb() {
  globalThis.indexedDB = {
    open: () => {
      throw new Error("blocked");
    },
  } as unknown as IDBFactory;
  resetPersistenceForTests();
}

function makeDeck(title: string, updatedAt: number, slides: Slide[] = [createSlide()]): Deck {
  return { ...createDeck(title), slides, updatedAt };
}

function message(id: string, overrides: Partial<ChatMessage> = {}): ChatMessage {
  return { id, role: "user", content: `message ${id}`, createdAt: 1, status: "ok", ...overrides };
}

/** A slide using every field that was added after the first release. */
function richSlide(): Slide {
  const image = { ...createImageElement(PNG, 400, 200, "Logo"), crop: { x: 0.1, y: 0.2, width: 0.5, height: 0.4 }, locked: true };
  const text = createTextElement({ text: "Grouped", groupId: "g1" });
  const shape = createShapeElement("ellipse", { groupId: "g1" });
  const table = createTableElement({ rows: [["Name", "Score"], ["Ada", "10"]] });
  const chart = createChartElement("bar", { stacked: true, showValues: true, dualAxis: false });
  return { ...createSlide("#123456", "Remember the demo"), elements: [image, text, shape, table, chart] as SlideElement[] };
}

beforeEach(() => {
  useFreshIndexedDb();
});

describe("storage backend", () => {
  it("reports IndexedDB as persistent", async () => {
    await expect(isPersistent()).resolves.toBe(true);
    await expect(listDecks()).resolves.toEqual({ persistent: true, decks: [] });
  });

  it("falls back to memory (non-persistent) when IndexedDB can't be opened", async () => {
    breakIndexedDb();
    await expect(isPersistent()).resolves.toBe(false);
    const deck = makeDeck("In memory", 10);
    await saveDeck(deck);
    await saveChat(deck.id, [message("1")]);
    await expect(loadDeckById(deck.id)).resolves.toEqual({ status: "ok", deck, persistent: false });
    await expect(loadChat(deck.id)).resolves.toEqual([message("1")]);
    const listed = await listDecks();
    expect(listed.persistent).toBe(false);
    expect(listed.decks.map((d) => d.id)).toEqual([deck.id]);
    await deleteDeckRecord(deck.id);
    await expect(loadDeckById(deck.id)).resolves.toEqual({ status: "missing", persistent: false });
    await expect(loadChat(deck.id)).resolves.toEqual([]);
    await expect(listDecks()).resolves.toEqual({ persistent: false, decks: [] });
  });

  it("stores copies in memory so later mutations don't leak into saved data", async () => {
    breakIndexedDb();
    const deck = makeDeck("Original", 10);
    await saveDeck(deck);
    deck.title = "Mutated after saving";
    const first = await loadDeckById(deck.id);
    if (first.status !== "ok") throw new Error("expected ok");
    expect(first.deck.title).toBe("Original");
    first.deck.title = "Mutated after loading";
    const second = await loadDeckById(deck.id);
    expect(second.status === "ok" && second.deck.title).toBe("Original");
  });

  it("forgets the in-memory fallback on reset", async () => {
    breakIndexedDb();
    const deck = makeDeck("Gone", 10);
    await saveDeck(deck);
    resetPersistenceForTests();
    await expect(loadDeckById(deck.id)).resolves.toEqual({ status: "missing", persistent: false });
  });

  it("maps quota errors to StorageFullError and rethrows other write errors", async () => {
    await isPersistent();
    vi.mocked(set).mockRejectedValueOnce(new DOMException("full", "QuotaExceededError"));
    const error = await saveDeck(makeDeck("Big", 1)).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(StorageFullError);
    expect(error).toMatchObject({ name: "StorageFullError", message: expect.stringMatching(/storage is full/i) });

    vi.mocked(update).mockRejectedValueOnce(new DOMException("full", "QuotaExceededError"));
    await expect(saveDeck(makeDeck("Index", 1))).rejects.toBeInstanceOf(StorageFullError);

    vi.mocked(set).mockRejectedValueOnce(new DOMException("other", "DataCloneError"));
    await expect(saveDeck(makeDeck("Clone", 1))).rejects.toMatchObject({ name: "DataCloneError" });
    vi.mocked(set).mockRejectedValueOnce(new Error("disk on fire"));
    await expect(saveChat("d", [])).rejects.toThrow("disk on fire");
    vi.mocked(set).mockRejectedValueOnce(new DOMException("full", "QuotaExceededError"));
    await expect(saveChat("d", [message("1")])).rejects.toBeInstanceOf(StorageFullError);
  });
});

describe("listDecks", () => {
  it("lists summaries newest first", async () => {
    const a = makeDeck("Alpha", 100, [createSlide("#111111"), createSlide()]);
    const b = makeDeck("Beta", 300, []);
    const c = makeDeck("Gamma", 200);
    for (const deck of [a, b, c]) await saveDeck(deck);
    const { persistent, decks } = await listDecks();
    expect(persistent).toBe(true);
    expect(decks.map((d) => d.title)).toEqual(["Beta", "Gamma", "Alpha"]);
    expect(decks[2]).toEqual<DeckSummary>({ id: a.id, title: "Alpha", createdAt: 100, updatedAt: 100, slideCount: 2, firstSlide: a.slides[0] });
    expect(decks[0]).toMatchObject({ slideCount: 0, firstSlide: null });
  });

  it("keeps the creation time when a deck is saved again", async () => {
    const deck = makeDeck("Draft", 100);
    await saveDeck(deck);
    await saveDeck({ ...deck, title: "Final", updatedAt: 500, slides: [...deck.slides, createSlide()] });
    const { decks } = await listDecks();
    expect(decks).toHaveLength(1);
    expect(decks[0]).toMatchObject({ title: "Final", createdAt: 100, updatedAt: 500, slideCount: 2 });
  });

  it("adds decks that are missing from the index and saves the repaired index", async () => {
    const deck = makeDeck("Orphan", 42);
    await raw.set(deckKey(deck.id), deck);
    const { decks } = await listDecks();
    expect(decks).toEqual([summarizeDeck(deck)]);
    expect(await raw.get(INDEX_KEY)).toEqual([summarizeDeck(deck)]);
  });

  it("lists a recovered orphan deck under the id it is stored with", async () => {
    await raw.set(deckKey("orphan"), { title: "No id", slides: [createSlide()] });
    const { decks } = await listDecks();
    expect(decks.map((d) => d.id)).toEqual(["orphan"]);
    await expect(loadDeckById(decks[0].id)).resolves.toMatchObject({ status: "recovered" });
  });

  it("drops index entries whose deck no longer exists", async () => {
    const keep = makeDeck("Keep", 2);
    const gone = makeDeck("Gone", 1);
    await saveDeck(keep);
    await saveDeck(gone);
    await raw.del(deckKey(gone.id));
    const { decks } = await listDecks();
    expect(decks.map((d) => d.id)).toEqual([keep.id]);
    expect((await raw.get(INDEX_KEY)) as DeckSummary[]).toHaveLength(1);
  });

  it("skips unreadable decks and invalid index entries without rewriting the index", async () => {
    const deck = makeDeck("Fine", 5);
    await saveDeck(deck);
    const index = (await raw.get(INDEX_KEY)) as DeckSummary[];
    await raw.set(INDEX_KEY, [...index, { id: "", title: 3 }, "junk"]);
    await raw.set(deckKey("broken"), "garbage");
    const { decks } = await listDecks();
    expect(decks.map((d) => d.id)).toEqual([deck.id]);
  });

  it("rebuilds the index when the stored index isn't a list", async () => {
    const deck = makeDeck("Fine", 5);
    await saveDeck(deck);
    await raw.set(INDEX_KEY, "not a list");
    const { decks } = await listDecks();
    expect(decks.map((d) => d.id)).toEqual([deck.id]);
    expect(await raw.get(INDEX_KEY)).toEqual([summarizeDeck(deck)]);
  });
});

describe("loadDeckById", () => {
  it("returns a saved deck unchanged, including notes, tables, crops, locks and groups", async () => {
    const deck = makeDeck("Rich", 7, [richSlide()]);
    await saveDeck(deck);
    const result = await loadDeckById(deck.id);
    expect(result).toEqual({ status: "ok", deck, persistent: true });
  });

  it("loads decks saved before speaker notes existed", async () => {
    const deck = makeDeck("Old", 7);
    const slideWithoutNotes: Partial<Slide> = { ...deck.slides[0] };
    delete slideWithoutNotes.notes;
    await raw.set(deckKey(deck.id), { ...deck, slides: [slideWithoutNotes] });
    const result = await loadDeckById(deck.id);
    expect(result.status).toBe("ok");
    expect(result.status === "ok" && result.deck.slides[0].notes).toBe("");
  });

  it("reports missing decks", async () => {
    await expect(loadDeckById("nope")).resolves.toEqual({ status: "missing", persistent: true });
  });

  it("recovers what it can under the requested id and keeps a backup of the original", async () => {
    const good = createTextElement();
    const value = { version: 1, title: "T", updatedAt: 1, slides: [{ id: "s", background: "nope", elements: [good, { type: "video" }] }, 42] };
    await raw.set(deckKey("d1"), value);
    const result = await loadDeckById("d1");
    expect(result.status).toBe("recovered");
    if (result.status !== "recovered") return;
    expect(result.persistent).toBe(true);
    expect(result.dropped).toBe(2);
    expect(result.deck.id).toBe("d1");
    expect(result.deck.slides).toEqual([{ id: "s", background: "#ffffff", elements: [good], notes: "" }]);
    const backups = (await raw.keys()).filter((k) => k.startsWith("backup:d1:"));
    expect(backups).toHaveLength(1);
    expect(await raw.get(backups[0])).toEqual(value);
  });

  it("reports unusable data as corrupt and keeps a backup", async () => {
    await raw.set(deckKey("bad"), "garbage");
    await expect(loadDeckById("bad")).resolves.toEqual({ status: "corrupt", persistent: true });
    const backups = (await raw.keys()).filter((k) => k.startsWith("backup:bad:"));
    expect(backups).toHaveLength(1);
    expect(await raw.get(backups[0])).toBe("garbage");
  });

  it("still reports corrupt data when the backup can't be written", async () => {
    await raw.set(deckKey("bad"), { slides: "nope" });
    await isPersistent();
    vi.mocked(set).mockRejectedValueOnce(new DOMException("full", "QuotaExceededError"));
    await expect(loadDeckById("bad")).resolves.toEqual({ status: "corrupt", persistent: true });
  });
});

describe("deck records", () => {
  it("saveDeck writes the deck and upserts its summary", async () => {
    const deck = makeDeck("One", 1);
    await saveDeck(deck);
    await saveDeck({ ...deck, title: "Renamed", updatedAt: 2 });
    expect(await raw.get(deckKey(deck.id))).toMatchObject({ title: "Renamed" });
    expect(await raw.get(INDEX_KEY)).toEqual([expect.objectContaining({ id: deck.id, title: "Renamed", createdAt: 1, updatedAt: 2 })]);
  });

  it("creates empty and pre-filled decks", async () => {
    const empty = await createDeckRecord();
    expect(empty).toMatchObject({ title: "", slides: [] });
    const slide = createSlide();
    const filled = await createDeckRecord({ title: "Plan", slides: [slide] });
    expect(filled).toMatchObject({ title: "Plan", slides: [slide] });
    expect(filled.id).not.toBe(empty.id);
    await expect(loadDeckById(filled.id)).resolves.toEqual({ status: "ok", deck: filled, persistent: true });
    const { decks } = await listDecks();
    expect(decks.map((d) => d.id).sort()).toEqual([empty.id, filled.id].sort());
  });

  it("duplicates a deck with new ids, a 'Copy of' title and a fresh chat", async () => {
    const source = makeDeck("Quarterly", 5, [richSlide(), createSlide()]);
    await saveDeck(source);
    await saveChat(source.id, [message("1")]);
    const copy = await duplicateDeckRecord(source);
    expect(copy.title).toBe("Copy of Quarterly");
    expect(copy.id).not.toBe(source.id);
    expect(copy.slides).toHaveLength(2);
    copy.slides.forEach((slide, i) => {
      expect(slide.id).not.toBe(source.slides[i].id);
      expect(slide.notes).toBe(source.slides[i].notes);
      expect(slide.background).toBe(source.slides[i].background);
    });
    const [image, text, shape, table] = copy.slides[0].elements;
    expect(copy.slides[0].elements.map((e) => e.id)).not.toContain(source.slides[0].elements[0].id);
    expect(image).toMatchObject({ type: "image", locked: true, crop: { x: 0.1, y: 0.2, width: 0.5, height: 0.4 } });
    expect(text.groupId).toBeTruthy();
    expect(text.groupId).not.toBe("g1");
    expect(shape.groupId).toBe(text.groupId);
    expect(table).toMatchObject({ type: "table", rows: [["Name", "Score"], ["Ada", "10"]] });
    await expect(loadChat(copy.id)).resolves.toEqual([]);
    await expect(loadChat(source.id)).resolves.toEqual([message("1")]);
    await expect(loadDeckById(copy.id)).resolves.toEqual({ status: "ok", deck: copy, persistent: true });
    await expect(loadDeckById(source.id)).resolves.toEqual({ status: "ok", deck: source, persistent: true });
  });

  it("names copies of untitled decks and keeps long titles within the limit", async () => {
    expect((await duplicateDeckRecord(makeDeck("   ", 1))).title).toBe("Copy of Untitled presentation");
    const long = await duplicateDeckRecord(makeDeck("x".repeat(MAX_TITLE_LENGTH), 1));
    expect(long.title).toHaveLength(MAX_TITLE_LENGTH);
    expect(long.title.startsWith("Copy of x")).toBe(true);
  });

  it("renames a deck, trimming and limiting the title", async () => {
    const deck = makeDeck("Old", 1);
    await saveDeck(deck);
    const renamed = await renameDeckRecord(deck.id, `  ${"n".repeat(MAX_TITLE_LENGTH + 10)}  `);
    expect(renamed?.title).toBe("n".repeat(MAX_TITLE_LENGTH));
    expect(renamed?.updatedAt).toBeGreaterThan(1);
    expect(renamed?.slides).toEqual(deck.slides);
    const { decks } = await listDecks();
    expect(decks[0]).toMatchObject({ title: "n".repeat(MAX_TITLE_LENGTH), createdAt: 1 });
    await expect(loadDeckById(deck.id)).resolves.toMatchObject({ status: "ok", deck: { title: "n".repeat(MAX_TITLE_LENGTH) } });
  });

  it("does not rename missing or corrupt decks", async () => {
    await expect(renameDeckRecord("missing", "X")).resolves.toBeNull();
    await raw.set(deckKey("bad"), "garbage");
    await expect(renameDeckRecord("bad", "X")).resolves.toBeNull();
    expect(await raw.get(deckKey("bad"))).toBe("garbage");
    expect(await raw.get(INDEX_KEY)).toBeUndefined();
  });

  it("deletes a deck together with its chat and index entry", async () => {
    const keep = makeDeck("Keep", 1);
    const remove = makeDeck("Remove", 2);
    await saveDeck(keep);
    await saveDeck(remove);
    await saveChat(keep.id, [message("k")]);
    await saveChat(remove.id, [message("r")]);
    await deleteDeckRecord(remove.id);
    expect(await raw.get(deckKey(remove.id))).toBeUndefined();
    expect(await raw.get(chatKey(remove.id))).toBeUndefined();
    expect(((await raw.get(INDEX_KEY)) as DeckSummary[]).map((s) => s.id)).toEqual([keep.id]);
    await expect(loadChat(keep.id)).resolves.toEqual([message("k")]);
    await expect(deleteDeckRecord("never-existed")).resolves.toBeUndefined();
    expect((await listDecks()).decks.map((d) => d.id)).toEqual([keep.id]);
  });
});

describe("legacy single-deck migration", () => {
  it("moves the old deck and chat into multi-deck storage", async () => {
    const deck = makeDeck("Legacy", 9);
    await raw.set(LEGACY_DECK_KEY, deck);
    await raw.set(LEGACY_CHAT_KEY, [message("1")]);
    const { decks } = await listDecks();
    expect(decks).toEqual([summarizeDeck(deck)]);
    await expect(loadDeckById(deck.id)).resolves.toEqual({ status: "ok", deck, persistent: true });
    await expect(loadChat(deck.id)).resolves.toEqual([message("1")]);
    const allKeys = await raw.keys();
    expect(allKeys).not.toContain(LEGACY_DECK_KEY);
    expect(allKeys).not.toContain(LEGACY_CHAT_KEY);
  });

  it("migrates on loadDeckById too and recovers partially invalid legacy decks", async () => {
    const good = createTextElement();
    await raw.set(LEGACY_DECK_KEY, { version: 1, id: "legacy", title: "Old", updatedAt: 1, slides: [{ id: "s", background: "#000000", elements: [good, { type: "nope" }] }] });
    const result = await loadDeckById("legacy");
    expect(result.status).toBe("ok");
    expect(result.status === "ok" && result.deck.slides[0].elements).toEqual([good]);
    expect(await raw.get(LEGACY_DECK_KEY)).toBeUndefined();
  });

  it("doesn't overwrite a deck that was already migrated", async () => {
    const deck = makeDeck("Current", 50);
    await saveDeck(deck);
    await saveChat(deck.id, [message("new")]);
    await raw.set(LEGACY_DECK_KEY, { ...deck, title: "Stale", updatedAt: 1 });
    await raw.set(LEGACY_CHAT_KEY, [message("old")]);
    await listDecks();
    await expect(loadDeckById(deck.id)).resolves.toMatchObject({ status: "ok", deck: { title: "Current" } });
    await expect(loadChat(deck.id)).resolves.toEqual([message("new")]);
    expect(await raw.get(LEGACY_DECK_KEY)).toBeUndefined();
    expect(await raw.get(LEGACY_CHAT_KEY)).toBeUndefined();
  });

  it("backs up an unusable legacy deck and removes the old keys", async () => {
    await raw.set(LEGACY_DECK_KEY, "garbage");
    await raw.set(LEGACY_CHAT_KEY, [message("1")]);
    await expect(listDecks()).resolves.toEqual({ persistent: true, decks: [] });
    const allKeys = await raw.keys();
    const backup = allKeys.find((k) => k.startsWith("backup:legacy:"));
    expect(backup).toBeDefined();
    expect(await raw.get(backup as string)).toBe("garbage");
    expect(allKeys).not.toContain(LEGACY_DECK_KEY);
    expect(allKeys).not.toContain(LEGACY_CHAT_KEY);
  });
});

describe("chat history", () => {
  it("round-trips messages per deck", async () => {
    const assistant = message("2", { role: "assistant", status: "ok", changes: ["Added slide 2"], skipped: [{ op: "delete_slide", reason: "locked" }] });
    await saveChat("a", [message("1"), assistant]);
    await saveChat("b", [message("3", { status: "stopped" })]);
    await expect(loadChat("a")).resolves.toEqual([message("1"), assistant]);
    await expect(loadChat("b")).resolves.toEqual([message("3", { status: "stopped" })]);
    await expect(loadChat("c")).resolves.toEqual([]);
  });

  it("drops invalid messages and ignores values that aren't lists", async () => {
    await raw.set(chatKey("a"), [message("1"), { nope: true }, message("2", { status: "weird" as ChatMessage["status"] }), null]);
    await expect(loadChat("a")).resolves.toEqual([message("1")]);
    await raw.set(chatKey("a"), "x");
    await expect(loadChat("a")).resolves.toEqual([]);
  });

  it("returns an empty history when reading fails", async () => {
    await isPersistent();
    vi.mocked(get).mockRejectedValueOnce(new Error("read failed"));
    await expect(loadChat("a")).resolves.toEqual([]);
  });
});

describe("recoverDeck", () => {
  it("returns null for values without a slide list", () => {
    expect(recoverDeck(null)).toBeNull();
    expect(recoverDeck("deck")).toBeNull();
    expect(recoverDeck({ title: "x" })).toBeNull();
    expect(recoverDeck({ slides: "nope" })).toBeNull();
  });

  it("fills in missing ids, titles, backgrounds and notes", () => {
    const result = recoverDeck({ slides: [{ elements: "bad", notes: 42 }] });
    expect(result?.dropped).toBe(0);
    expect(result?.deck).toMatchObject({ version: 1, title: "" });
    expect(result?.deck.id).toBeTruthy();
    expect(result?.deck.slides[0]).toMatchObject({ background: "#ffffff", elements: [], notes: "" });
    expect(result?.deck.slides[0].id).toBeTruthy();
  });

  it("drops invalid slides and elements and counts them", () => {
    const good = createTextElement();
    const result = recoverDeck({ id: "d", title: "T", slides: [{ id: "s", background: "#ABC", elements: [good, { type: "video" }, { ...good, width: -5 }] }, 42, null] });
    expect(result?.dropped).toBe(4);
    expect(result?.deck.slides).toEqual([{ id: "s", background: "#aabbcc", elements: [good], notes: "" }]);
  });

  it("keeps notes, tables, crops, locks and groups", () => {
    const slide = richSlide();
    const result = recoverDeck({ id: "d", title: 5, slides: [slide, { bogus: true }] });
    expect(result?.deck.title).toBe("");
    expect(result?.deck.slides[0]).toEqual(slide);
    expect(result?.deck.slides[1]).toMatchObject({ elements: [], notes: "" });
  });

  it("enforces the slide, element, title and notes limits", () => {
    const slides = Array.from({ length: MAX_SLIDES + 3 }, () => createSlide());
    slides[0] = { ...slides[0], notes: "n".repeat(MAX_NOTES_LENGTH + 50), elements: Array.from({ length: MAX_ELEMENTS_PER_SLIDE + 2 }, () => createTextElement()) };
    const result = recoverDeck({ id: "d", title: "t".repeat(MAX_TITLE_LENGTH + 5), slides });
    expect(result?.deck.slides).toHaveLength(MAX_SLIDES);
    expect(result?.deck.slides[0].elements).toHaveLength(MAX_ELEMENTS_PER_SLIDE);
    expect(result?.deck.slides[0].notes).toHaveLength(MAX_NOTES_LENGTH);
    expect(result?.deck.title).toHaveLength(MAX_TITLE_LENGTH);
    expect(result?.dropped).toBe(5);
  });

  it("sanitizes recovered elements", () => {
    const offCanvas = createShapeElement("rectangle", { x: 99_999, y: -99_999 });
    const result = recoverDeck({ slides: [{ id: "s", background: "#000000", elements: [offCanvas] }] });
    const el = result?.deck.slides[0].elements[0];
    expect(el?.x).toBeLessThan(2000);
    expect(el?.y).toBeGreaterThan(-1000);
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
    await vi.advanceTimersByTimeAsync(60);
    saver.schedule(2);
    await vi.advanceTimersByTimeAsync(60);
    saver.schedule(3);
    expect(save).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(150);
    expect(save).toHaveBeenCalledTimes(1);
    expect(save).toHaveBeenCalledWith(3);
    expect(statuses).toEqual(["saving", "saved"]);
  });

  it("never runs two saves at once, writes the newest value last and reports 'saved' only at the end", async () => {
    let resolveFirst: () => void = () => undefined;
    const save = vi
      .fn()
      .mockImplementationOnce(() => new Promise<void>((r) => (resolveFirst = r)))
      .mockResolvedValue(undefined);
    const statuses: string[] = [];
    const saver = createAutoSaver<number>({ save, delay: 10, onStatus: (s) => statuses.push(s) });
    saver.schedule(1);
    await vi.advanceTimersByTimeAsync(20);
    saver.schedule(2);
    await vi.advanceTimersByTimeAsync(20);
    expect(save).toHaveBeenCalledTimes(1);
    resolveFirst();
    await vi.advanceTimersByTimeAsync(0);
    await vi.waitFor(() => expect(save).toHaveBeenCalledTimes(2));
    expect(save).toHaveBeenLastCalledWith(2);
    await vi.advanceTimersByTimeAsync(50);
    expect(save).toHaveBeenCalledTimes(2);
    expect(statuses).toEqual(["saving", "saving", "saved"]);
  });

  it("reports errors and keeps saving later values", async () => {
    const save = vi.fn().mockRejectedValueOnce(new Error("nope")).mockResolvedValue(undefined);
    const onStatus = vi.fn();
    const saver = createAutoSaver<number>({ save, delay: 10_000, onStatus });
    saver.schedule(7);
    await saver.flush();
    expect(save).toHaveBeenCalledWith(7);
    expect(onStatus).toHaveBeenLastCalledWith("error", expect.any(Error));
    saver.schedule(8);
    await saver.flush();
    expect(onStatus).toHaveBeenLastCalledWith("saved");
  });

  it("flush writes immediately, cancels the timer and does nothing when idle", async () => {
    const save = vi.fn().mockResolvedValue(undefined);
    const saver = createAutoSaver<number>({ save, delay: 1000 });
    await saver.flush();
    expect(save).not.toHaveBeenCalled();
    saver.schedule(1);
    await saver.flush();
    expect(save).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(2000);
    expect(save).toHaveBeenCalledTimes(1);
  });

  it("flush waits for a save that is already running", async () => {
    let resolveFirst: () => void = () => undefined;
    const save = vi.fn().mockImplementationOnce(() => new Promise<void>((r) => (resolveFirst = r)));
    const saver = createAutoSaver<number>({ save, delay: 10 });
    saver.schedule(1);
    await vi.advanceTimersByTimeAsync(20);
    let flushed = false;
    const flushing = saver.flush().then(() => (flushed = true));
    await vi.advanceTimersByTimeAsync(0);
    expect(flushed).toBe(false);
    resolveFirst();
    await flushing;
    expect(flushed).toBe(true);
  });

  it("dispose stops the timer and ignores later schedules, but flush still writes what was scheduled", async () => {
    const save = vi.fn().mockResolvedValue(undefined);
    const saver = createAutoSaver<number>({ save, delay: 10 });
    saver.schedule(1);
    saver.dispose();
    saver.schedule(2);
    await vi.advanceTimersByTimeAsync(50);
    expect(save).not.toHaveBeenCalled();
    await saver.flush();
    expect(save).toHaveBeenCalledTimes(1);
    expect(save).toHaveBeenCalledWith(1);
  });

  it("discard drops unwritten values and ignores later schedules", async () => {
    const save = vi.fn().mockResolvedValue(undefined);
    const onStatus = vi.fn();
    const saver = createAutoSaver<number>({ save, delay: 10, onStatus });
    saver.schedule(1);
    saver.discard();
    saver.schedule(2);
    await vi.advanceTimersByTimeAsync(50);
    await saver.flush();
    expect(save).not.toHaveBeenCalled();
    expect(onStatus).not.toHaveBeenCalled();
  });
});

describe("createTabSync", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("notifies other tabs but not itself", async () => {
    const own: TabMessage[] = [];
    const received: TabMessage[] = [];
    const a = createTabSync((m) => own.push(m));
    const b = createTabSync((m) => received.push(m));
    expect(a.tabId).not.toBe(b.tabId);
    a.post({ type: "deck-saved", deckId: "d1", updatedAt: 123 });
    a.post({ type: "deck-deleted", deckId: "d2" });
    a.post({ type: "decks-changed" });
    await vi.waitFor(() => expect(received).toHaveLength(3));
    expect(received).toEqual([
      { type: "deck-saved", deckId: "d1", updatedAt: 123, tabId: a.tabId },
      { type: "deck-deleted", deckId: "d2", tabId: a.tabId },
      { type: "decks-changed", tabId: a.tabId },
    ]);
    expect(own).toEqual([]);
    a.close();
    b.close();
  });

  it("ignores malformed messages and messages carrying its own tab id", async () => {
    const received: TabMessage[] = [];
    const sync = createTabSync((m) => received.push(m));
    const other = new BroadcastChannel(CHANNEL_NAME);
    other.postMessage("junk");
    other.postMessage(null);
    other.postMessage({ tabId: "x" });
    other.postMessage({ type: "decks-changed", tabId: sync.tabId });
    other.postMessage({ type: "decks-changed", tabId: "other-tab" });
    await vi.waitFor(() => expect(received).toHaveLength(1));
    await new Promise((r) => setTimeout(r, 20));
    expect(received).toEqual([{ type: "decks-changed", tabId: "other-tab" }]);
    other.close();
    sync.close();
  });

  it("stops listening after close", async () => {
    const closedReceived: TabMessage[] = [];
    const openReceived: TabMessage[] = [];
    const sender = createTabSync(() => undefined);
    const closed = createTabSync((m) => closedReceived.push(m));
    const open = createTabSync((m) => openReceived.push(m));
    closed.close();
    sender.post({ type: "decks-changed" });
    await vi.waitFor(() => expect(openReceived).toHaveLength(1));
    expect(closedReceived).toEqual([]);
    sender.close();
    open.close();
  });

  it("works without BroadcastChannel", () => {
    vi.stubGlobal("BroadcastChannel", undefined);
    const sync = createTabSync(() => undefined);
    expect(typeof sync.tabId).toBe("string");
    expect(() => sync.post({ type: "decks-changed" })).not.toThrow();
    expect(() => sync.close()).not.toThrow();
  });
});
