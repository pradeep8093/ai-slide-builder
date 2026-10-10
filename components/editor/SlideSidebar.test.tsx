import { describe, expect, it, vi } from "vitest";
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { DragEndEvent } from "@dnd-kit/core";
import { currentDeck, editor, seedDeck, slideWith, toastMessages } from "@/test/utils";
import { createShapeElement, createSlide, createTextElement } from "@/lib/factory";
import { readClipboard, writeClipboard } from "@/lib/store/clipboardStore";
import { useEditorStore } from "@/lib/store/editorStore";
import SlideSidebar, { applyDragEnd, pasteAtSlide } from "./SlideSidebar";

function thumbnails() {
  return screen.getAllByRole("button", { name: /^Slide \d+ of \d+$/ });
}

function ids() {
  return currentDeck().slides.map((s) => s.id);
}

async function chooseFromSlideMenu(user: ReturnType<typeof userEvent.setup>, slideNumber: number, item: string) {
  await user.click(screen.getByRole("button", { name: `Slide ${slideNumber} actions` }));
  await user.click(screen.getByRole("menuitem", { name: item }));
}

function highlightOf(thumbnail: HTMLElement) {
  return thumbnail.parentElement?.querySelector('[data-testid="slide-ai-highlight"]') ?? null;
}

describe("SlideSidebar", () => {
  it("shows an empty message and a new-slide button", async () => {
    const user = userEvent.setup();
    seedDeck([]);
    render(<SlideSidebar />);
    expect(screen.getByText("No slides yet")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "New slide" }));
    expect(currentDeck().slides).toHaveLength(1);
    expect(thumbnails()).toHaveLength(1);
  });

  it("adds a new slide after the selected one with the footer button", async () => {
    const user = userEvent.setup();
    const deck = seedDeck([createSlide(), createSlide()]);
    render(<SlideSidebar />);
    await user.click(screen.getByRole("button", { name: "New slide" }));
    expect(ids()).toHaveLength(3);
    expect(ids()[0]).toBe(deck.slides[0].id);
    expect(ids()[2]).toBe(deck.slides[1].id);
    expect(editor().selectedSlideId).toBe(ids()[1]);
  });

  it("lists slides with numbers, previews and the current one marked", () => {
    const deck = seedDeck([slideWith(createTextElement({ text: "Intro" })), createSlide()]);
    render(<SlideSidebar />);
    const [first, second] = thumbnails();
    expect(first).toHaveAccessibleName("Slide 1 of 2");
    expect(first).toHaveAttribute("aria-current", "true");
    expect(second).not.toHaveAttribute("aria-current");
    expect(within(first).getByText("Intro")).toBeInTheDocument();
    expect(screen.getByLabelText("Slides")).toHaveTextContent("2");
    expect(deck.slides).toHaveLength(2);
  });

  it("selects slides by click and arrow keys, moving focus along", async () => {
    const user = userEvent.setup();
    const deck = seedDeck([createSlide(), createSlide(), createSlide()]);
    render(<SlideSidebar />);
    await user.click(thumbnails()[1]);
    expect(editor().selectedSlideId).toBe(deck.slides[1].id);
    await user.keyboard("{ArrowDown}");
    expect(editor().selectedSlideId).toBe(deck.slides[2].id);
    expect(thumbnails()[2]).toHaveFocus();
    await user.keyboard("{ArrowDown}");
    expect(editor().selectedSlideId).toBe(deck.slides[2].id);
    expect(thumbnails()[2]).toHaveFocus();
    await user.keyboard("{ArrowUp}");
    expect(editor().selectedSlideId).toBe(deck.slides[1].id);
    await user.keyboard("{ArrowUp}");
    expect(editor().selectedSlideId).toBe(deck.slides[0].id);
    expect(thumbnails()[0]).toHaveFocus();
    await user.keyboard("{ArrowUp}");
    expect(editor().selectedSlideId).toBe(deck.slides[0].id);
  });

  it("deletes the focused slide with Delete and Backspace and focuses the neighbor", async () => {
    const user = userEvent.setup();
    const deck = seedDeck([createSlide(), createSlide(), createSlide()]);
    render(<SlideSidebar />);
    await user.click(thumbnails()[0]);
    await user.keyboard("{Delete}");
    expect(ids()).toEqual([deck.slides[1].id, deck.slides[2].id]);
    expect(editor().selectedSlideId).toBe(deck.slides[1].id);
    await waitFor(() => expect(thumbnails()[0]).toHaveFocus());
    await user.keyboard("{Backspace}");
    expect(ids()).toEqual([deck.slides[2].id]);
    await waitFor(() => expect(thumbnails()[0]).toHaveFocus());
  });

  it("deleting the last remaining slide by keyboard leaves the empty state", async () => {
    const user = userEvent.setup();
    seedDeck([createSlide()]);
    render(<SlideSidebar />);
    await user.click(thumbnails()[0]);
    await user.keyboard("{Delete}");
    expect(currentDeck().slides).toHaveLength(0);
    expect(editor().selectedSlideId).toBeNull();
    expect(screen.getByText("No slides yet")).toBeInTheDocument();
  });

  it("offers every slide action in the menu", async () => {
    const user = userEvent.setup();
    seedDeck([createSlide(), createSlide()]);
    render(<SlideSidebar />);
    await user.click(screen.getByRole("button", { name: "Slide 1 actions" }));
    const menu = screen.getByRole("menu", { name: "Slide 1 actions" });
    expect(within(menu).getAllByRole("menuitem").map((item) => item.textContent)).toEqual([
      "New slide above",
      "New slide below",
      "Duplicate",
      "Copy",
      "Paste",
      "Move up",
      "Move down",
      "Delete",
    ]);
  });

  it("inserts a new slide above a slide and selects it", async () => {
    const user = userEvent.setup();
    const deck = seedDeck([createSlide(), createSlide()]);
    render(<SlideSidebar />);
    await chooseFromSlideMenu(user, 2, "New slide above");
    expect(ids()).toHaveLength(3);
    expect(ids()[0]).toBe(deck.slides[0].id);
    expect(ids()[2]).toBe(deck.slides[1].id);
    const added = ids()[1];
    expect(editor().selectedSlideId).toBe(added);
    expect(thumbnails()[1]).toHaveAttribute("aria-current", "true");
  });

  it("inserts a new slide above the first slide", async () => {
    const user = userEvent.setup();
    const deck = seedDeck([createSlide(), createSlide()]);
    render(<SlideSidebar />);
    await chooseFromSlideMenu(user, 1, "New slide above");
    expect(ids()).toHaveLength(3);
    expect(ids().slice(1)).toEqual([deck.slides[0].id, deck.slides[1].id]);
    expect(editor().selectedSlideId).toBe(ids()[0]);
  });

  it("inserts a new slide below a slide, even when another slide is selected", async () => {
    const user = userEvent.setup();
    const deck = seedDeck([createSlide(), createSlide(), createSlide()]);
    render(<SlideSidebar />);
    expect(editor().selectedSlideId).toBe(deck.slides[0].id);
    await chooseFromSlideMenu(user, 2, "New slide below");
    expect(ids()).toHaveLength(4);
    expect(ids()[0]).toBe(deck.slides[0].id);
    expect(ids()[1]).toBe(deck.slides[1].id);
    expect(ids()[3]).toBe(deck.slides[2].id);
    expect(editor().selectedSlideId).toBe(ids()[2]);
  });

  it("inserts a new slide below the last slide", async () => {
    const user = userEvent.setup();
    const deck = seedDeck([createSlide(), createSlide()]);
    render(<SlideSidebar />);
    await chooseFromSlideMenu(user, 2, "New slide below");
    expect(ids().slice(0, 2)).toEqual(deck.slides.map((s) => s.id));
    expect(editor().selectedSlideId).toBe(ids()[2]);
  });

  it("duplicates a slide right after it, with a copy of its content", async () => {
    const user = userEvent.setup();
    const deck = seedDeck([slideWith(createTextElement({ text: "Original" })), createSlide()]);
    render(<SlideSidebar />);
    await chooseFromSlideMenu(user, 1, "Duplicate");
    const slides = currentDeck().slides;
    expect(slides).toHaveLength(3);
    expect(slides[0].id).toBe(deck.slides[0].id);
    expect(slides[2].id).toBe(deck.slides[1].id);
    expect(slides[1].id).not.toBe(deck.slides[0].id);
    expect(slides[1].elements[0]).toMatchObject({ type: "text", text: "Original" });
    expect(slides[1].elements[0].id).not.toBe(deck.slides[0].elements[0].id);
    expect(editor().selectedSlideId).toBe(slides[1].id);
  });

  it("copies a slide to the in-app and system clipboard without changing the deck", async () => {
    const user = userEvent.setup();
    const deck = seedDeck([createSlide(), slideWith(createTextElement({ text: "Copied text" }))]);
    render(<SlideSidebar />);
    await chooseFromSlideMenu(user, 2, "Copy");
    const entry = readClipboard();
    expect(entry?.payload.kind).toBe("slides");
    if (entry?.payload.kind !== "slides") throw new Error("expected slides on the clipboard");
    expect(entry.payload.slides.map((s) => s.id)).toEqual([deck.slides[1].id]);
    expect(entry.payload.slides[0].elements[0]).toMatchObject({ text: "Copied text" });
    expect(entry.plainText).toBe("Copied text");
    expect(await navigator.clipboard.readText()).toBe("Copied text");
    expect(ids()).toEqual(deck.slides.map((s) => s.id));
  });

  it("pastes copied slides right after the slide whose menu was used", async () => {
    const user = userEvent.setup();
    const deck = seedDeck([slideWith(createTextElement({ text: "First" })), createSlide(), createSlide()]);
    render(<SlideSidebar />);
    await chooseFromSlideMenu(user, 1, "Copy");
    await chooseFromSlideMenu(user, 2, "Paste");
    const slides = currentDeck().slides;
    expect(slides).toHaveLength(4);
    expect(slides.map((s) => s.id)).toEqual([deck.slides[0].id, deck.slides[1].id, slides[2].id, deck.slides[2].id]);
    expect(slides[2].id).not.toBe(deck.slides[0].id);
    expect(slides[2].elements[0]).toMatchObject({ type: "text", text: "First" });
    expect(editor().selectedSlideId).toBe(slides[2].id);
    expect(thumbnails()).toHaveLength(4);
  });

  it("pastes copied slides after the last slide", async () => {
    const user = userEvent.setup();
    const deck = seedDeck([createSlide(), createSlide()]);
    render(<SlideSidebar />);
    await chooseFromSlideMenu(user, 1, "Copy");
    await chooseFromSlideMenu(user, 2, "Paste");
    expect(ids().slice(0, 2)).toEqual(deck.slides.map((s) => s.id));
    expect(ids()).toHaveLength(3);
    expect(editor().selectedSlideId).toBe(ids()[2]);
  });

  it("pastes copied elements onto the slide whose menu was used and selects them", async () => {
    const user = userEvent.setup();
    const copied = createShapeElement("rectangle", { locked: true });
    const deck = seedDeck([slideWith(copied), createSlide()]);
    writeClipboard({ kind: "elements", elements: [copied] }, "");
    render(<SlideSidebar />);
    expect(editor().selectedSlideId).toBe(deck.slides[0].id);
    await chooseFromSlideMenu(user, 2, "Paste");
    const target = currentDeck().slides[1];
    expect(currentDeck().slides).toHaveLength(2);
    expect(target.elements).toHaveLength(1);
    expect(target.elements[0]).toMatchObject({ type: "shape", shape: "rectangle" });
    expect(target.elements[0].id).not.toBe(copied.id);
    // Pasted copies are never locked.
    expect(target.elements[0].locked).toBeUndefined();
    expect(editor().selectedSlideId).toBe(target.id);
    expect(editor().selectedElementIds).toEqual([target.elements[0].id]);
    expect(thumbnails()[1]).toHaveAttribute("aria-current", "true");
    // The source slide is untouched.
    expect(currentDeck().slides[0].elements).toEqual(deck.slides[0].elements);
  });

  it("shows a hint when there is nothing to paste", async () => {
    const user = userEvent.setup();
    const deck = seedDeck([createSlide(), createSlide()]);
    render(<SlideSidebar />);
    await chooseFromSlideMenu(user, 2, "Paste");
    expect(toastMessages()).toEqual(["Nothing to paste yet. Copy elements or slides first."]);
    expect(ids()).toEqual(deck.slides.map((s) => s.id));
    expect(editor().selectedSlideId).toBe(deck.slides[0].id);
  });

  it("disables Move up on the first slide and Move down on the last", async () => {
    const user = userEvent.setup();
    seedDeck([createSlide(), createSlide()]);
    render(<SlideSidebar />);
    await user.click(screen.getByRole("button", { name: "Slide 1 actions" }));
    expect(screen.getByRole("menuitem", { name: "Move up" })).toBeDisabled();
    expect(screen.getByRole("menuitem", { name: "Move down" })).toBeEnabled();
    await user.keyboard("{Escape}");
    await user.click(screen.getByRole("button", { name: "Slide 2 actions" }));
    expect(screen.getByRole("menuitem", { name: "Move up" })).toBeEnabled();
    expect(screen.getByRole("menuitem", { name: "Move down" })).toBeDisabled();
  });

  it("disables both moves when there is only one slide", async () => {
    const user = userEvent.setup();
    seedDeck([createSlide()]);
    render(<SlideSidebar />);
    await user.click(screen.getByRole("button", { name: "Slide 1 actions" }));
    expect(screen.getByRole("menuitem", { name: "Move up" })).toBeDisabled();
    expect(screen.getByRole("menuitem", { name: "Move down" })).toBeDisabled();
  });

  it("moves slides up and down from the menu", async () => {
    const user = userEvent.setup();
    const deck = seedDeck([createSlide(), createSlide(), createSlide()]);
    const [a, b, c] = deck.slides.map((s) => s.id);
    render(<SlideSidebar />);
    await chooseFromSlideMenu(user, 3, "Move up");
    expect(ids()).toEqual([a, c, b]);
    await chooseFromSlideMenu(user, 1, "Move down");
    expect(ids()).toEqual([c, a, b]);
    expect(thumbnails()).toHaveLength(3);
  });

  it("deletes a slide from the menu", async () => {
    const user = userEvent.setup();
    const deck = seedDeck([createSlide(), createSlide(), createSlide()]);
    render(<SlideSidebar />);
    await chooseFromSlideMenu(user, 2, "Delete");
    expect(ids()).toEqual([deck.slides[0].id, deck.slides[2].id]);
    expect(thumbnails()).toHaveLength(2);
    expect(screen.getByLabelText("Slides")).toHaveTextContent("2");
  });

  it("duplicates, moves and deletes from the slide menu", async () => {
    const user = userEvent.setup();
    const deck = seedDeck([createSlide(), createSlide()]);
    render(<SlideSidebar />);
    await chooseFromSlideMenu(user, 1, "Duplicate");
    expect(currentDeck().slides).toHaveLength(3);
    await chooseFromSlideMenu(user, 3, "Move up");
    expect(currentDeck().slides[1].id).toBe(deck.slides[1].id);
    await chooseFromSlideMenu(user, 1, "Move down");
    expect(currentDeck().slides[1].id).toBe(deck.slides[0].id);
    await chooseFromSlideMenu(user, 2, "Delete");
    expect(currentDeck().slides.some((s) => s.id === deck.slides[0].id)).toBe(false);
  });

  it("updates when slides change elsewhere", () => {
    seedDeck([createSlide()]);
    render(<SlideSidebar />);
    act(() => {
      editor().addSlide();
    });
    expect(thumbnails()).toHaveLength(2);
    expect(thumbnails()[1]).toHaveAttribute("aria-current", "true");
  });

  describe("AI highlight", () => {
    it("rings only the slides the AI changed", () => {
      const deck = seedDeck([createSlide(), createSlide(), createSlide()]);
      render(<SlideSidebar />);
      expect(screen.queryByTestId("slide-ai-highlight")).not.toBeInTheDocument();
      act(() => {
        useEditorStore.setState({ aiHighlight: { slideIds: [deck.slides[0].id, deck.slides[2].id], elementIds: [], token: "t1" } });
      });
      const [first, second, third] = thumbnails();
      expect(screen.getAllByTestId("slide-ai-highlight")).toHaveLength(2);
      expect(highlightOf(first)).not.toBeNull();
      expect(highlightOf(second)).toBeNull();
      expect(highlightOf(third)).not.toBeNull();
      expect(highlightOf(first)).toHaveAttribute("aria-hidden");
    });

    it("ignores highlighted ids that are not in the deck", () => {
      seedDeck([createSlide()]);
      render(<SlideSidebar />);
      act(() => {
        useEditorStore.setState({ aiHighlight: { slideIds: ["missing"], elementIds: [], token: "t1" } });
      });
      expect(screen.queryByTestId("slide-ai-highlight")).not.toBeInTheDocument();
    });

    it("restarts the highlight for a new AI change and removes it when cleared", () => {
      const deck = seedDeck([createSlide(), createSlide()]);
      render(<SlideSidebar />);
      act(() => {
        useEditorStore.setState({ aiHighlight: { slideIds: [deck.slides[1].id], elementIds: [], token: "t1" } });
      });
      const before = screen.getByTestId("slide-ai-highlight");
      act(() => {
        useEditorStore.setState({ aiHighlight: { slideIds: [deck.slides[1].id], elementIds: [], token: "t2" } });
      });
      const after = screen.getByTestId("slide-ai-highlight");
      // A new token re-mounts the ring so the flash animation replays.
      expect(after).not.toBe(before);
      expect(before).not.toBeInTheDocument();
      expect(highlightOf(thumbnails()[1])).toBe(after);
      act(() => {
        editor().clearAiHighlight();
      });
      expect(screen.queryByTestId("slide-ai-highlight")).not.toBeInTheDocument();
    });

    it("keeps the same ring while the token is unchanged", () => {
      const deck = seedDeck([createSlide(), createSlide()]);
      render(<SlideSidebar />);
      act(() => {
        useEditorStore.setState({ aiHighlight: { slideIds: [deck.slides[0].id], elementIds: [], token: "same" } });
      });
      const before = screen.getByTestId("slide-ai-highlight");
      act(() => {
        editor().selectSlide(deck.slides[1].id);
      });
      expect(screen.getByTestId("slide-ai-highlight")).toBe(before);
    });
  });
});

describe("pasteAtSlide", () => {
  it("shows an info toast and changes nothing when the clipboard is empty", () => {
    const deck = seedDeck([createSlide()]);
    pasteAtSlide(deck.slides[0].id, 0);
    expect(toastMessages()).toEqual(["Nothing to paste yet. Copy elements or slides first."]);
    expect(currentDeck().slides).toHaveLength(1);
    expect(currentDeck().slides[0].elements).toHaveLength(0);
  });

  it("inserts copied slides at index + 1", () => {
    const deck = seedDeck([createSlide(), createSlide(), createSlide()]);
    const copied = slideWith(createTextElement({ text: "Pasted" }));
    writeClipboard({ kind: "slides", slides: [copied, createSlide()] }, "Pasted");
    pasteAtSlide(deck.slides[0].id, 0);
    const slides = currentDeck().slides;
    expect(slides).toHaveLength(5);
    expect(slides[0].id).toBe(deck.slides[0].id);
    expect(slides[1].elements[0]).toMatchObject({ text: "Pasted" });
    expect(slides[3].id).toBe(deck.slides[1].id);
    expect(slides[4].id).toBe(deck.slides[2].id);
    expect(editor().selectedSlideId).toBe(slides[1].id);
  });

  it("puts copied elements onto the given slide and selects that slide", () => {
    const deck = seedDeck([createSlide(), createSlide()]);
    const text = createTextElement({ text: "A" });
    const shape = createShapeElement("ellipse");
    writeClipboard({ kind: "elements", elements: [text, shape] }, "A");
    pasteAtSlide(deck.slides[1].id, 1);
    const target = currentDeck().slides[1];
    expect(currentDeck().slides).toHaveLength(2);
    expect(currentDeck().slides[0].elements).toHaveLength(0);
    expect(target.elements.map((e) => e.type)).toEqual(["text", "shape"]);
    expect(editor().selectedSlideId).toBe(target.id);
    expect(editor().selectedElementIds).toEqual(target.elements.map((e) => e.id));
  });
});

describe("applyDragEnd", () => {
  const slides = [createSlide(), createSlide(), createSlide()];
  const event = (activeId: string, overId: string | null) =>
    ({ active: { id: activeId }, over: overId ? { id: overId } : null }) as unknown as Pick<DragEndEvent, "active" | "over">;

  it("moves the dragged slide to the drop target's index", () => {
    const move = vi.fn();
    applyDragEnd(slides, event(slides[0].id, slides[2].id), move);
    expect(move).toHaveBeenCalledWith(slides[0].id, 2);
    applyDragEnd(slides, event(slides[2].id, slides[0].id), move);
    expect(move).toHaveBeenLastCalledWith(slides[2].id, 0);
  });

  it("ignores drops outside the list, on itself or on unknown targets", () => {
    const move = vi.fn();
    applyDragEnd(slides, event(slides[0].id, null), move);
    applyDragEnd(slides, event(slides[0].id, slides[0].id), move);
    applyDragEnd(slides, event(slides[0].id, "missing"), move);
    expect(move).not.toHaveBeenCalled();
  });
});
