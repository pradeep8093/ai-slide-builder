import { IDBFactory } from "fake-indexeddb";
import { createStore, set } from "idb-keyval";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { createSlide, createTextElement } from "@/lib/factory";
import {
  createDeckRecord,
  createTabSync,
  DB_NAME,
  deckKey,
  deleteDeckRecord,
  loadChat,
  loadDeckById,
  resetPersistenceForTests,
  saveChat,
  saveDeck,
  STORE_NAME,
  StorageFullError,
  type TabMessage,
} from "@/lib/persistence";
import type { Deck } from "@/lib/schema";
import { useChatStore, type ChatMessage } from "@/lib/store/chatStore";
import { toast } from "@/lib/store/toastStore";
import { editor, toastMessages } from "@/test/utils";
import { SAVE_DELAY_MS, useDeckSession } from "./useDeckSession";

vi.mock("@/lib/persistence", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/persistence")>();
  return { ...actual, saveDeck: vi.fn(actual.saveDeck) };
});

/**
 * Minimal in-memory BroadcastChannel (delivers asynchronously to every other open channel with
 * the same name, and throws when posting on a closed channel, like the real one).
 */
class FakeBroadcastChannel extends EventTarget {
  static open = new Set<FakeBroadcastChannel>();
  name: string;
  closed = false;
  constructor(name: string) {
    super();
    this.name = name;
    FakeBroadcastChannel.open.add(this);
  }
  postMessage(data: unknown) {
    if (this.closed) throw new DOMException("BroadcastChannel is closed.", "InvalidStateError");
    const targets = [...FakeBroadcastChannel.open].filter((c) => c !== this && c.name === this.name);
    const payload = structuredClone(data);
    void Promise.resolve().then(() => {
      for (const target of targets) if (!target.closed) target.dispatchEvent(new MessageEvent("message", { data: structuredClone(payload) }));
    });
  }
  close() {
    this.closed = true;
    FakeBroadcastChannel.open.delete(this);
  }
}

const NOT_PERSISTENT = "This browser is blocking local storage, so your changes won't be kept after you close the tab. Export your work before leaving.";
const GENERIC_SAVE_ERROR = "Your latest changes couldn't be saved in this browser.";

const saveDeckMock = vi.mocked(saveDeck);
const rawStore = () => createStore(DB_NAME, STORE_NAME);

function message(content: string, role: ChatMessage["role"] = "user"): ChatMessage {
  return { id: `m-${content}`, role, content, createdAt: 1, status: "ok" };
}

async function storedDeck(id: string): Promise<Deck> {
  const result = await loadDeckById(id);
  if (result.status !== "ok" && result.status !== "recovered") throw new Error(`deck ${id} is ${result.status}`);
  return result.deck;
}

function openSession(deckId: string) {
  const onDeletedElsewhere = vi.fn();
  const hook = renderHook(({ id }) => useDeckSession(id, { onDeletedElsewhere }), { initialProps: { id: deckId } });
  return { ...hook, onDeletedElsewhere };
}

async function openReady(deckId: string) {
  const session = openSession(deckId);
  await waitFor(() => expect(session.result.current.status).toBe("ready"));
  return session;
}

/** Fakes only setTimeout so fake-indexeddb (setImmediate) keeps working. */
function useFakeSaveTimers() {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
}

async function advance(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

/** Another browser tab: records what it receives and can post to this one. */
function otherTab() {
  const received: TabMessage[] = [];
  const sync = createTabSync((m) => received.push(m));
  return { received, sync };
}

beforeEach(() => {
  globalThis.indexedDB = new IDBFactory();
  resetPersistenceForTests();
  FakeBroadcastChannel.open.clear();
  vi.stubGlobal("BroadcastChannel", FakeBroadcastChannel);
  saveDeckMock.mockReset();
});

afterEach(async () => {
  vi.useRealTimers();
  // Unmount now and let the final flush finish, so no save leaks into the next test.
  cleanup();
  await Promise.allSettled(saveDeckMock.mock.results.map((r) => r.value));
  await new Promise((resolve) => setTimeout(resolve, 0));
  vi.unstubAllGlobals();
});

describe("useDeckSession: opening", () => {
  it("starts loading, then loads the deck and its chat into the stores", async () => {
    const deck = await createDeckRecord({ title: "Quarterly", slides: [createSlide(), createSlide()] });
    await saveChat(deck.id, [message("Hello"), message("Hi!", "assistant")]);
    useChatStore.setState({ messages: [message("From another deck")] });

    const { result } = openSession(deck.id);
    expect(result.current.status).toBe("loading");
    // The previous presentation's conversation is dropped straight away.
    expect(useChatStore.getState().messages).toEqual([]);

    await waitFor(() => expect(result.current.status).toBe("ready"));
    expect(editor().deck).toEqual(deck);
    expect(editor().hydrated).toBe(true);
    expect(editor().selectedSlideId).toBe(deck.slides[0].id);
    expect(editor().saveStatus).toBe("saved");
    expect(useChatStore.getState().messages.map((m) => m.content)).toEqual(["Hello", "Hi!"]);
    expect(result.current.externalChange).toBe(false);
    expect(toastMessages()).toEqual([]);
  });

  it("reports a missing presentation without loading anything", async () => {
    const { result } = openSession("does-not-exist");
    await waitFor(() => expect(result.current.status).toBe("missing"));
    expect(editor().hydrated).toBe(false);
    expect(editor().saveStatus).toBe("idle");
    expect(toastMessages()).toEqual([]);
  });

  it("reports a presentation whose data can't be read at all", async () => {
    await set(deckKey("broken"), "garbage", rawStore());
    const { result } = openSession("broken");
    await waitFor(() => expect(result.current.status).toBe("corrupt"));
    expect(editor().hydrated).toBe(false);
  });

  it.each([
    [1, "1 item"],
    [2, "2 items"],
  ])("opens a partly damaged presentation and says %i item(s) were dropped", async (dropped, label) => {
    const good = createTextElement({ text: "Survivor" });
    const bad = Array.from({ length: dropped }, () => ({ type: "video" }));
    await set(
      deckKey("damaged"),
      { version: 1, id: "damaged", title: "Damaged", updatedAt: 1, slides: [{ id: "s1", background: "#ffffff", elements: [good, ...bad], notes: "" }] },
      rawStore(),
    );
    const { result } = openSession("damaged");
    await waitFor(() => expect(result.current.status).toBe("ready"));
    expect(editor().deck.id).toBe("damaged");
    expect(editor().deck.slides[0].elements).toEqual([good]);
    expect(toastMessages()).toEqual([`Part of this presentation couldn't be read (${label} removed). A backup of the original was kept.`]);
  });

  it("warns and keeps saveStatus 'unavailable' when storage isn't persistent", async () => {
    globalThis.indexedDB = {
      open: () => {
        throw new Error("blocked");
      },
    } as unknown as IDBFactory;
    resetPersistenceForTests();
    const deck = await createDeckRecord({ title: "In memory", slides: [createSlide()] });

    await openReady(deck.id);
    expect(editor().saveStatus).toBe("unavailable");
    expect(toastMessages()).toEqual([NOT_PERSISTENT]);

    useFakeSaveTimers();
    act(() => editor().setTitle("Edited in memory"));
    await advance(SAVE_DELAY_MS);
    await vi.waitFor(() => expect(saveDeckMock).toHaveBeenCalledTimes(1));
    // Still saved for this session (in memory), but the status never pretends it was kept.
    await vi.waitFor(async () => expect((await storedDeck(deck.id)).title).toBe("Edited in memory"));
    expect(editor().saveStatus).toBe("unavailable");
  });

  it("switching to another presentation saves the previous one and loads the next", async () => {
    const first = await createDeckRecord({ title: "First", slides: [createSlide()] });
    const second = await createDeckRecord({ title: "Second", slides: [createSlide()] });
    await saveChat(second.id, [message("Second chat")]);
    const { result, rerender } = await openReady(first.id);
    act(() => editor().setTitle("First, edited"));

    rerender({ id: second.id });
    expect(result.current.status).toBe("loading");
    await waitFor(() => expect(result.current.status).toBe("ready"));
    expect(editor().deck.id).toBe(second.id);
    expect(useChatStore.getState().messages.map((m) => m.content)).toEqual(["Second chat"]);
    await waitFor(async () => expect((await storedDeck(first.id)).title).toBe("First, edited"));
    expect((await storedDeck(second.id)).title).toBe("Second");
  });
});

describe("useDeckSession: autosave", () => {
  it("saves deck changes once, SAVE_DELAY_MS after the last edit, and tells other tabs", async () => {
    const deck = await createDeckRecord({ title: "Draft", slides: [createSlide()] });
    await openReady(deck.id);
    const other = otherTab();
    useFakeSaveTimers();

    act(() => editor().setTitle("Draft 2"));
    await advance(SAVE_DELAY_MS - 1);
    act(() => editor().setTitle("Draft 3"));
    await advance(SAVE_DELAY_MS - 1);
    expect(saveDeckMock).not.toHaveBeenCalled();

    await advance(1);
    await vi.waitFor(() => expect(other.received).toHaveLength(1));
    expect(saveDeckMock).toHaveBeenCalledTimes(1);
    expect(saveDeckMock.mock.calls[0][0].title).toBe("Draft 3");
    expect((await storedDeck(deck.id)).title).toBe("Draft 3");
    expect(editor().saveStatus).toBe("saved");
    expect(other.received[0]).toMatchObject({ type: "deck-saved", deckId: deck.id, updatedAt: editor().deck.updatedAt });
    other.sync.close();
  });

  it("doesn't write a presentation back just because it was opened", async () => {
    const deck = await createDeckRecord({ title: "Untouched", slides: [createSlide()] });
    await openReady(deck.id);
    useFakeSaveTimers();
    await advance(SAVE_DELAY_MS * 3);
    expect(saveDeckMock).not.toHaveBeenCalled();
    expect((await storedDeck(deck.id)).updatedAt).toBe(deck.updatedAt);
  });

  it("saves the chat history of this presentation", async () => {
    const deck = await createDeckRecord({ title: "Chatty" });
    const other = await createDeckRecord({ title: "Other" });
    await openReady(deck.id);
    useFakeSaveTimers();

    act(() => useChatStore.getState().loadMessages([message("Make it blue"), message("Done.", "assistant")]));
    await advance(SAVE_DELAY_MS - 1);
    expect(await loadChat(deck.id)).toEqual([]);
    await advance(1);
    await vi.waitFor(async () => expect((await loadChat(deck.id)).map((m) => m.content)).toEqual(["Make it blue", "Done."]));
    expect(await loadChat(other.id)).toEqual([]);
  });

  it("flush() writes pending changes right away", async () => {
    const deck = await createDeckRecord({ title: "Before", slides: [createSlide()] });
    const { result } = await openReady(deck.id);
    useFakeSaveTimers();
    act(() => {
      editor().setTitle("After");
      useChatStore.getState().loadMessages([message("Saved now")]);
    });
    await act(() => result.current.flush());
    expect((await storedDeck(deck.id)).title).toBe("After");
    expect((await loadChat(deck.id)).map((m) => m.content)).toEqual(["Saved now"]);
    // Nothing left for the timer to write.
    await advance(SAVE_DELAY_MS);
    expect(saveDeckMock).toHaveBeenCalledTimes(1);
  });

  it("discard() drops pending changes and ignores later ones", async () => {
    const deck = await createDeckRecord({ title: "Keep me", slides: [createSlide()] });
    const { result, unmount } = await openReady(deck.id);
    useFakeSaveTimers();
    act(() => {
      editor().setTitle("Doomed");
      useChatStore.getState().loadMessages([message("Doomed too")]);
    });
    act(() => result.current.discard());
    act(() => editor().setTitle("Doomed again"));
    await advance(SAVE_DELAY_MS * 2);
    await act(() => result.current.flush());
    unmount();
    await advance(SAVE_DELAY_MS);
    expect(saveDeckMock).not.toHaveBeenCalled();
    expect((await storedDeck(deck.id)).title).toBe("Keep me");
    expect(await loadChat(deck.id)).toEqual([]);
  });

  it("flushes when the page is hidden or closed", async () => {
    const deck = await createDeckRecord({ title: "One", slides: [createSlide()] });
    await openReady(deck.id);
    useFakeSaveTimers();

    act(() => editor().setTitle("Two"));
    window.dispatchEvent(new Event("pagehide"));
    await vi.waitFor(async () => expect((await storedDeck(deck.id)).title).toBe("Two"));

    act(() => editor().setTitle("Three"));
    Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "hidden" });
    try {
      document.dispatchEvent(new Event("visibilitychange"));
    } finally {
      delete (document as unknown as { visibilityState?: string }).visibilityState;
    }
    await vi.waitFor(async () => expect((await storedDeck(deck.id)).title).toBe("Three"));
    // Neither save needed the timer.
    expect(saveDeckMock).toHaveBeenCalledTimes(2);
  });

  it("doesn't flush when the page becomes visible", async () => {
    const deck = await createDeckRecord({ title: "One", slides: [createSlide()] });
    await openReady(deck.id);
    useFakeSaveTimers();
    act(() => editor().setTitle("Two"));
    document.dispatchEvent(new Event("visibilitychange"));
    await Promise.resolve();
    expect(saveDeckMock).not.toHaveBeenCalled();
  });

  it("shows the storage-full message when a save fails, then recovers on the next save", async () => {
    const deck = await createDeckRecord({ title: "Big", slides: [createSlide()] });
    await openReady(deck.id);
    useFakeSaveTimers();
    saveDeckMock.mockRejectedValueOnce(new StorageFullError());

    act(() => editor().setTitle("Bigger"));
    await advance(SAVE_DELAY_MS);
    await vi.waitFor(() => expect(editor().saveStatus).toBe("error"));
    expect(toastMessages()).toEqual([new StorageFullError().message]);
    expect((await storedDeck(deck.id)).title).toBe("Big");

    act(() => editor().setTitle("Smaller"));
    await advance(SAVE_DELAY_MS);
    await vi.waitFor(() => expect(editor().saveStatus).toBe("saved"));
    expect((await storedDeck(deck.id)).title).toBe("Smaller");
  });

  it("doesn't repeat the error toast while saves keep failing", async () => {
    const deck = await createDeckRecord({ title: "Big", slides: [createSlide()] });
    await openReady(deck.id);
    const errorToast = vi.spyOn(toast, "error");
    useFakeSaveTimers();
    saveDeckMock.mockRejectedValueOnce(new StorageFullError()).mockRejectedValueOnce(new StorageFullError());

    act(() => editor().setTitle("Bigger"));
    await advance(SAVE_DELAY_MS);
    await vi.waitFor(() => expect(editor().saveStatus).toBe("error"));
    act(() => editor().setTitle("Even bigger"));
    await advance(SAVE_DELAY_MS);
    await vi.waitFor(() => expect(saveDeckMock).toHaveBeenCalledTimes(2));
    await vi.waitFor(() => expect(editor().saveStatus).toBe("error"));
    expect(errorToast).toHaveBeenCalledTimes(1);
  });

  it("shows a generic message for other save errors", async () => {
    const deck = await createDeckRecord({ title: "Oops", slides: [createSlide()] });
    await openReady(deck.id);
    useFakeSaveTimers();
    saveDeckMock.mockRejectedValueOnce(new Error("disk on fire"));
    act(() => editor().setTitle("Oops 2"));
    await advance(SAVE_DELAY_MS);
    await vi.waitFor(() => expect(editor().saveStatus).toBe("error"));
    expect(toastMessages()).toEqual([GENERIC_SAVE_ERROR]);
  });
});

describe("useDeckSession: other tabs", () => {
  it("flags a save of this presentation in another tab, and reload() picks it up", async () => {
    const deck = await createDeckRecord({ title: "Mine", slides: [createSlide()] });
    const { result } = await openReady(deck.id);
    const other = otherTab();

    other.sync.post({ type: "deck-saved", deckId: "some-other-deck", updatedAt: 1 });
    other.sync.post({ type: "decks-changed" });
    await act(async () => {
      await Promise.resolve();
    });
    expect(result.current.externalChange).toBe(false);

    await saveDeck({ ...deck, title: "Theirs", updatedAt: deck.updatedAt + 1 });
    saveDeckMock.mockClear();
    other.sync.post({ type: "deck-saved", deckId: deck.id, updatedAt: deck.updatedAt + 1 });
    await waitFor(() => expect(result.current.externalChange).toBe(true));
    // The local copy is untouched until the user chooses to reload.
    expect(editor().deck.title).toBe("Mine");

    await act(() => result.current.reload());
    expect(editor().deck.title).toBe("Theirs");
    expect(result.current.externalChange).toBe(false);
    other.sync.close();
  });

  it("dismissExternalChange() clears the flag and keeps the local copy", async () => {
    const deck = await createDeckRecord({ title: "Mine", slides: [createSlide()] });
    const { result } = await openReady(deck.id);
    const other = otherTab();
    other.sync.post({ type: "deck-saved", deckId: deck.id, updatedAt: 2 });
    await waitFor(() => expect(result.current.externalChange).toBe(true));
    act(() => result.current.dismissExternalChange());
    expect(result.current.externalChange).toBe(false);
    expect(editor().deck.title).toBe("Mine");
    other.sync.close();
  });

  it("reload() keeps the local copy when the saved one is gone", async () => {
    const deck = await createDeckRecord({ title: "Local", slides: [createSlide()] });
    const { result } = await openReady(deck.id);
    const other = otherTab();
    other.sync.post({ type: "deck-saved", deckId: deck.id, updatedAt: 2 });
    await waitFor(() => expect(result.current.externalChange).toBe(true));
    await deleteDeckRecord(deck.id);
    await act(() => result.current.reload());
    expect(editor().deck).toEqual(deck);
    expect(result.current.externalChange).toBe(false);
    other.sync.close();
  });

  it("calls onDeletedElsewhere when another tab deletes this presentation, and never writes it back", async () => {
    const deck = await createDeckRecord({ title: "Gone soon", slides: [createSlide()] });
    const { onDeletedElsewhere, unmount } = await openReady(deck.id);
    const other = otherTab();

    other.sync.post({ type: "deck-deleted", deckId: "another-deck" });
    await act(async () => {
      await Promise.resolve();
    });
    expect(onDeletedElsewhere).not.toHaveBeenCalled();

    useFakeSaveTimers();
    act(() => {
      editor().setTitle("Unsaved edit");
      useChatStore.getState().loadMessages([message("Unsaved chat")]);
    });
    await deleteDeckRecord(deck.id);
    other.sync.post({ type: "deck-deleted", deckId: deck.id });
    await vi.waitFor(() => expect(onDeletedElsewhere).toHaveBeenCalledTimes(1));

    await advance(SAVE_DELAY_MS * 2);
    unmount();
    await advance(SAVE_DELAY_MS);
    expect(saveDeckMock).not.toHaveBeenCalled();
    expect((await loadDeckById(deck.id)).status).toBe("missing");
    expect(await loadChat(deck.id)).toEqual([]);
    other.sync.close();
  });

  it("post() sends messages to other tabs", async () => {
    const deck = await createDeckRecord({ title: "Poster" });
    const { result } = await openReady(deck.id);
    const other = otherTab();
    act(() => result.current.post({ type: "decks-changed" }));
    await waitFor(() => expect(other.received).toEqual([{ type: "decks-changed", tabId: expect.any(String) }]));
    other.sync.close();
  });
});

describe("useDeckSession: closing", () => {
  it("flushes pending changes and resets the chat on unmount", async () => {
    const deck = await createDeckRecord({ title: "Closing", slides: [createSlide()] });
    const { unmount } = await openReady(deck.id);
    act(() => {
      editor().setTitle("Closed");
      useChatStore.getState().loadMessages([message("Last words")]);
    });
    unmount();
    expect(useChatStore.getState().messages).toEqual([]);
    await waitFor(async () => expect((await storedDeck(deck.id)).title).toBe("Closed"));
    await waitFor(async () => expect((await loadChat(deck.id)).map((m) => m.content)).toEqual(["Last words"]));
  });

  it("doesn't report an error for the save made while closing", async () => {
    const deck = await createDeckRecord({ title: "Closing", slides: [createSlide()] });
    const { unmount } = await openReady(deck.id);
    act(() => editor().setTitle("Closed"));
    unmount();
    await waitFor(async () => expect((await storedDeck(deck.id)).title).toBe("Closed"));
    await waitFor(() => expect(editor().saveStatus).not.toBe("saving"));
    expect(editor().saveStatus).toBe("saved");
    expect(toastMessages()).toEqual([]);
  });

  it("stops listening to other tabs after unmount", async () => {
    const deck = await createDeckRecord({ title: "Bye", slides: [createSlide()] });
    const { result, unmount, onDeletedElsewhere } = await openReady(deck.id);
    unmount();
    const other = otherTab();
    other.sync.post({ type: "deck-deleted", deckId: deck.id });
    other.sync.post({ type: "deck-saved", deckId: deck.id, updatedAt: 5 });
    await act(async () => {
      await Promise.resolve();
    });
    expect(onDeletedElsewhere).not.toHaveBeenCalled();
    expect(result.current.externalChange).toBe(false);
    other.sync.close();
  });
});
