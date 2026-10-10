import { afterEach, describe, expect, it, vi } from "vitest";
import { act, render, screen } from "@testing-library/react";
import { useRef } from "react";
import { useElementSize } from "./useElementSize";

function Probe() {
  const ref = useRef<HTMLDivElement>(null);
  const size = useElementSize(ref);
  return (
    <div ref={ref} data-testid="probe">
      {size.width}x{size.height}
    </div>
  );
}

afterEach(() => vi.restoreAllMocks());

describe("useElementSize", () => {
  it("measures on mount and on ResizeObserver callbacks", () => {
    let callback: () => void = () => undefined;
    const disconnect = vi.fn();
    vi.stubGlobal(
      "ResizeObserver",
      class {
        constructor(cb: () => void) {
          callback = cb;
        }
        observe() {}
        disconnect = disconnect;
      },
    );
    let width = 300;
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(() => ({ width, height: 200 }) as DOMRect);
    const { unmount } = render(<Probe />);
    expect(screen.getByTestId("probe")).toHaveTextContent("300x200");
    width = 500;
    act(() => callback());
    expect(screen.getByTestId("probe")).toHaveTextContent("500x200");
    unmount();
    expect(disconnect).toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it("falls back to window resize events without ResizeObserver", () => {
    vi.stubGlobal("ResizeObserver", undefined);
    let width = 100;
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(() => ({ width, height: 50 }) as DOMRect);
    const remove = vi.spyOn(window, "removeEventListener");
    const { unmount } = render(<Probe />);
    width = 250;
    act(() => {
      window.dispatchEvent(new Event("resize"));
    });
    expect(screen.getByTestId("probe")).toHaveTextContent("250x50");
    unmount();
    expect(remove).toHaveBeenCalledWith("resize", expect.any(Function));
    vi.unstubAllGlobals();
  });
});
