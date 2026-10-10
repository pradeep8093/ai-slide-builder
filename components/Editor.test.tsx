import { IDBFactory } from "fake-indexeddb";
import { createStore, set } from "idb-keyval";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createChartElement, createImageElement, createSlide, createTableElement, createTextElement } from "@/lib/factory";
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
import type { Deck, Slide } from "@/lib/schema";
import { useEditorStore } from "@/lib/store/editorStore";
import { currentDeck, editor, toastMessages } from "@/test/utils";
import { SAVE_DELAY_MS } from "./hooks/useDeckSession";
import Editor, { AI_HIGHLIGHT_MS } from "./Editor";

vi.mock("./export/captureSlide", () => ({ captureSlideImage: vi.fn(), captureSlideMarkup: vi.fn() }));

vi.mock("@/lib/persistence", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/persistence")>();
  return {
    ...actual,
    saveDeck: vi.fn(actual.saveDeck),
    createDeckRecord: vi.fn(actual.createDeckRecord),
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

const saveDeckMock = vi.mocked(saveDeck);
const createDeckMock = vi.mocked(createDeckRecord);
const deleteDeckMock = vi.mocked(deleteDeckRecord);
const PNG = "data:image/png;base64,AAAA";

async function storeDeck(title: string, slides: Slide[] = []): Promise<Deck> {
  return createDeckRecord({ title, slides });
}

async function renderEditor(deckId: string) {
  const onNavigate = vi.fn();
  const user = userEvent.setup();
  const utils = render(<Editor deckId={deckId} onNavigate={onNavigate} />);
  await screen.findByRole("textbox", { name: "Presentation title" });
  return { ...utils, onNavigate, user };
}

async function stored(id: string) {
  return loadDeckById(id);
}

/** Another browser tab: records what it receives and can post to this one. */
function otherTab() {
  const received: TabMessage[] = [];
  const sync = createTabSync((m) => received.push(m));
  return { received, sync };
}

async function openDeckMenu(user: ReturnType<typeof userEvent.setup>, item: "New presentation" | "Duplicate presentation" | "Delete presentation") {
  await user.click(screen.getByRole("button", { name: "Presentation actions" }));
  await user.click(screen.getByRole("menuitem", { name: item }));
}

const canvasElement = (label: string) => within(screen.getByTestId("slide-canvas")).getByLabelText(label);

beforeEach(() => {
  globalThis.indexedDB = new IDBFactory();
  resetPersistenceForTests();
  FakeBroadcastChannel.open.clear();
  vi.stubGlobal("BroadcastChannel", FakeBroadcastChannel);
  for (const mock of [saveDeckMock, createDeckMock, deleteDeckMock]) mock.mockReset();
});

afterEach(async () => {
  vi.useRealTimers();
  // Unmount now and let the final autosave finish, so nothing leaks into the next test.
  cleanup();
  await Promise.allSettled(saveDeckMock.mock.results.map((r) => r.value));
  await new Promise((resolve) => setTimeout(resolve, 0));
  vi.unstubAllGlobals();
});

describe("Editor: opening", () => {
  it("shows a loading screen, then every region of an empty presentation", async () => {
    const deck = await storeDeck("Empty deck");
    render(<Editor deckId={deck.id} onNavigate={vi.fn()} />);
    expect(screen.getByRole("status")).toHaveTextContent("Loading your presentation…");

    expect(await screen.findByRole("heading", { name: "Start your presentation" })).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "Presentation title" })).toHaveValue("Empty deck");
    expect(screen.getByTestId("save-status")).toHaveTextContent("Saved");
    expect(screen.getByRole("complementary", { name: "Slides" })).toHaveTextContent("No slides yet");
    expect(screen.getByRole("toolbar", { name: "Slide tools" })).toBeInTheDocument();
    expect(screen.getByRole("main", { name: "Slide editor" })).toBeInTheDocument();
    expect(screen.getByRole("complementary", { name: "AI assistant" })).toBeInTheDocument();
    expect(screen.queryByTestId("slide-canvas")).not.toBeInTheDocument();
    expect(screen.queryByTestId("notes-panel")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Present" })).toBeDisabled();
  });

  it("shows the canvas, speaker notes and this presentation's chat history", async () => {
    const deck = await storeDeck("Full deck", [createSlide("#ffffff", "Remember the demo"), createSlide()]);
    await saveChat(deck.id, [{ id: "m1", role: "user", content: "Make slide 2 blue", createdAt: 1, status: "ok" }]);
    const { user } = await renderEditor(deck.id);

    expect(screen.getByTestId("slide-canvas")).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: /^Slide \d of 2$/ })).toHaveLength(2);
    const notes = screen.getByRole("textbox", { name: "Speaker notes" });
    expect(notes).toHaveValue("Remember the demo");
    expect(within(screen.getByRole("complementary", { name: "AI assistant" })).getByText("Make slide 2 blue")).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Start your presentation" })).not.toBeInTheDocument();

    await user.type(notes, "!");
    expect(currentDeck().slides[0].notes).toBe("Remember the demo!");
  });

  it("shows 'Presentation not found' for an unknown id, with a way back", async () => {
    const onNavigate = vi.fn();
    const user = userEvent.setup();
    render(<Editor deckId="does-not-exist" onNavigate={onNavigate} />);
    expect(await screen.findByRole("heading", { name: "Presentation not found" })).toBeInTheDocument();
    expect(screen.getByText("It may have been deleted, or it was saved in a different browser.")).toBeInTheDocument();
    expect(screen.queryByRole("textbox", { name: "Presentation title" })).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "All presentations" }));
    expect(onNavigate).toHaveBeenCalledWith({ view: "dashboard" });
  });

  it("explains when the saved data is damaged, with a way back", async () => {
    await set(deckKey("broken"), "garbage", createStore(DB_NAME, STORE_NAME));
    const onNavigate = vi.fn();
    const user = userEvent.setup();
    render(<Editor deckId="broken" onNavigate={onNavigate} />);
    expect(await screen.findByRole("heading", { name: "This presentation can't be opened" })).toBeInTheDocument();
    expect(screen.getByText(/A backup copy was kept in this browser's storage/)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "All presentations" }));
    expect(onNavigate).toHaveBeenCalledWith({ view: "dashboard" });
  });
});

describe("Editor: slides and templates", () => {
  it("adds a slide from the empty state, shows the canvas and saves it", async () => {
    const deck = await storeDeck("New");
    const { user } = await renderEditor(deck.id);
    await user.click(screen.getByRole("button", { name: "Add slide" }));
    expect(screen.getByTestId("slide-canvas")).toBeInTheDocument();
    expect(screen.getByTestId("notes-panel")).toBeInTheDocument();
    expect(currentDeck().slides).toHaveLength(1);
    await waitFor(async () => expect(await stored(deck.id)).toMatchObject({ deck: { slides: [expect.anything()] } }));
  });

  it("applies a template from the empty state and autofills the title", async () => {
    const deck = await storeDeck("");
    const { user } = await renderEditor(deck.id);
    await user.click(screen.getByRole("button", { name: "Browse templates" }));
    await user.click(screen.getByRole("button", { name: /^Project Update template/ }));
    expect(screen.getByRole("textbox", { name: "Presentation title" })).toHaveValue("Project Update");
    expect(screen.getAllByRole("button", { name: /^Slide \d+ of 5$/ })).toHaveLength(5);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(toastMessages()).toEqual(["Applied the “Project Update” template."]);
  });

  it("opens the template gallery from the header, disables shortcuts meanwhile, and closes it", async () => {
    const text = createTextElement({ text: "Keep me" });
    const deck = await storeDeck("Gallery", [{ ...createSlide(), elements: [text] }]);
    const { user } = await renderEditor(deck.id);
    act(() => editor().selectElement(text.id));

    await user.click(screen.getByRole("button", { name: "Templates" }));
    expect(screen.getByRole("dialog", { name: "Templates" })).toBeInTheDocument();
    fireEvent.keyDown(document.body, { key: "Delete" });
    expect(currentDeck().slides[0].elements).toHaveLength(1);
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Templates" }));
    await user.click(screen.getByRole("button", { name: "Close" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

    fireEvent.keyDown(document.body, { key: "Delete" });
    expect(currentDeck().slides[0].elements).toHaveLength(0);
  });

  it("presents from the current slide and returns to the slide where the show ended", async () => {
    const deck = await storeDeck("Show", [createSlide(), createSlide(), createSlide()]);
    const { user } = await renderEditor(deck.id);
    await user.click(screen.getByRole("button", { name: "Slide 2 of 3" }));

    await user.click(screen.getByRole("button", { name: "Present" }));
    const show = screen.getByRole("dialog", { name: "Presentation" });
    expect(within(show).getByRole("group", { name: "Slide 2 of 3" })).toBeInTheDocument();
    await user.keyboard("{ArrowRight}");
    expect(within(show).getByRole("group", { name: "Slide 3 of 3" })).toBeInTheDocument();
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog", { name: "Presentation" })).not.toBeInTheDocument();
    expect(editor().selectedSlideId).toBe(deck.slides[2].id);
  });
});

describe("Editor: element editors", () => {
  it("opens the chart data editor by double-click and disables shortcuts while it's open", async () => {
    const chart = createChartElement("bar");
    const deck = await storeDeck("Charts", [{ ...createSlide(), elements: [chart] }]);
    const { user } = await renderEditor(deck.id);

    fireEvent.doubleClick(canvasElement("Bar chart"));
    expect(screen.getByRole("dialog", { name: "Edit chart data" })).toBeInTheDocument();
    expect(editor().selectedElementIds).toEqual([chart.id]);
    fireEvent.keyDown(document.body, { key: "Delete" });
    expect(currentDeck().slides[0].elements).toHaveLength(1);

    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    fireEvent.keyDown(document.body, { key: "Delete" });
    expect(currentDeck().slides[0].elements).toHaveLength(0);
  });

  it("opens the chart data editor from the toolbar and saves changes", async () => {
    const chart = createChartElement("line");
    const deck = await storeDeck("Charts", [{ ...createSlide(), elements: [chart] }]);
    const { user } = await renderEditor(deck.id);
    act(() => editor().selectElement(chart.id));

    await user.click(screen.getByRole("button", { name: "Edit data" }));
    const dialog = screen.getByRole("dialog", { name: "Edit chart data" });
    await user.type(within(dialog).getByRole("textbox", { name: "Chart title" }), "Growth");
    await user.click(within(dialog).getByRole("button", { name: "Save" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(currentDeck().slides[0].elements[0]).toMatchObject({ id: chart.id, title: "Growth" });
  });

  it("opens the table editor with 'Edit table' or a double-click", async () => {
    const table = createTableElement();
    const deck = await storeDeck("Tables", [{ ...createSlide(), elements: [table] }]);
    const { user } = await renderEditor(deck.id);
    act(() => editor().selectElement(table.id));

    await user.click(screen.getByRole("button", { name: "Edit table" }));
    expect(screen.getByRole("dialog", { name: "Edit table" })).toBeInTheDocument();
    fireEvent.keyDown(document.body, { key: "Delete" });
    expect(currentDeck().slides[0].elements).toHaveLength(1);
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

    fireEvent.doubleClick(canvasElement("Table: 3 × 3"));
    const dialog = screen.getByRole("dialog", { name: "Edit table" });
    await user.type(within(dialog).getByRole("textbox", { name: "Row 2, column 1" }), "North");
    await user.click(within(dialog).getByRole("button", { name: "Save" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(currentDeck().slides[0].elements[0]).toMatchObject({ rows: [["Header 1", "Header 2", "Header 3"], ["North", "", ""], ["", "", ""]] });
  });

  it("opens the crop editor with 'Crop' or a double-click", async () => {
    const image = createImageElement(PNG, 400, 200, "Logo");
    const deck = await storeDeck("Images", [{ ...createSlide(), elements: [image] }]);
    const { user } = await renderEditor(deck.id);
    act(() => editor().selectElement(image.id));

    await user.click(screen.getByRole("button", { name: "Crop" }));
    expect(screen.getByRole("dialog", { name: "Crop image" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

    fireEvent.doubleClick(canvasElement("Image: Logo"));
    expect(screen.getByRole("dialog", { name: "Crop image" })).toBeInTheDocument();
  });

  it("doesn't crop a locked image", async () => {
    const image = { ...createImageElement(PNG, 400, 200, "Logo"), locked: true };
    const deck = await storeDeck("Images", [{ ...createSlide(), elements: [image] }]);
    await renderEditor(deck.id);
    act(() => editor().selectElement(image.id));
    expect(screen.getByRole("button", { name: "Crop" })).toBeDisabled();
    fireEvent.doubleClick(canvasElement("Image: Logo (locked)"));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(toastMessages()).toEqual(["Unlock the image to crop it."]);
  });

  it("closes an element editor by itself when its element disappears", async () => {
    const chart = createChartElement("bar");
    const other = createTextElement({ text: "Stays" });
    const deck = await storeDeck("Charts", [{ ...createSlide(), elements: [chart, other] }]);
    const { user } = await renderEditor(deck.id);
    act(() => editor().selectElement(chart.id));
    await user.click(screen.getByRole("button", { name: "Edit data" }));
    expect(screen.getByRole("dialog", { name: "Edit chart data" })).toBeInTheDocument();

    // The AI deletes the chart while its editor is open.
    act(() => {
      editor().applyAiOperations([{ op: "delete_element", elementId: chart.id }]);
    });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

    // Shortcuts work again.
    act(() => editor().selectElement(other.id));
    fireEvent.keyDown(document.body, { key: "Delete" });
    expect(currentDeck().slides[0].elements).toHaveLength(0);
  });

  it("closes an element editor when another slide is selected", async () => {
    const table = createTableElement();
    const deck = await storeDeck("Tables", [{ ...createSlide(), elements: [table] }, createSlide()]);
    const { user } = await renderEditor(deck.id);
    act(() => editor().selectElement(table.id));
    await user.click(screen.getByRole("button", { name: "Edit table" }));
    expect(screen.getByRole("dialog", { name: "Edit table" })).toBeInTheDocument();
    act(() => editor().selectSlide(deck.slides[1].id));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});

describe("Editor: presentation actions", () => {
  it("'All presentations' saves pending changes, then goes home", async () => {
    const deck = await storeDeck("Draft", [createSlide()]);
    const { user, onNavigate } = await renderEditor(deck.id);
    await user.type(screen.getByRole("textbox", { name: "Presentation title" }), " v2");
    await user.click(screen.getByRole("button", { name: "All presentations" }));
    await waitFor(() => expect(onNavigate).toHaveBeenCalledWith({ view: "dashboard" }));
    expect(await stored(deck.id)).toMatchObject({ deck: { title: "Draft v2" } });
  });

  it("New presentation saves this one, creates an empty one and opens it", async () => {
    const deck = await storeDeck("Current", [createSlide()]);
    const { user, onNavigate } = await renderEditor(deck.id);
    const other = otherTab();
    await user.type(screen.getByRole("textbox", { name: "Presentation title" }), "!");

    await openDeckMenu(user, "New presentation");
    await waitFor(() => expect(onNavigate).toHaveBeenCalledTimes(1));
    const route = onNavigate.mock.calls[0][0] as { view: string; deckId: string };
    expect(route).toEqual({ view: "deck", deckId: expect.any(String) });
    expect(route.deckId).not.toBe(deck.id);
    expect(await stored(route.deckId)).toMatchObject({ status: "ok", deck: { title: "", slides: [] } });
    expect(await stored(deck.id)).toMatchObject({ deck: { title: "Current!" } });
    await waitFor(() => expect(other.received).toContainEqual(expect.objectContaining({ type: "decks-changed" })));
    other.sync.close();
  });

  it("shows a toast when a new presentation can't be created", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const deck = await storeDeck("Current", [createSlide()]);
    const { user, onNavigate } = await renderEditor(deck.id);
    createDeckMock.mockRejectedValueOnce(new StorageFullError());
    await openDeckMenu(user, "New presentation");
    await waitFor(() => expect(toastMessages()).toEqual([new StorageFullError().message]));
    expect(onNavigate).not.toHaveBeenCalled();
  });

  it("Duplicate presentation saves a copy (with pending edits) and opens it", async () => {
    const deck = await storeDeck("Plan", [createSlide(), createSlide()]);
    const { user, onNavigate } = await renderEditor(deck.id);
    await user.type(screen.getByRole("textbox", { name: "Presentation title" }), " B");

    await openDeckMenu(user, "Duplicate presentation");
    await waitFor(() => expect(onNavigate).toHaveBeenCalledTimes(1));
    const route = onNavigate.mock.calls[0][0] as { view: string; deckId: string };
    expect(route).toEqual({ view: "deck", deckId: expect.any(String) });
    expect(route.deckId).not.toBe(deck.id);
    const copy = await stored(route.deckId);
    if (copy.status !== "ok") throw new Error(`copy is ${copy.status}`);
    expect(copy.deck.title).toBe("Copy of Plan B");
    expect(copy.deck.slides).toHaveLength(2);
    expect(copy.deck.slides.map((s) => s.id)).not.toEqual(deck.slides.map((s) => s.id));
    expect(toastMessages()).toEqual(["Opened “Copy of Plan B”."]);
    expect(await stored(deck.id)).toMatchObject({ deck: { title: "Plan B" } });
  });

  it("Delete presentation asks first, deletes it with its chat, tells other tabs and goes home", async () => {
    const deck = await storeDeck("Old plan", [createSlide()]);
    await saveChat(deck.id, [{ id: "m1", role: "user", content: "Hi", createdAt: 1, status: "ok" }]);
    const { user, onNavigate, unmount } = await renderEditor(deck.id);
    const other = otherTab();
    // An edit still waiting to be saved must not bring the deck back.
    await user.type(screen.getByRole("textbox", { name: "Presentation title" }), "!");

    await openDeckMenu(user, "Delete presentation");
    const dialog = screen.getByRole("dialog", { name: "Delete presentation?" });
    expect(dialog).toHaveTextContent("“Old plan!” and its AI chat history will be permanently deleted from this browser. This can't be undone.");
    await user.click(within(dialog).getByRole("button", { name: "Delete" }));

    await waitFor(() => expect(onNavigate).toHaveBeenCalledWith({ view: "dashboard" }));
    expect(toastMessages()).toEqual(["Deleted “Old plan!”."]);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    await waitFor(() =>
      expect(other.received).toEqual(
        expect.arrayContaining([expect.objectContaining({ type: "deck-deleted", deckId: deck.id }), expect.objectContaining({ type: "decks-changed" })]),
      ),
    );

    unmount();
    await Promise.allSettled(saveDeckMock.mock.results.map((r) => r.value));
    await new Promise((resolve) => setTimeout(resolve, SAVE_DELAY_MS + 50));
    expect((await stored(deck.id)).status).toBe("missing");
    expect(await loadChat(deck.id)).toEqual([]);
    other.sync.close();
  });

  it("keeps the presentation when deleting is cancelled", async () => {
    const deck = await storeDeck("Keep", [createSlide()]);
    const { user, onNavigate } = await renderEditor(deck.id);
    await openDeckMenu(user, "Delete presentation");
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(deleteDeckMock).not.toHaveBeenCalled();
    expect(onNavigate).not.toHaveBeenCalled();
    expect((await stored(deck.id)).status).toBe("ok");
  });

  it("keeps the dialog open and shows a toast when deleting fails", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const deck = await storeDeck("Stuck", [createSlide()]);
    const { user, onNavigate } = await renderEditor(deck.id);
    deleteDeckMock.mockRejectedValueOnce(new Error("nope"));
    await openDeckMenu(user, "Delete presentation");
    await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Delete" }));
    await waitFor(() => expect(toastMessages()).toEqual(["The presentation couldn't be deleted."]));
    expect(screen.getByRole("dialog", { name: "Delete presentation?" })).toBeInTheDocument();
    expect(onNavigate).not.toHaveBeenCalled();
  });
});

describe("Editor: AI highlight", () => {
  it("clears the highlight of AI changes after AI_HIGHLIGHT_MS", async () => {
    const deck = await storeDeck("AI", [createSlide()]);
    await renderEditor(deck.id);
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const slideId = deck.slides[0].id;

    act(() => {
      editor().applyAiOperations([{ op: "set_slide_background", slideId, background: "#123456" }]);
    });
    expect(screen.getAllByTestId("ai-highlight")).toHaveLength(1);
    expect(screen.getByTestId("slide-ai-highlight")).toBeInTheDocument();

    await act(() => vi.advanceTimersByTimeAsync(AI_HIGHLIGHT_MS - 1));
    expect(screen.getAllByTestId("ai-highlight")).toHaveLength(1);
    await act(() => vi.advanceTimersByTimeAsync(1));
    expect(screen.queryByTestId("ai-highlight")).not.toBeInTheDocument();
    expect(screen.queryByTestId("slide-ai-highlight")).not.toBeInTheDocument();
    expect(useEditorStore.getState().aiHighlight).toBeNull();
  });

  it("restarts the countdown when the AI changes something again", async () => {
    const deck = await storeDeck("AI", [createSlide()]);
    await renderEditor(deck.id);
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const slideId = deck.slides[0].id;

    act(() => {
      editor().applyAiOperations([{ op: "set_slide_background", slideId, background: "#123456" }]);
    });
    await act(() => vi.advanceTimersByTimeAsync(AI_HIGHLIGHT_MS - 1000));
    act(() => {
      editor().applyAiOperations([{ op: "set_slide_background", slideId, background: "#654321" }]);
    });
    await act(() => vi.advanceTimersByTimeAsync(1000));
    expect(screen.getAllByTestId("ai-highlight")).toHaveLength(1);
    await act(() => vi.advanceTimersByTimeAsync(AI_HIGHLIGHT_MS - 1000));
    expect(screen.queryByTestId("ai-highlight")).not.toBeInTheDocument();
  });
});

describe("Editor: other tabs", () => {
  it("warns when another tab saved this presentation, and reloads or dismisses", async () => {
    const deck = await storeDeck("Mine", [createSlide()]);
    const { user } = await renderEditor(deck.id);
    const other = otherTab();

    await saveDeck({ ...deck, title: "Other tab", updatedAt: deck.updatedAt + 1 });
    other.sync.post({ type: "deck-saved", deckId: deck.id, updatedAt: deck.updatedAt + 1 });
    const banner = await screen.findByRole("alert");
    expect(banner).toHaveTextContent("This presentation was changed in another tab.");
    expect(screen.getByRole("textbox", { name: "Presentation title" })).toHaveValue("Mine");
    await user.click(within(banner).getByRole("button", { name: "Reload" }));
    await waitFor(() => expect(screen.getByRole("textbox", { name: "Presentation title" })).toHaveValue("Other tab"));
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();

    other.sync.post({ type: "deck-saved", deckId: deck.id, updatedAt: deck.updatedAt + 2 });
    await screen.findByRole("alert");
    await user.click(screen.getByRole("button", { name: "Dismiss warning" }));
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "Presentation title" })).toHaveValue("Other tab");
    other.sync.close();
  });

  it("goes home with a notice when another tab deletes this presentation", async () => {
    const deck = await storeDeck("Doomed", [createSlide()]);
    const { onNavigate } = await renderEditor(deck.id);
    const other = otherTab();
    other.sync.post({ type: "deck-deleted", deckId: deck.id });
    await waitFor(() => expect(onNavigate).toHaveBeenCalledWith({ view: "dashboard" }));
    expect(toastMessages()).toEqual(["This presentation was deleted in another tab."]);
    other.sync.close();
  });
});
