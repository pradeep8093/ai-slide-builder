import { IDBFactory } from "fake-indexeddb";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createDeck, createSlide } from "@/lib/factory";
import * as persistence from "@/lib/persistence";
import { useChatStore } from "@/lib/store/chatStore";
import { currentDeck, editor, toastMessages } from "@/test/utils";
import { SAVE_DELAY_MS, usePersistence } from "./usePersistence";

function Harness() {
  const { externalChange, reload, dismissExternalChange } = usePersistence();
  return (
    <div>
      <span data-testid="external">{String(externalChange)}</span>
      <button onClick={() => void reload()}>reload</button>
      <button onClick={dismissExternalChange}>dismiss</button>
    </div>
  );
}

beforeEach(() => {
  globalThis.indexedDB = new IDBFactory();
  persistence.resetPersistenceForTests();
});
afterEach(() => vi.restoreAllMocks());

describe("usePersistence", () => {
  it("loads the saved deck and chat", async () => {
    const deck = { ...createDeck("Saved deck"), slides: [createSlide()] };
    await persistence.saveDeck(deck);
    await persistence.saveChat([{ id: "1", role: "user", content: "hi", createdAt: 1, status: "ok" }]);
    render(<Harness />);
    await vi.waitFor(() => expect(editor().hydrated).toBe(true));
    expect(currentDeck()).toEqual(deck);
    expect(useChatStore.getState().messages).toHaveLength(1);
    expect(editor().saveStatus).toBe("saved");
  });

  it("autosaves deck and chat changes after a short delay", async () => {
    render(<Harness />);
    await vi.waitFor(() => expect(editor().hydrated).toBe(true));
    act(() => {
      editor().addSlide();
      editor().setTitle("Autosaved");
      useChatStore.getState().loadMessages([{ id: "m", role: "user", content: "remember me", createdAt: 1, status: "ok" }]);
    });
    await new Promise((r) => setTimeout(r, SAVE_DELAY_MS + 100));
    await vi.waitFor(async () => expect((await persistence.loadDeck()).deck.title).toBe("Autosaved"));
    expect((await persistence.loadChat())[0].content).toBe("remember me");
    expect(editor().saveStatus).toBe("saved");
  });

  it("flushes pending saves when the page is hidden", async () => {
    render(<Harness />);
    await vi.waitFor(() => expect(editor().hydrated).toBe(true));
    act(() => editor().setTitle("Flushed"));
    Object.defineProperty(document, "visibilityState", { configurable: true, value: "hidden" });
    document.dispatchEvent(new Event("visibilitychange"));
    await vi.waitFor(async () => expect((await persistence.loadDeck()).deck.title).toBe("Flushed"));
    Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" });
  });

  it("warns when storage is unavailable and does not try to save", async () => {
    globalThis.indexedDB = { open: () => { throw new Error("blocked"); } } as unknown as IDBFactory;
    persistence.resetPersistenceForTests();
    render(<Harness />);
    await vi.waitFor(() => expect(editor().hydrated).toBe(true));
    expect(editor().saveStatus).toBe("unavailable");
    expect(toastMessages()[0]).toMatch(/blocking local storage/);
  });

  it("tells the user when a saved deck was corrupt or partly recovered", async () => {
    const { set, createStore } = await import("idb-keyval");
    await set(persistence.DECK_KEY, "broken", createStore(persistence.DB_NAME, persistence.STORE_NAME));
    const { unmount } = render(<Harness />);
    await vi.waitFor(() => expect(toastMessages()[0]).toMatch(/couldn't be read/));
    unmount();
    await set(persistence.DECK_KEY, { slides: [{ id: "s", background: "#ffffff", elements: [{ type: "nope" }] }] }, createStore(persistence.DB_NAME, persistence.STORE_NAME));
    render(<Harness />);
    await vi.waitFor(() => expect(toastMessages().some((m) => m.includes("1 item removed"))).toBe(true));
  });

  it("reports save failures once", async () => {
    render(<Harness />);
    await vi.waitFor(() => expect(editor().hydrated).toBe(true));
    globalThis.indexedDB = { open: () => { throw new DOMException("full", "QuotaExceededError"); } } as unknown as IDBFactory;
    persistence.resetPersistenceForTests();
    act(() => editor().setTitle("Will fail"));
    await vi.waitFor(() => expect(editor().saveStatus).toBe("error"), { timeout: 3000 });
    act(() => editor().setTitle("Fails again"));
    await new Promise((r) => setTimeout(r, SAVE_DELAY_MS + 100));
    expect(toastMessages().filter((m) => m.includes("couldn't be saved") || m.includes("storage is full"))).toHaveLength(1);
  });

  it("flags saves from another tab and reloads on request", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await vi.waitFor(() => expect(editor().hydrated).toBe(true));
    const other = persistence.createTabSync(() => undefined);
    await persistence.saveDeck({ ...createDeck("From other tab"), slides: [createSlide()] });
    other.notifySaved(Date.now());
    await vi.waitFor(() => expect(screen.getByTestId("external")).toHaveTextContent("true"));
    await user.click(screen.getByRole("button", { name: "reload" }));
    await vi.waitFor(() => expect(currentDeck().title).toBe("From other tab"));
    expect(screen.getByTestId("external")).toHaveTextContent("false");
    other.notifySaved(Date.now());
    await vi.waitFor(() => expect(screen.getByTestId("external")).toHaveTextContent("true"));
    await user.click(screen.getByRole("button", { name: "dismiss" }));
    expect(screen.getByTestId("external")).toHaveTextContent("false");
    other.close();
  });
});
