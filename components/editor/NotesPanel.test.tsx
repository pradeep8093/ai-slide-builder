import { afterEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { currentDeck, editor, seedDeck } from "@/test/utils";
import { MAX_NOTES_LENGTH } from "@/lib/constants";
import { createSlide } from "@/lib/factory";
import { COALESCE_MS } from "@/lib/store/editorStore";
import NotesPanel from "./NotesPanel";

const notesBox = () => screen.queryByRole("textbox", { name: "Speaker notes" });
const toggle = () => screen.getByRole("button", { name: "Speaker notes" });
const notesOf = (index: number) => currentDeck().slides[index].notes;

function setup(notes: string[] = [""]) {
  const deck = seedDeck(notes.map((n) => createSlide("#ffffff", n)));
  const user = userEvent.setup();
  const view = render(<NotesPanel />);
  return { deck, user, ...view };
}

afterEach(() => {
  vi.useRealTimers();
});

describe("NotesPanel", () => {
  it("renders nothing when no slide is selected", () => {
    const { container } = render(<NotesPanel />);
    expect(container).toBeEmptyDOMElement();
    expect(screen.queryByTestId("notes-panel")).toBeNull();
  });

  it("renders nothing for an empty deck", () => {
    seedDeck([]);
    const { container } = render(<NotesPanel />);
    expect(container).toBeEmptyDOMElement();
  });

  it("shows the current slide's notes in an expanded editor", () => {
    setup(["Remember to smile."]);
    expect(screen.getByTestId("notes-panel")).toBeInTheDocument();
    expect(toggle()).toHaveAttribute("aria-expanded", "true");
    expect(notesBox()).toHaveValue("Remember to smile.");
    expect(notesBox()).toHaveAttribute("placeholder", "Add notes for the presenter…");
    expect(notesBox()).toHaveAttribute("maxLength", String(MAX_NOTES_LENGTH));
  });

  it("saves typed notes to the current slide through the store", async () => {
    const { user } = setup(["", ""]);
    await user.type(notesBox()!, "Hello\nworld");
    expect(notesOf(0)).toBe("Hello\nworld");
    expect(notesOf(1)).toBe("");
    expect(notesBox()).toHaveValue("Hello\nworld");
  });

  it("edits whichever slide is selected and follows selection changes", async () => {
    const { user, deck } = setup(["First notes", "Second notes"]);
    act(() => editor().selectSlide(deck.slides[1].id));
    expect(notesBox()).toHaveValue("Second notes");
    await user.type(notesBox()!, "!");
    expect(notesOf(1)).toBe("Second notes!");
    expect(notesOf(0)).toBe("First notes");
    act(() => editor().selectSlide(deck.slides[0].id));
    expect(notesBox()).toHaveValue("First notes");
  });

  it("can clear the notes", async () => {
    const { user } = setup(["Old notes"]);
    await user.clear(notesBox()!);
    expect(notesOf(0)).toBe("");
  });

  it("reflects notes changed elsewhere (e.g. undo or the AI)", () => {
    const { deck } = setup(["Before"]);
    act(() => editor().setSlideNotes(deck.slides[0].id, "After"));
    expect(notesBox()).toHaveValue("After");
  });

  it("never stores more than the notes limit", () => {
    setup([""]);
    fireEvent.change(notesBox()!, { target: { value: "x".repeat(MAX_NOTES_LENGTH + 25) } });
    expect(notesOf(0)).toHaveLength(MAX_NOTES_LENGTH);
  });

  describe("collapsing", () => {
    it("collapses and expands with the header button", async () => {
      const { user } = setup(["Some notes"]);
      await user.click(toggle());
      expect(toggle()).toHaveAttribute("aria-expanded", "false");
      expect(notesBox()).toBeNull();
      await user.click(toggle());
      expect(toggle()).toHaveAttribute("aria-expanded", "true");
      expect(notesBox()).toHaveValue("Some notes");
    });

    it("previews the first line of the notes while collapsed", async () => {
      const { user } = setup(["\n  Opening line\nSecond line\nThird line"]);
      expect(screen.queryByText("Opening line")).toBeNull();
      await user.click(toggle());
      expect(screen.getByText("Opening line")).toBeInTheDocument();
      expect(screen.queryByText(/Second line/)).toBeNull();
      await user.click(toggle());
      expect(screen.queryByText("Opening line")).toBeNull();
    });

    it("shows no preview for empty or blank notes", async () => {
      const { user, container } = setup(["   \n  "]);
      await user.click(toggle());
      expect(container.querySelector("[data-testid='notes-panel'] span")).toBeNull();
      expect(screen.getByTestId("notes-panel")).toHaveTextContent(/^Speaker notes$/);
    });

    it("updates the preview when the slide changes", async () => {
      const { user, deck } = setup(["Alpha notes", "Beta notes"]);
      await user.click(toggle());
      expect(screen.getByText("Alpha notes")).toBeInTheDocument();
      act(() => editor().selectSlide(deck.slides[1].id));
      expect(screen.getByText("Beta notes")).toBeInTheDocument();
      expect(toggle()).toHaveAttribute("aria-expanded", "false");
    });
  });

  describe("remaining characters", () => {
    it("is hidden while far from the limit", () => {
      setup(["x".repeat(MAX_NOTES_LENGTH - 500)]);
      expect(screen.queryByText(/characters left/)).toBeNull();
    });

    it("counts down once fewer than 500 characters remain", async () => {
      const { user } = setup(["x".repeat(MAX_NOTES_LENGTH - 501)]);
      expect(screen.queryByText(/characters left/)).toBeNull();
      await user.type(notesBox()!, "ab");
      expect(screen.getByText("499 characters left")).toBeInTheDocument();
    });

    it("shows zero at the limit", () => {
      setup(["x".repeat(MAX_NOTES_LENGTH)]);
      expect(screen.getByText("0 characters left")).toBeInTheDocument();
    });

    it("is hidden while collapsed", async () => {
      const { user } = setup(["x".repeat(MAX_NOTES_LENGTH - 10)]);
      expect(screen.getByText("10 characters left")).toBeInTheDocument();
      await user.click(toggle());
      expect(screen.queryByText(/characters left/)).toBeNull();
    });
  });

  describe("undo", () => {
    it("turns a burst of typing into one undo step", async () => {
      vi.useFakeTimers({ toFake: ["Date"] });
      const { user } = setup(["Draft"]);
      await user.type(notesBox()!, " one two");
      expect(notesOf(0)).toBe("Draft one two");
      expect(editor().past).toHaveLength(1);
      act(() => editor().undo());
      expect(notesOf(0)).toBe("Draft");
      expect(notesBox()).toHaveValue("Draft");
      act(() => editor().redo());
      expect(notesBox()).toHaveValue("Draft one two");
    });

    it("starts a new undo step after a pause", async () => {
      vi.useFakeTimers({ toFake: ["Date"] });
      const { user } = setup([""]);
      await user.type(notesBox()!, "First");
      vi.setSystemTime(Date.now() + COALESCE_MS + 1);
      await user.type(notesBox()!, " second");
      expect(editor().past).toHaveLength(2);
      act(() => editor().undo());
      expect(notesOf(0)).toBe("First");
      act(() => editor().undo());
      expect(notesOf(0)).toBe("");
    });

    it("keeps typing on different slides in separate undo steps", async () => {
      vi.useFakeTimers({ toFake: ["Date"] });
      const { user, deck } = setup(["", ""]);
      await user.type(notesBox()!, "one");
      act(() => editor().selectSlide(deck.slides[1].id));
      await user.type(notesBox()!, "two");
      expect(editor().past).toHaveLength(2);
      act(() => editor().undo());
      expect(notesOf(1)).toBe("");
      expect(notesOf(0)).toBe("one");
    });
  });
});
