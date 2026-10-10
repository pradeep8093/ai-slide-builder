import { createStore, get, set, type UseStore } from "idb-keyval";
import { z } from "zod";
import { MAX_ELEMENTS_PER_SLIDE, MAX_SLIDES, MAX_TITLE_LENGTH } from "./constants";
import { normalizeColor } from "./color";
import { createDeck } from "./factory";
import { createId } from "./ids";
import { sanitizeElement } from "./sanitize";
import { deckSchema, slideElementSchema, type Deck, type Slide, type SlideElement } from "./schema";
import type { ChatMessage } from "./store/chatStore";

export const DB_NAME = "ai-slide-builder";
export const STORE_NAME = "state";
export const DECK_KEY = "deck";
export const CHAT_KEY = "chat";
export const CHANNEL_NAME = "ai-slide-builder";

let idbStore: UseStore | null = null;
function store(): UseStore {
  if (!idbStore) idbStore = createStore(DB_NAME, STORE_NAME);
  return idbStore;
}

/** Test hook: forget the cached IndexedDB handle (e.g. after deleting the database). */
export function resetPersistenceForTests() {
  idbStore = null;
}

export type LoadDeckResult =
  | { status: "ok"; deck: Deck }
  | { status: "empty"; deck: Deck }
  | { status: "recovered"; deck: Deck; dropped: number }
  | { status: "corrupt"; deck: Deck }
  | { status: "unavailable"; deck: Deck };

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
    const candidate = rawSlide as { id?: unknown; background?: unknown; elements?: unknown };
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

export async function loadDeck(): Promise<LoadDeckResult> {
  let raw: unknown;
  try {
    raw = await get(DECK_KEY, store());
  } catch {
    return { status: "unavailable", deck: createDeck() };
  }
  if (raw === undefined) return { status: "empty", deck: createDeck() };

  const parsed = deckSchema.safeParse(raw);
  if (parsed.success) return { status: "ok", deck: parsed.data };

  // Keep the unreadable original so nothing is silently lost.
  try {
    await set(`${DECK_KEY}-backup-${Date.now()}`, raw, store());
  } catch {
    // Backup is best-effort.
  }
  const recovered = recoverDeck(raw);
  if (recovered) return { status: "recovered", deck: recovered.deck, dropped: recovered.dropped };
  return { status: "corrupt", deck: createDeck() };
}

export class StorageFullError extends Error {
  constructor() {
    super("Browser storage is full. Remove some images to keep saving.");
    this.name = "StorageFullError";
  }
}

export async function saveDeck(deck: Deck): Promise<void> {
  try {
    await set(DECK_KEY, deck, store());
  } catch (error) {
    if (error instanceof DOMException && error.name === "QuotaExceededError") throw new StorageFullError();
    throw error;
  }
}

const chatMessageSchema = z.object({
  id: z.string(),
  role: z.enum(["user", "assistant"]),
  content: z.string(),
  createdAt: z.number(),
  status: z.enum(["ok", "error", "stopped"]),
  changes: z.array(z.string()).optional(),
  skipped: z.array(z.object({ op: z.string(), reason: z.string() })).optional(),
});

export async function loadChat(): Promise<ChatMessage[]> {
  try {
    const raw = await get(CHAT_KEY, store());
    if (!Array.isArray(raw)) return [];
    return raw.flatMap((m) => {
      const parsed = chatMessageSchema.safeParse(m);
      return parsed.success ? [parsed.data] : [];
    });
  } catch {
    return [];
  }
}

export async function saveChat(messages: ChatMessage[]): Promise<void> {
  await set(CHAT_KEY, messages, store());
}

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
    dispose() {
      disposed = true;
      if (timer) clearTimeout(timer);
      timer = null;
    },
  };
}

export type TabMessage = { type: "deck-saved"; tabId: string; updatedAt: number };

/** Lets open tabs know when another tab saved the deck, so they don't silently overwrite each other. */
export function createTabSync(onExternalSave: (message: TabMessage) => void) {
  const tabId = createId();
  const channel = typeof BroadcastChannel === "function" ? new BroadcastChannel(CHANNEL_NAME) : null;
  const listener = (event: MessageEvent<TabMessage>) => {
    const data = event.data;
    if (data && data.type === "deck-saved" && data.tabId !== tabId) onExternalSave(data);
  };
  channel?.addEventListener("message", listener);
  return {
    tabId,
    notifySaved(updatedAt: number) {
      channel?.postMessage({ type: "deck-saved", tabId, updatedAt } satisfies TabMessage);
    },
    close() {
      channel?.removeEventListener("message", listener);
      channel?.close();
    },
  };
}
