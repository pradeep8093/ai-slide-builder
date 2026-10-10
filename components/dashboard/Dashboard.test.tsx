import { IDBFactory } from "fake-indexeddb";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MAX_TITLE_LENGTH } from "@/lib/constants";
import { createDeck, createSlide, createTextElement } from "@/lib/factory";
import {
  createDeckRecord,
  createTabSync,
  deleteDeckRecord,
  duplicateDeckRecord,
  listDecks,
  loadChat,
  loadDeckById,
  renameDeckRecord,
  resetPersistenceForTests,
  saveChat,
  saveDeck,
  StorageFullError,
  type TabMessage,
} from "@/lib/persistence";
import type { Deck, Slide } from "@/lib/schema";
import { toastMessages } from "@/test/utils";
import Dashboard, { formatEdited } from "./Dashboard";

vi.mock("@/lib/persistence", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/persistence")>();
  return {
    ...actual,
    createDeckRecord: vi.fn(actual.createDeckRecord),
    duplicateDeckRecord: vi.fn(actual.duplicateDeckRecord),
    renameDeckRecord: vi.fn(actual.renameDeckRecord),
    deleteDeckRecord: vi.fn(actual.deleteDeckRecord),
  };
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

const createMock = vi.mocked(createDeckRecord);
const duplicateMock = vi.mocked(duplicateDeckRecord);
const renameMock = vi.mocked(renameDeckRecord);
const deleteMock = vi.mocked(deleteDeckRecord);

const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;

async function seed(title: string, options: { slides?: Slide[]; updatedAt?: number } = {}): Promise<Deck> {
  const deck: Deck = { ...createDeck(title), slides: options.slides ?? [createSlide()], updatedAt: options.updatedAt ?? Date.now() };
  await saveDeck(deck);
  return deck;
}

async function renderDashboard() {
  const onOpen = vi.fn();
  render(<Dashboard onOpen={onOpen} />);
  await waitFor(() => expect(screen.queryByText("Loading presentations…")).not.toBeInTheDocument());
  return { onOpen, user: userEvent.setup() };
}

const cardTitles = () => screen.queryAllByRole("button", { name: /^Open / }).map((b) => b.getAttribute("aria-label")!.slice("Open ".length));
const card = (title: string) => screen.getByRole("button", { name: `Open ${title}` });

async function chooseAction(user: ReturnType<typeof userEvent.setup>, title: string, action: "Rename" | "Duplicate" | "Delete") {
  await user.click(screen.getByRole("button", { name: `${title} actions` }));
  await user.click(screen.getByRole("menuitem", { name: action }));
}

/** Another browser tab listening for (and able to send) announcements. */
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
  for (const mock of [createMock, duplicateMock, renameMock, deleteMock]) mock.mockReset();
});

afterEach(async () => {
  cleanup();
  // Let a refresh triggered by the last announcement finish before the next test.
  await new Promise((resolve) => setTimeout(resolve, 0));
  vi.unstubAllGlobals();
});

describe("formatEdited", () => {
  const now = Date.UTC(2026, 5, 15, 12, 0, 0);

  it("says 'just now' for anything under a minute (either direction)", () => {
    expect(formatEdited(now, now)).toBe("just now");
    expect(formatEdited(now - 44_000, now)).toBe("just now");
    expect(formatEdited(now - 59_000, now)).toBe("just now");
    expect(formatEdited(now + 30_000, now)).toBe("just now");
  });

  it("uses the largest fitting unit", () => {
    expect(formatEdited(now - MINUTE, now)).toBe("1 minute ago");
    expect(formatEdited(now - 5 * MINUTE, now)).toBe("5 minutes ago");
    expect(formatEdited(now - 60 * MINUTE, now)).toBe("1 hour ago");
    expect(formatEdited(now - 3 * 60 * MINUTE, now)).toBe("3 hours ago");
    expect(formatEdited(now - DAY, now)).toBe("yesterday");
    expect(formatEdited(now - 3 * DAY, now)).toBe("3 days ago");
    expect(formatEdited(now - 7 * DAY, now)).toBe("last week");
    expect(formatEdited(now - 14 * DAY, now)).toBe("2 weeks ago");
    expect(formatEdited(now - 30 * DAY, now)).toBe("last month");
    expect(formatEdited(now - 90 * DAY, now)).toBe("3 months ago");
    expect(formatEdited(now - 365 * DAY, now)).toBe("last year");
    expect(formatEdited(now - 3 * 365 * DAY, now)).toBe("3 years ago");
  });

  it("handles timestamps in the future (another device's clock)", () => {
    expect(formatEdited(now + 2 * 60 * MINUTE, now)).toBe("in 2 hours");
    expect(formatEdited(now + DAY, now)).toBe("tomorrow");
  });

  it("defaults to the current time", () => {
    expect(formatEdited(Date.now())).toBe("just now");
    expect(formatEdited(Date.now() - 10 * MINUTE)).toBe("10 minutes ago");
  });
});

describe("Dashboard", () => {
  it("shows a loading state until the list has been read", async () => {
    render(<Dashboard onOpen={vi.fn()} />);
    expect(screen.getByRole("status")).toHaveTextContent("Loading presentations…");
    expect(await screen.findByRole("heading", { name: "No presentations yet" })).toBeInTheDocument();
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("creates a presentation from the empty state and opens it", async () => {
    const { onOpen, user } = await renderDashboard();
    const other = otherTab();
    const buttons = screen.getAllByRole("button", { name: "New presentation" });
    expect(buttons).toHaveLength(2);
    await user.click(buttons[1]);
    await waitFor(() => expect(onOpen).toHaveBeenCalledTimes(1));
    const id = onOpen.mock.calls[0][0] as string;
    const loaded = await loadDeckById(id);
    expect(loaded).toMatchObject({ status: "ok", deck: { id, title: "", slides: [] } });
    expect((await listDecks()).decks.map((d) => d.id)).toEqual([id]);
    await waitFor(() => expect(other.received).toContainEqual(expect.objectContaining({ type: "decks-changed" })));
    other.sync.close();
  });

  it("creates a presentation from the header button too", async () => {
    await seed("Existing");
    const { onOpen, user } = await renderDashboard();
    await user.click(screen.getByRole("button", { name: "New presentation" }));
    await waitFor(() => expect(onOpen).toHaveBeenCalledTimes(1));
    expect((await listDecks()).decks).toHaveLength(2);
  });

  it("ignores a second create while the first is still running", async () => {
    let finish: (deck: Deck) => void = () => undefined;
    createMock.mockImplementationOnce(() => new Promise<Deck>((resolve) => (finish = resolve)));
    const { onOpen, user } = await renderDashboard();
    const [header, empty] = screen.getAllByRole("button", { name: "New presentation" });
    await user.click(header);
    expect(header).toBeDisabled();
    await user.click(empty);
    expect(createMock).toHaveBeenCalledTimes(1);
    const deck = createDeck("Slow");
    await act(async () => finish(deck));
    await waitFor(() => expect(onOpen).toHaveBeenCalledWith(deck.id));
    expect(onOpen).toHaveBeenCalledTimes(1);
    expect(header).toBeEnabled();
  });

  it("lists presentations newest first with title, slide count, edit time and thumbnail", async () => {
    await seed("Oldest", { updatedAt: Date.now() - 3 * DAY, slides: [createSlide()] });
    await seed("Newest", { updatedAt: Date.now(), slides: [{ ...createSlide(), elements: [createTextElement({ text: "Hello thumbnail" })] }, createSlide()] });
    await seed("", { updatedAt: Date.now() - 5 * MINUTE, slides: [] });
    await renderDashboard();

    expect(screen.getByRole("list", { name: "Presentations" })).toBeInTheDocument();
    expect(cardTitles()).toEqual(["Newest", "Untitled presentation", "Oldest"]);
    expect(card("Newest")).toHaveTextContent("2 slides · Edited just now");
    expect(within(card("Newest")).getByText("Hello thumbnail")).toBeInTheDocument();
    expect(card("Untitled presentation")).toHaveTextContent("0 slides · Edited 5 minutes ago");
    expect(within(card("Untitled presentation")).getByText("No slides")).toBeInTheDocument();
    expect(card("Oldest")).toHaveTextContent("1 slide · Edited 3 days ago");
    expect(within(card("Oldest")).queryByText("No slides")).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "No presentations yet" })).not.toBeInTheDocument();
  });

  it("opens a presentation when its card is clicked", async () => {
    const deck = await seed("Board update");
    const { onOpen, user } = await renderDashboard();
    await user.click(card("Board update"));
    expect(onOpen).toHaveBeenCalledWith(deck.id);
  });

  describe("rename", () => {
    it("renames from the card menu (trimmed) and moves the deck to the top", async () => {
      const deck = await seed("Alpha", { updatedAt: Date.now() - DAY });
      await seed("Recent");
      const { user } = await renderDashboard();
      const other = otherTab();
      expect(cardTitles()).toEqual(["Recent", "Alpha"]);

      await chooseAction(user, "Alpha", "Rename");
      const dialog = screen.getByRole("dialog", { name: "Rename presentation" });
      const input = within(dialog).getByRole("textbox", { name: "Title" });
      expect(input).toHaveValue("Alpha");
      expect(input).toHaveFocus();
      expect(input).toHaveAttribute("placeholder", "Untitled presentation");
      await user.clear(input);
      await user.type(input, "  Beta  ");
      await user.click(within(dialog).getByRole("button", { name: "Rename" }));

      await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
      await waitFor(() => expect(cardTitles()).toEqual(["Beta", "Recent"]));
      expect(renameMock).toHaveBeenCalledWith(deck.id, "  Beta  ");
      expect(await loadDeckById(deck.id)).toMatchObject({ deck: { title: "Beta" } });
      await waitFor(() => expect(other.received).toContainEqual(expect.objectContaining({ type: "decks-changed" })));
      other.sync.close();
    });

    it("submits with Enter and allows an empty title", async () => {
      await seed("Alpha");
      const { user } = await renderDashboard();
      await chooseAction(user, "Alpha", "Rename");
      const input = screen.getByRole("textbox", { name: "Title" });
      await user.clear(input);
      await user.keyboard("{Enter}");
      await waitFor(() => expect(cardTitles()).toEqual(["Untitled presentation"]));
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });

    it("limits the title length", async () => {
      await seed("Alpha");
      const { user } = await renderDashboard();
      await chooseAction(user, "Alpha", "Rename");
      const input = screen.getByRole("textbox", { name: "Title" });
      expect(input).toHaveAttribute("maxLength", String(MAX_TITLE_LENGTH));
      await user.clear(input);
      await user.type(input, "x".repeat(MAX_TITLE_LENGTH + 10));
      expect(input).toHaveValue("x".repeat(MAX_TITLE_LENGTH));
    });

    it("cancels without renaming (button, close icon or Escape)", async () => {
      await seed("Alpha");
      const { user } = await renderDashboard();

      await chooseAction(user, "Alpha", "Rename");
      await user.type(screen.getByRole("textbox", { name: "Title" }), " changed");
      await user.click(screen.getByRole("button", { name: "Cancel" }));
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

      await chooseAction(user, "Alpha", "Rename");
      expect(screen.getByRole("textbox", { name: "Title" })).toHaveValue("Alpha");
      await user.click(screen.getByRole("button", { name: "Close" }));
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

      await chooseAction(user, "Alpha", "Rename");
      await user.keyboard("{Escape}");
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

      expect(renameMock).not.toHaveBeenCalled();
      expect(cardTitles()).toEqual(["Alpha"]);
    });

    it("keeps the dialog open and shows a toast when renaming fails", async () => {
      vi.spyOn(console, "error").mockImplementation(() => undefined);
      renameMock.mockRejectedValueOnce(new Error("nope"));
      await seed("Alpha");
      const { user } = await renderDashboard();
      await chooseAction(user, "Alpha", "Rename");
      await user.type(screen.getByRole("textbox", { name: "Title" }), "!");
      await user.click(screen.getByRole("button", { name: "Rename" }));
      await waitFor(() => expect(toastMessages()).toEqual(["The presentation couldn't be renamed."]));
      expect(screen.getByRole("dialog", { name: "Rename presentation" })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Rename" })).toBeEnabled();
      expect(cardTitles()).toEqual(["Alpha"]);
    });
  });

  describe("duplicate", () => {
    it("adds a copy at the top and confirms with a toast", async () => {
      const deck = await seed("Alpha", { updatedAt: Date.now() - DAY, slides: [createSlide(), createSlide()] });
      const { user } = await renderDashboard();
      await chooseAction(user, "Alpha", "Duplicate");
      await waitFor(() => expect(toastMessages()).toEqual(["Created “Copy of Alpha”."]));
      expect(cardTitles()).toEqual(["Copy of Alpha", "Alpha"]);
      expect(card("Copy of Alpha")).toHaveTextContent("2 slides · Edited just now");
      const copyId = (await listDecks()).decks.find((d) => d.title === "Copy of Alpha")!.id;
      expect(copyId).not.toBe(deck.id);
    });

    it("names the copy of an untitled presentation", async () => {
      await seed("");
      const { user } = await renderDashboard();
      await chooseAction(user, "Untitled presentation", "Duplicate");
      await waitFor(() => expect(toastMessages()).toEqual(["Created “Copy of Untitled presentation”."]));
      expect(card("Copy of Untitled presentation")).toBeInTheDocument();
    });

    it("shows a toast when the presentation is gone", async () => {
      vi.spyOn(console, "error").mockImplementation(() => undefined);
      const deck = await seed("Alpha");
      const { user } = await renderDashboard();
      // Deleted behind the dashboard's back (e.g. by another tab that hasn't announced it yet).
      await deleteDeckRecord(deck.id);
      await chooseAction(user, "Alpha", "Duplicate");
      await waitFor(() => expect(toastMessages()).toEqual(["The presentation couldn't be duplicated."]));
      expect(duplicateMock).not.toHaveBeenCalled();
    });

    it("explains when storage is full", async () => {
      vi.spyOn(console, "error").mockImplementation(() => undefined);
      duplicateMock.mockRejectedValueOnce(new StorageFullError());
      await seed("Alpha");
      const { user } = await renderDashboard();
      await chooseAction(user, "Alpha", "Duplicate");
      await waitFor(() => expect(toastMessages()).toEqual([new StorageFullError().message]));
      expect(cardTitles()).toEqual(["Alpha"]);
    });
  });

  describe("delete", () => {
    it("asks for confirmation, deletes the deck and its chat, and tells other tabs", async () => {
      const deck = await seed("Alpha");
      await seed("Keep", { updatedAt: Date.now() - DAY });
      await saveChat(deck.id, [{ id: "m1", role: "user", content: "Hi", createdAt: 1, status: "ok" }]);
      const { user } = await renderDashboard();
      const other = otherTab();

      await chooseAction(user, "Alpha", "Delete");
      const dialog = screen.getByRole("dialog", { name: "Delete presentation?" });
      expect(dialog).toHaveTextContent("“Alpha” and its AI chat history will be permanently deleted from this browser. This can't be undone.");
      const confirm = within(dialog).getByRole("button", { name: "Delete" });
      expect(confirm).toHaveFocus();
      await user.click(confirm);

      await waitFor(() => expect(cardTitles()).toEqual(["Keep"]));
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
      expect(toastMessages()).toEqual(["Deleted “Alpha”."]);
      expect((await loadDeckById(deck.id)).status).toBe("missing");
      expect(await loadChat(deck.id)).toEqual([]);
      await waitFor(() =>
        expect(other.received).toEqual(
          expect.arrayContaining([expect.objectContaining({ type: "deck-deleted", deckId: deck.id }), expect.objectContaining({ type: "decks-changed" })]),
        ),
      );
      other.sync.close();
    });

    it("shows the empty state after deleting the last presentation", async () => {
      await seed("");
      const { user } = await renderDashboard();
      await chooseAction(user, "Untitled presentation", "Delete");
      expect(screen.getByRole("dialog")).toHaveTextContent("“Untitled presentation” and its AI chat history");
      await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Delete" }));
      expect(await screen.findByRole("heading", { name: "No presentations yet" })).toBeInTheDocument();
      expect(toastMessages()).toEqual(["Deleted “Untitled presentation”."]);
    });

    it("keeps the presentation when cancelled", async () => {
      const deck = await seed("Alpha");
      const { user } = await renderDashboard();
      await chooseAction(user, "Alpha", "Delete");
      await user.click(screen.getByRole("button", { name: "Cancel" }));
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
      expect(deleteMock).not.toHaveBeenCalled();
      expect((await loadDeckById(deck.id)).status).toBe("ok");
      expect(cardTitles()).toEqual(["Alpha"]);
    });

    it("keeps the dialog open and shows a toast when deleting fails", async () => {
      vi.spyOn(console, "error").mockImplementation(() => undefined);
      deleteMock.mockRejectedValueOnce(new Error("nope"));
      await seed("Alpha");
      const { user } = await renderDashboard();
      await chooseAction(user, "Alpha", "Delete");
      await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Delete" }));
      await waitFor(() => expect(toastMessages()).toEqual(["The presentation couldn't be deleted."]));
      expect(screen.getByRole("dialog", { name: "Delete presentation?" })).toBeInTheDocument();
      expect(cardTitles()).toEqual(["Alpha"]);
    });
  });

  it("shows a banner when storage isn't persistent, and still works", async () => {
    globalThis.indexedDB = {
      open: () => {
        throw new Error("blocked");
      },
    } as unknown as IDBFactory;
    resetPersistenceForTests();
    const { onOpen, user } = await renderDashboard();
    expect(screen.getByRole("alert")).toHaveTextContent(
      "This browser is blocking local storage. You can still make presentations, but they will disappear when you close the tab.",
    );
    await user.click(screen.getAllByRole("button", { name: "New presentation" })[0]);
    await waitFor(() => expect(onOpen).toHaveBeenCalledTimes(1));
  });

  it("doesn't show the banner when storage works", async () => {
    await renderDashboard();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("refreshes when another tab announces changes", async () => {
    await seed("Alpha");
    await renderDashboard();
    const other = otherTab();
    await createDeckRecord({ title: "From elsewhere" });
    other.sync.post({ type: "decks-changed" });
    expect(await screen.findByRole("button", { name: "Open From elsewhere" })).toBeInTheDocument();
    other.sync.close();
  });

  it("stops listening to other tabs after unmount", async () => {
    const { unmount } = render(<Dashboard onOpen={vi.fn()} />);
    await screen.findByRole("heading", { name: "No presentations yet" });
    unmount();
    expect(FakeBroadcastChannel.open.size).toBe(0);
  });

  it.each([
    [new Error("blocked"), "The presentation couldn't be created."],
    [new StorageFullError(), new StorageFullError().message],
  ])("shows a toast when creating fails (%s)", async (error, expected) => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    createMock.mockRejectedValueOnce(error);
    const { onOpen, user } = await renderDashboard();
    await user.click(screen.getAllByRole("button", { name: "New presentation" })[0]);
    await waitFor(() => expect(toastMessages()).toEqual([expected]));
    expect(onOpen).not.toHaveBeenCalled();
    expect(screen.getAllByRole("button", { name: "New presentation" })[0]).toBeEnabled();
  });
});
