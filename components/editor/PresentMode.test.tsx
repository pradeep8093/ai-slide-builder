import { afterEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createSlide, createTextElement } from "@/lib/factory";
import PresentMode, { CONTROLS_HIDE_MS } from "./PresentMode";

const slides = [1, 2, 3].map((n) => ({ ...createSlide(), elements: [createTextElement({ text: `Slide text ${n}` })] }));
const counter = () => screen.getByTestId("present-counter").textContent;

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
});
