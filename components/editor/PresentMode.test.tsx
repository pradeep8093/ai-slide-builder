import { afterEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createSlide, createTextElement } from "@/lib/factory";
import PresentMode, { CONTROLS_HIDE_MS } from "./PresentMode";

const slides = [1, 2, 3].map((n) => ({ ...createSlide(), elements: [createTextElement({ text: `Slide text ${n}` })] }));
const counter = () => screen.getByTestId("present-counter").textContent;

const notedSlides = [
  { ...createSlide("#ffffff", "Welcome everyone.\nIntroduce the agenda."), elements: [createTextElement({ text: "Intro" })] },
  { ...createSlide("#ffffff", ""), elements: [createTextElement({ text: "Middle" })] },
  { ...createSlide("#ffffff", "  \n "), elements: [createTextElement({ text: "Blank notes" })] },
  { ...createSlide("#ffffff", "Thank the audience."), elements: [createTextElement({ text: "Outro" })] },
];
const notesRegion = () => screen.queryByRole("region", { name: "Speaker notes" });
const notesButton = () => screen.getByRole("button", { name: /speaker notes$/ });

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("PresentMode", () => {
  it("starts at the given slide and navigates with the keyboard", async () => {
    const user = userEvent.setup();
    const onExit = vi.fn();
    render(<PresentMode slides={slides} startIndex={1} onExit={onExit} />);
    expect(screen.getByRole("dialog", { name: "Presentation" })).toBeInTheDocument();
    expect(screen.getByText("Slide text 2")).toBeInTheDocument();
    expect(counter()).toBe("2 / 3");
    await user.keyboard("{ArrowRight}");
    expect(counter()).toBe("3 / 3");
    await user.keyboard("{ArrowLeft}{PageUp}{ArrowUp}");
    expect(counter()).toBe("1 / 3");
    await user.keyboard("{End}");
    expect(counter()).toBe("3 / 3");
    await user.keyboard("{Home}");
    expect(counter()).toBe("1 / 3");
    await user.keyboard(" {Enter}{PageDown}");
    expect(counter()).toBe("End");
    expect(screen.getByText(/End of presentation/)).toBeInTheDocument();
    await user.keyboard("{ArrowDown}");
    expect(onExit).toHaveBeenCalledWith(2);
  });

  it("clamps an out-of-range start index", () => {
    render(<PresentMode slides={slides} startIndex={99} onExit={() => undefined} />);
    expect(counter()).toBe("3 / 3");
  });

  it("advances on click and uses the on-screen controls", async () => {
    const user = userEvent.setup();
    const onExit = vi.fn();
    render(<PresentMode slides={slides} startIndex={0} onExit={onExit} />);
    await user.click(screen.getByRole("dialog", { name: "Presentation" }));
    expect(counter()).toBe("2 / 3");
    await user.click(screen.getByRole("button", { name: "Next slide" }));
    expect(counter()).toBe("3 / 3");
    await user.click(screen.getByRole("button", { name: "Previous slide" }));
    expect(counter()).toBe("2 / 3");
    await user.click(screen.getByRole("button", { name: "Exit presentation" }));
    expect(onExit).toHaveBeenCalledWith(1);
  });

  it("exits with Escape and reports the current slide", async () => {
    const user = userEvent.setup();
    const onExit = vi.fn();
    render(<PresentMode slides={slides} startIndex={2} onExit={onExit} />);
    await user.keyboard("{Escape}");
    expect(onExit).toHaveBeenCalledWith(2);
  });

  it("disables 'previous' on the first slide and hides controls after inactivity", () => {
    vi.useFakeTimers();
    render(<PresentMode slides={slides} startIndex={0} onExit={() => undefined} />);
    expect(screen.getByRole("button", { name: "Previous slide" })).toBeDisabled();
    act(() => vi.advanceTimersByTime(CONTROLS_HIDE_MS + 10));
    expect(screen.getByTestId("present-counter").parentElement).toHaveClass("opacity-0");
    fireEvent.mouseMove(screen.getByRole("dialog", { name: "Presentation" }));
    expect(screen.getByTestId("present-counter").parentElement).toHaveClass("opacity-100");
  });

  it("enters full screen when available and exits when full screen ends", async () => {
    const onExit = vi.fn();
    let fullscreen: Element | null = null;
    Object.defineProperty(document, "fullscreenElement", { configurable: true, get: () => fullscreen });
    const request = vi.fn(() => {
      fullscreen = document.querySelector('[aria-label="Presentation"]');
      return Promise.resolve();
    });
    HTMLElement.prototype.requestFullscreen = request as unknown as typeof HTMLElement.prototype.requestFullscreen;
    const exitFullscreen = vi.fn(() => Promise.resolve());
    document.exitFullscreen = exitFullscreen;
    const { unmount } = render(<PresentMode slides={slides} startIndex={1} onExit={onExit} />);
    await act(async () => undefined);
    expect(request).toHaveBeenCalled();
    fullscreen = null;
    act(() => {
      document.dispatchEvent(new Event("fullscreenchange"));
    });
    expect(onExit).toHaveBeenCalledWith(1);
    fullscreen = document.body;
    unmount();
    expect(exitFullscreen).toHaveBeenCalled();
    delete (HTMLElement.prototype as Partial<HTMLElement>).requestFullscreen;
    delete (document as Partial<Document> & { fullscreenElement?: unknown }).fullscreenElement;
  });

  describe("speaker notes", () => {
    it("shows the current slide's notes below the slide by default", () => {
      render(<PresentMode slides={notedSlides} startIndex={0} onExit={() => undefined} />);
      const notes = notesRegion()!;
      expect(notes).toBeInTheDocument();
      expect(notes).toHaveAttribute("data-testid", "present-notes");
      expect(notes.textContent).toBe("Welcome everyone.\nIntroduce the agenda.");
      // Below the slide: the notes come after the slide in the document.
      const slide = screen.getByRole("group", { name: "Slide 1 of 4" });
      expect(slide.compareDocumentPosition(notes) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
      expect(notesButton()).toHaveAccessibleName("Hide speaker notes");
      expect(notesButton()).toHaveAttribute("aria-pressed", "true");
    });

    it("follows the slide while navigating", async () => {
      const user = userEvent.setup();
      render(<PresentMode slides={notedSlides} startIndex={0} onExit={() => undefined} />);
      await user.keyboard("{End}");
      expect(notesRegion()).toHaveTextContent("Thank the audience.");
      await user.keyboard("{Home}");
      expect(notesRegion()).toHaveTextContent("Welcome everyone.");
    });

    it.each([
      ["empty", 1],
      ["whitespace-only", 2],
    ])("says there are no notes when they are %s", (_, startIndex) => {
      render(<PresentMode slides={notedSlides} startIndex={startIndex} onExit={() => undefined} />);
      expect(notesRegion()).toHaveTextContent(/^No notes for this slide\.$/);
    });

    it("hides the notes on the end screen", async () => {
      const user = userEvent.setup();
      render(<PresentMode slides={notedSlides} startIndex={3} onExit={() => undefined} />);
      await user.keyboard("{ArrowRight}");
      expect(counter()).toBe("End");
      expect(notesRegion()).toBeNull();
      await user.keyboard("{ArrowLeft}");
      expect(notesRegion()).toHaveTextContent("Thank the audience.");
    });

    it("toggles the notes with the N key", async () => {
      const user = userEvent.setup();
      render(<PresentMode slides={notedSlides} startIndex={0} onExit={() => undefined} />);
      await user.keyboard("n");
      expect(notesRegion()).toBeNull();
      expect(notesButton()).toHaveAccessibleName("Show speaker notes");
      expect(notesButton()).toHaveAttribute("aria-pressed", "false");
      await user.keyboard("N");
      expect(notesRegion()).toBeInTheDocument();
      expect(notesButton()).toHaveAccessibleName("Hide speaker notes");
      expect(notesButton()).toHaveAttribute("aria-pressed", "true");
      expect(counter()).toBe("1 / 4");
    });

    it.each(["Control", "Meta", "Alt"])("ignores N with %s held", async (modifier) => {
      const user = userEvent.setup();
      render(<PresentMode slides={notedSlides} startIndex={0} onExit={() => undefined} />);
      await user.keyboard(`{${modifier}>}n{/${modifier}}`);
      expect(notesRegion()).toBeInTheDocument();
    });

    it("toggles the notes with the notes button without changing slides", async () => {
      const user = userEvent.setup();
      render(<PresentMode slides={notedSlides} startIndex={0} onExit={() => undefined} />);
      await user.click(screen.getByRole("button", { name: "Hide speaker notes" }));
      expect(notesRegion()).toBeNull();
      expect(counter()).toBe("1 / 4");
      const show = screen.getByRole("button", { name: "Show speaker notes" });
      expect(show).toHaveAttribute("aria-pressed", "false");
      expect(show).toHaveAttribute("title", "Speaker notes (N)");
      await user.click(show);
      expect(notesRegion()).toHaveTextContent("Welcome everyone.");
      expect(counter()).toBe("1 / 4");
    });

    it("keeps the notes hidden on later slides once turned off", async () => {
      const user = userEvent.setup();
      render(<PresentMode slides={notedSlides} startIndex={0} onExit={() => undefined} />);
      await user.keyboard("n{ArrowRight}{ArrowRight}");
      expect(counter()).toBe("3 / 4");
      expect(notesRegion()).toBeNull();
      await user.keyboard("n");
      expect(notesRegion()).toHaveTextContent("No notes for this slide.");
    });

    it("does not advance when the notes area is clicked", async () => {
      const user = userEvent.setup();
      const onExit = vi.fn();
      render(<PresentMode slides={notedSlides} startIndex={0} onExit={onExit} />);
      await user.click(notesRegion()!);
      await user.click(screen.getByText(/Welcome everyone/));
      expect(counter()).toBe("1 / 4");
      // Clicking the slide itself still advances.
      await user.click(screen.getByRole("group", { name: "Slide 1 of 4" }));
      expect(counter()).toBe("2 / 4");
      await user.click(screen.getByText("No notes for this slide."));
      expect(counter()).toBe("2 / 4");
      expect(onExit).not.toHaveBeenCalled();
    });
  });
});
