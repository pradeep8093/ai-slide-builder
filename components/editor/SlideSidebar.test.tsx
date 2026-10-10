import { describe, expect, it, vi } from "vitest";
import { act, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { DragEndEvent } from "@dnd-kit/core";
import { currentDeck, editor, seedDeck, slideWith } from "@/test/utils";
import { createSlide, createTextElement } from "@/lib/factory";
import SlideSidebar, { applyDragEnd } from "./SlideSidebar";

function thumbnails() {
  return screen.getAllByRole("button", { name: /^Slide \d+ of \d+$/ });
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

  it("lists slides with numbers, previews and the current one marked", () => {
    const deck = seedDeck([slideWith(createTextElement({ text: "Intro" })), createSlide()]);
    render(<SlideSidebar />);
    const [first, second] = thumbnails();
    expect(first).toHaveAttribute("aria-current", "true");
    expect(second).not.toHaveAttribute("aria-current");
    expect(within(first).getByText("Intro")).toBeInTheDocument();
    expect(screen.getByLabelText("Slides")).toHaveTextContent("2");
    expect(deck.slides).toHaveLength(2);
  });

  it("selects slides by click and arrow keys", async () => {
    const user = userEvent.setup();
    const deck = seedDeck([createSlide(), createSlide(), createSlide()]);
    render(<SlideSidebar />);
    await user.click(thumbnails()[1]);
    expect(editor().selectedSlideId).toBe(deck.slides[1].id);
    await user.keyboard("{ArrowDown}");
    expect(editor().selectedSlideId).toBe(deck.slides[2].id);
    await user.keyboard("{ArrowDown}");
    expect(editor().selectedSlideId).toBe(deck.slides[2].id);
    await user.keyboard("{ArrowUp}");
    expect(editor().selectedSlideId).toBe(deck.slides[1].id);
  });

  it("deletes the focused slide with Delete and Backspace", async () => {
    const user = userEvent.setup();
    const deck = seedDeck([createSlide(), createSlide(), createSlide()]);
    render(<SlideSidebar />);
    await user.click(thumbnails()[0]);
    await user.keyboard("{Delete}");
    expect(currentDeck().slides.map((s) => s.id)).toEqual([deck.slides[1].id, deck.slides[2].id]);
    await user.click(thumbnails()[0]);
    await user.keyboard("{Backspace}");
    expect(currentDeck().slides.map((s) => s.id)).toEqual([deck.slides[2].id]);
  });

  it("duplicates, moves and deletes from the slide menu", async () => {
    const user = userEvent.setup();
    const deck = seedDeck([createSlide(), createSlide()]);
    render(<SlideSidebar />);
    await user.click(screen.getByRole("button", { name: "Slide 1 actions" }));
    expect(screen.getByRole("menuitem", { name: "Move up" })).toBeDisabled();
    await user.click(screen.getByRole("menuitem", { name: "Duplicate" }));
    expect(currentDeck().slides).toHaveLength(3);
    await user.click(screen.getByRole("button", { name: "Slide 3 actions" }));
    expect(screen.getByRole("menuitem", { name: "Move down" })).toBeDisabled();
    await user.click(screen.getByRole("menuitem", { name: "Move up" }));
    expect(currentDeck().slides[1].id).toBe(deck.slides[1].id);
    await user.click(screen.getByRole("button", { name: "Slide 1 actions" }));
    await user.click(screen.getByRole("menuitem", { name: "Move down" }));
    expect(currentDeck().slides[1].id).toBe(deck.slides[0].id);
    await user.click(screen.getByRole("button", { name: "Slide 2 actions" }));
    await user.click(screen.getByRole("menuitem", { name: "Delete" }));
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
});

describe("applyDragEnd", () => {
  const slides = [createSlide(), createSlide(), createSlide()];
  const event = (activeId: string, overId: string | null) =>
    ({ active: { id: activeId }, over: overId ? { id: overId } : null }) as unknown as Pick<DragEndEvent, "active" | "over">;

  it("moves the dragged slide to the drop target's index", () => {
    const move = vi.fn();
    applyDragEnd(slides, event(slides[0].id, slides[2].id), move);
    expect(move).toHaveBeenCalledWith(slides[0].id, 2);
  });

  it("ignores drops outside the list, on itself or on unknown targets", () => {
    const move = vi.fn();
    applyDragEnd(slides, event(slides[0].id, null), move);
    applyDragEnd(slides, event(slides[0].id, slides[0].id), move);
    applyDragEnd(slides, event(slides[0].id, "missing"), move);
    expect(move).not.toHaveBeenCalled();
  });
});
