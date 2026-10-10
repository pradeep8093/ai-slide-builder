import { createStore, del, get, keys, set, update, type UseStore } from "idb-keyval";
import { z } from "zod";
import { MAX_ELEMENTS_PER_SLIDE, MAX_SLIDES, MAX_TITLE_LENGTH } from "./constants";
import { normalizeColor } from "./color";
import { cloneSlide, createDeck } from "./factory";
import { createId } from "./ids";
import { sanitizeElement } from "./sanitize";
import { deckSchema, slideElementSchema, slideSchema, type Deck, type Slide, type SlideElement } from "./schema";
import type { ChatMessage } from "./store/chatStore";

/*
 * Everything is stored in the browser's IndexedDB:
 *   deck-index      summaries of all presentations (for the dashboard)
 *   deck:<id>       one presentation
 *   chat:<id>       its AI chat history
 * If IndexedDB is unavailable (some private modes), the same API keeps data in memory for the
 * session and reports `persistent: false` so the UI can warn that nothing will be kept.
 */

export const DB_NAME = "ai-slide-builder";
export const STORE_NAME = "state";
export const INDEX_KEY = "deck-index";
/** Keys used by the first version (single deck); migrated on first load. */
export const LEGACY_DECK_KEY = "deck";
export const LEGACY_CHAT_KEY = "chat";
export const CHANNEL_NAME = "ai-slide-builder";

export const deckKey = (id: string) => `deck:${id}`;
export const chatKey = (id: string) => `chat:${id}`;
const backupKey = (id: string) => `backup:${id}:${Date.now()}`;

// ---------------------------------------------------------------------------------------------
// Storage backend (IndexedDB with an in-memory fallback)

let idbStore: UseStore | null = null;
let probe: Promise<boolean> | null = null;
const memory = new Map<string, unknown>();

function store(): UseStore {
  if (!idbStore) idbStore = createStore(DB_NAME, STORE_NAME);
  return idbStore;
}

/** Checks once whether IndexedDB works in this browser. */
function storageAvailable(): Promise<boolean> {
  if (!probe) {
    probe = (async () => {
      try {
        await set("__probe__", 1, store());
        await del("__probe__", store());
        return true;
      } catch {
        return false;
      }
    })();
  }
  return probe;
}

/** Whether data is being kept across reloads (false = in-memory fallback). */
export async function isPersistent(): Promise<boolean> {
  return storageAvailable();
}

export class StorageFullError extends Error {
  constructor() {
    super("Browser storage is full. Remove some images or delete old presentations to keep saving.");
    this.name = "StorageFullError";
  }
}

function mapWriteError(error: unknown): never {
  if (error instanceof DOMException && error.name === "QuotaExceededError") throw new StorageFullError();
  throw error;
}

async function kvGet<T>(key: string): Promise<T | undefined> {
  if (!(await storageAvailable())) return structuredClone(memory.get(key)) as T | undefined;
  return get<T>(key, store());
}

async function kvSet(key: string, value: unknown): Promise<void> {
  if (!(await storageAvailable())) {
    memory.set(key, structuredClone(value));
    return;
  }
  try {
    await set(key, value, store());
  } catch (error) {
    mapWriteError(error);
  }
}

async function kvDel(key: string): Promise<void> {
  if (!(await storageAvailable())) {
    memory.delete(key);
    return;
  }
  await del(key, store());
}

async function kvKeys(): Promise<string[]> {
  if (!(await storageAvailable())) return [...memory.keys()];
  return (await keys(store())).map(String);
}

/** Read-modify-write in one transaction, so two tabs updating the index can't lose each other's changes. */
async function kvUpdate<T>(key: string, fn: (value: T | undefined) => T): Promise<void> {
  if (!(await storageAvailable())) {
    memory.set(key, structuredClone(fn(structuredClone(memory.get(key)) as T | undefined)));
    return;
  }
  try {
    await update<T>(key, fn, store());
  } catch (error) {
    mapWriteError(error);
  }
}

/** Test hook: forget cached handles and the in-memory fallback. */
export function resetPersistenceForTests() {
  idbStore = null;
  probe = null;
  memory.clear();
}

// ---------------------------------------------------------------------------------------------
// Validation and recovery

/**
 * Best-effort recovery of a saved deck that no longer matches the schema (e.g. a partially
 * written or hand-edited value): keeps every slide and element that is still valid.
 */
export function recoverDeck(raw: unknown): { deck: Deck; dropped: number } | null {
  if (!raw || typeof raw !== "object" || !Array.isArray((raw as { slides?: unknown }).slides)) return null;
  const source = raw as { id?: unknown; title?: unknown; slides: unknown[] };
  let dropped = 0;
  const slides: Slide[] = [];
  for (const rawSlide of source.slides.slice(0, MAX_SLIDES)) {
    if (!rawSlide || typeof rawSlide !== "object") {
      dropped += 1;
      continue;
    }
    const candidate = rawSlide as { id?: unknown; background?: unknown; elements?: unknown; notes?: unknown };
    const elements: SlideElement[] = [];
    const rawElements = Array.isArray(candidate.elements) ? candidate.elements : [];
    for (const rawElement of rawElements.slice(0, MAX_ELEMENTS_PER_SLIDE)) {
      const parsed = slideElementSchema.safeParse(rawElement);
      if (parsed.success) elements.push(sanitizeElement(parsed.data));
      else dropped += 1;
    }
    dropped += Math.max(0, rawElements.length - MAX_ELEMENTS_PER_SLIDE);
    slides.push({
      id: typeof candidate.id === "string" && candidate.id ? candidate.id : createId(),
      background: normalizeColor(candidate.background) ?? "#ffffff",
      elements,
      notes: typeof candidate.notes === "string" ? candidate.notes.slice(0, 5000) : "",
    });
  }
  dropped += Math.max(0, source.slides.length - MAX_SLIDES);
  const deck: Deck = {
    version: 1,
    id: typeof source.id === "string" && source.id ? source.id : createId(),
    title: typeof source.title === "string" ? source.title.slice(0, MAX_TITLE_LENGTH) : "",
    slides,
    updatedAt: Date.now(),
  };
  return deckSchema.safeParse(deck).success ? { deck, dropped } : null;
}

function parseDeck(raw: unknown): { status: "ok"; deck: Deck } | { status: "recovered"; deck: Deck; dropped: number } | { status: "corrupt" } {
  const parsed = deckSchema.safeParse(raw);
  if (parsed.success) return { status: "ok", deck: parsed.data };
  const recovered = recoverDeck(raw);
  if (recovered) return { status: "recovered", deck: recovered.deck, dropped: recovered.dropped };
  return { status: "corrupt" };
}

// ---------------------------------------------------------------------------------------------
// Deck index (dashboard)

export interface DeckSummary {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  slideCount: number;
  /** Used for the dashboard thumbnail. */
  firstSlide: Slide | null;
}

const summarySchema = z.object({
  id: z.string().min(1),
  title: z.string(),
  createdAt: z.number(),
  updatedAt: z.number(),
  slideCount: z.number(),
  firstSlide: slideSchema.nullable(),
});

export function summarizeDeck(deck: Deck, createdAt: number = deck.updatedAt): DeckSummary {
  return { id: deck.id, title: deck.title, createdAt, updatedAt: deck.updatedAt, slideCount: deck.slides.length, firstSlide: deck.slides[0] ?? null };
}

function validIndex(raw: unknown): DeckSummary[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((entry) => {
    const parsed = summarySchema.safeParse(entry);
    return parsed.success ? [parsed.data as DeckSummary] : [];
  });
}

async function upsertSummary(deck: Deck) {
  await kvUpdate<unknown>(INDEX_KEY, (raw) => {
    const list = validIndex(raw);
    const existing = list.find((s) => s.id === deck.id);
    const summary = summarizeDeck(deck, existing?.createdAt ?? deck.updatedAt);
    return existing ? list.map((s) => (s.id === deck.id ? summary : s)) : [...list, summary];
  });
}

/** Moves a deck saved by the single-deck version into the multi-deck storage. Safe to call repeatedly. */
async function migrateLegacy(): Promise<void> {
  const legacy = await kvGet<unknown>(LEGACY_DECK_KEY);
  if (legacy === undefined) return;
  const result = parseDeck(legacy);
  if (result.status !== "corrupt") {
    const deck = result.deck;
    if ((await kvGet(deckKey(deck.id))) === undefined) {
      await kvSet(deckKey(deck.id), deck);
      const chat = await kvGet<unknown>(LEGACY_CHAT_KEY);
      if (chat !== undefined) await kvSet(chatKey(deck.id), chat);
    }
    await upsertSummary(deck);
  } else {
    await kvSet(backupKey("legacy"), legacy);
  }
  await kvDel(LEGACY_DECK_KEY);
  await kvDel(LEGACY_CHAT_KEY);
}

export type ListDecksResult = { persistent: boolean; decks: DeckSummary[] };

/**
 * Lists saved presentations, newest first. Also repairs the index if it drifted from the stored
 * decks (a deck saved without its index entry, or an entry whose deck is gone).
 */
export async function listDecks(): Promise<ListDecksResult> {
  const persistent = await storageAvailable();
  await migrateLegacy();
  const index = validIndex(await kvGet<unknown>(INDEX_KEY));
  const storedIds = new Set((await kvKeys()).filter((k) => k.startsWith("deck:")).map((k) => k.slice("deck:".length)));
  let changed = false;
  const decks = index.filter((s) => {
    const keep = storedIds.has(s.id);
    if (!keep) changed = true;
    return keep;
  });
  for (const id of storedIds) {
    if (decks.some((s) => s.id === id)) continue;
    const result = parseDeck(await kvGet<unknown>(deckKey(id)));
    if (result.status === "corrupt") continue;
    // A recovered deck gets a fresh id from recoverDeck; it must be listed under the id it is stored with.
    decks.push(summarizeDeck({ ...result.deck, id }));
    changed = true;
  }
  if (changed) {
    const repaired = decks;
    await kvUpdate<unknown>(INDEX_KEY, () => repaired);
  }
  return { persistent, decks: [...decks].sort((a, b) => b.updatedAt - a.updatedAt) };
}

// ---------------------------------------------------------------------------------------------
// Decks

export type LoadDeckResult =
  | { status: "ok"; deck: Deck; persistent: boolean }
  | { status: "recovered"; deck: Deck; dropped: number; persistent: boolean }
  | { status: "missing"; persistent: boolean }
  | { status: "corrupt"; persistent: boolean };

/** Loads one presentation. Unreadable data is backed up, then recovered as far as possible. */
export async function loadDeckById(id: string): Promise<LoadDeckResult> {
  const persistent = await storageAvailable();
  await migrateLegacy();
  const raw = await kvGet<unknown>(deckKey(id));
  if (raw === undefined) return { status: "missing", persistent };
  const result = parseDeck(raw);
  if (result.status === "ok") return { status: "ok", deck: result.deck, persistent };
  // Keep the unreadable original so nothing is silently lost.
  await kvSet(backupKey(id), raw).catch(() => undefined);
  if (result.status === "recovered") return { status: "recovered", deck: { ...result.deck, id }, dropped: result.dropped, persistent };
  return { status: "corrupt", persistent };
}

export async function saveDeck(deck: Deck): Promise<void> {
  await kvSet(deckKey(deck.id), deck);
  await upsertSummary(deck);
}

export async function createDeckRecord(init: { title?: string; slides?: Slide[] } = {}): Promise<Deck> {
  const deck: Deck = { ...createDeck(init.title ?? ""), slides: init.slides ?? [] };
  await saveDeck(deck);
  return deck;
}

/** Saves a copy of a presentation (new ids everywhere, fresh chat) and returns it. */
export async function duplicateDeckRecord(source: Deck): Promise<Deck> {
  const title = `Copy of ${source.title.trim() || "Untitled presentation"}`.slice(0, MAX_TITLE_LENGTH);
  const deck: Deck = { ...createDeck(title), slides: source.slides.map((s) => cloneSlide(s)) };
  await saveDeck(deck);
  return deck;
}

export async function renameDeckRecord(id: string, title: string): Promise<Deck | null> {
  const loaded = await loadDeckById(id);
  if (loaded.status === "missing" || loaded.status === "corrupt") return null;
  const deck: Deck = { ...loaded.deck, title: title.trim().slice(0, MAX_TITLE_LENGTH), updatedAt: Date.now() };
  await saveDeck(deck);
  return deck;
}

export async function deleteDeckRecord(id: string): Promise<void> {
  await kvDel(deckKey(id));
  await kvDel(chatKey(id));
  await kvUpdate<unknown>(INDEX_KEY, (raw) => validIndex(raw).filter((s) => s.id !== id));
}

// ---------------------------------------------------------------------------------------------
// Chat history (one per presentation)

const chatMessageSchema = z.object({
  id: z.string(),
  role: z.enum(["user", "assistant"]),
  content: z.string(),
  createdAt: z.number(),
  status: z.enum(["ok", "error", "stopped"]),
  changes: z.array(z.string()).optional(),
  skipped: z.array(z.object({ op: z.string(), reason: z.string() })).optional(),
});

export async function loadChat(deckId: string): Promise<ChatMessage[]> {
  try {
    const raw = await kvGet<unknown>(chatKey(deckId));
    if (!Array.isArray(raw)) return [];
    return raw.flatMap((m) => {
      const parsed = chatMessageSchema.safeParse(m);
      return parsed.success ? [parsed.data] : [];
    });
  } catch {
    return [];
  }
}

export async function saveChat(deckId: string, messages: ChatMessage[]): Promise<void> {
  await kvSet(chatKey(deckId), messages);
}

// ---------------------------------------------------------------------------------------------
// Autosave and cross-tab sync

/**
 * Debounces saves so rapid edits produce one write, and never runs two writes at once
 * (the latest value always wins).
 */
export function createAutoSaver<T>(options: {
  save: (value: T) => Promise<void>;
  delay: number;
  onStatus?: (status: "saving" | "saved" | "error", error?: unknown) => void;
}) {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let pending: { value: T } | null = null;
  let inFlight: Promise<void> | null = null;
  let disposed = false;

  const run = async (): Promise<void> => {
    if (inFlight) {
      await inFlight;
      return run();
    }
    if (!pending) return;
    const { value } = pending;
    pending = null;
    options.onStatus?.("saving");
    inFlight = options
      .save(value)
      .then(() => {
        if (!pending) options.onStatus?.("saved");
      })
      .catch((error) => options.onStatus?.("error", error))
      .finally(() => {
        inFlight = null;
      });
    await inFlight;
    if (pending) await run();
  };

  return {
    schedule(value: T) {
      if (disposed) return;
      pending = { value };
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        timer = null;
        void run();
      }, options.delay);
    },
    /** Writes any scheduled value immediately (used when the page is being hidden/closed). */
    async flush() {
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
      await run();
    },
    /** Drops anything not yet written and ignores future schedules (e.g. the deck was deleted). */
    discard() {
      disposed = true;
      pending = null;
      if (timer) clearTimeout(timer);
      timer = null;
    },
    dispose() {
      disposed = true;
      if (timer) clearTimeout(timer);
      timer = null;
    },
  };
}

export type TabMessage =
  | { type: "deck-saved"; tabId: string; deckId: string; updatedAt: number }
  | { type: "deck-deleted"; tabId: string; deckId: string }
  | { type: "decks-changed"; tabId: string };

type OutgoingTabMessage =
  | { type: "deck-saved"; deckId: string; updatedAt: number }
  | { type: "deck-deleted"; deckId: string }
  | { type: "decks-changed" };

/** Lets open tabs know when another tab saved, created or deleted presentations. */
export function createTabSync(onMessage: (message: TabMessage) => void) {
  const tabId = createId();
  const channel = typeof BroadcastChannel === "function" ? new BroadcastChannel(CHANNEL_NAME) : null;
  const listener = (event: MessageEvent<TabMessage>) => {
    const data = event.data;
    if (data && typeof data === "object" && "type" in data && data.tabId !== tabId) onMessage(data);
  };
  channel?.addEventListener("message", listener);
  let closed = false;
  return {
    tabId,
    /** Best effort: telling other tabs must never fail the action that triggered it. */
    post(message: OutgoingTabMessage) {
      if (closed) return;
      try {
        channel?.postMessage({ ...message, tabId });
      } catch {
        // The channel can be closed underneath us (page teardown); other tabs simply miss this notice.
      }
    },
    close() {
      closed = true;
      channel?.removeEventListener("message", listener);
      channel?.close();
    },
  };
}
