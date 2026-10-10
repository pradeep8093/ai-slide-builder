import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import EmptyState from "./EmptyState";
import LoadingScreen from "./LoadingScreen";

describe("EmptyState", () => {
  it("offers to add a slide or browse templates", async () => {
    const user = userEvent.setup();
    const onAddSlide = vi.fn();
    const onBrowseTemplates = vi.fn();
    render(<EmptyState onAddSlide={onAddSlide} onBrowseTemplates={onBrowseTemplates} />);
    expect(screen.getByRole("heading", { name: "Start your presentation" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Add slide" }));
    await user.click(screen.getByRole("button", { name: "Browse templates" }));
    expect(onAddSlide).toHaveBeenCalledTimes(1);
    expect(onBrowseTemplates).toHaveBeenCalledTimes(1);
  });
});

describe("LoadingScreen", () => {
  it("announces loading", () => {
    render(<LoadingScreen />);
    expect(screen.getByRole("status")).toHaveTextContent("Loading your presentation…");
  });
});
