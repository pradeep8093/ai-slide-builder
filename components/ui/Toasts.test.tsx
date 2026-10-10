import { afterEach, describe, expect, it, vi } from "vitest";
import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { toast } from "@/lib/store/toastStore";
import Toasts, { ERROR_TOAST_DURATION_MS, TOAST_DURATION_MS } from "./Toasts";

afterEach(() => vi.useRealTimers());

describe("Toasts", () => {
  it("shows info/success as status and errors as alerts", () => {
    render(<Toasts />);
    act(() => {
      toast.success("Saved!");
      toast.error("Broke");
    });
    expect(screen.getByRole("status")).toHaveTextContent("Saved!");
    expect(screen.getByRole("alert")).toHaveTextContent("Broke");
  });

  it("dismisses manually", async () => {
    const user = userEvent.setup();
    render(<Toasts />);
    act(() => {
      toast.info("Hello");
    });
    await user.click(screen.getByRole("button", { name: "Dismiss" }));
    expect(screen.queryByText("Hello")).not.toBeInTheDocument();
  });

  it("auto-dismisses, keeping errors on screen longer", () => {
    vi.useFakeTimers();
    render(<Toasts />);
    act(() => {
      toast.info("Quick");
      toast.error("Slow");
    });
    act(() => vi.advanceTimersByTime(TOAST_DURATION_MS + 1));
    expect(screen.queryByText("Quick")).not.toBeInTheDocument();
    expect(screen.getByText("Slow")).toBeInTheDocument();
    act(() => vi.advanceTimersByTime(ERROR_TOAST_DURATION_MS));
    expect(screen.queryByText("Slow")).not.toBeInTheDocument();
  });
});
