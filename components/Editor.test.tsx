import { IDBFactory } from "fake-indexeddb";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createChartElement, createDeck, createSlide } from "@/lib/factory";
import * as persistence from "@/lib/persistence";
import { currentDeck, editor } from "@/test/utils";
import Editor from "./Editor";

vi.mock("./export/captureSlide", () => ({ captureSlideImage: vi.fn() }));

beforeEach(() => {
  globalThis.indexedDB = new IDBFactory();
  persistence.resetPersistenceForTests();
});

async function renderEditor() {
  const utils = render(<Editor />);
  await screen.findByRole("textbox", { name: "Presentation title" });
  return utils;
}

describe("Editor", () => {
  it("shows a loading state, then the empty deck with every region", async () => {
    render(<Editor />);
    expect(screen.getByRole("status")).toHaveTextContent("Loading your presentation…");
    await screen.findByText("Start your presentation");
    expect(screen.getByRole("complementary", { name: "Slides" })).toBeInTheDocument();
    expect(screen.getByRole("toolbar", { name: "Slide tools" })).toBeInTheDocument();
    expect(screen.getByRole("main", { name: "Slide editor" })).toBeInTheDocument();
    expect(screen.getByRole("complementary", { name: "AI assistant" })).toBeInTheDocument();
  });

  it("adds a slide from the empty state and shows the canvas", async () => {
    const user = userEvent.setup();
    await renderEditor();
    await user.click(screen.getByRole("button", { name: "Add slide" }));
    expect(screen.getByTestId("slide-canvas")).toBeInTheDocument();
    expect(currentDeck().slides).toHaveLength(1);
  });

  it("applies a template from the empty state and autofills the title", async () => {
    const user = userEvent.setup();
    await renderEditor();
    await user.click(screen.getByRole("button", { name: "Browse templates" }));
    await user.click(screen.getByRole("button", { name: /Project Update template/ }));
    expect(screen.getByRole("textbox", { name: "Presentation title" })).toHaveValue("Project Update");
    expect(screen.getAllByRole("button", { name: /^Slide \d+ of 5$/ })).toHaveLength(5);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("opens the template gallery from the header and closes it", async () => {
    const user = userEvent.setup();
    await renderEditor();
    await user.click(screen.getByRole("button", { name: "Templates" }));
    expect(screen.getByRole("dialog", { name: "Templates" })).toBeInTheDocument();
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("presents and returns to the slide where the show ended", async () => {
    const user = userEvent.setup();
    await persistence.saveDeck({ ...createDeck("Show"), slides: [createSlide(), createSlide()] });
    await renderEditor();
    await user.click(screen.getByRole("button", { name: "Present" }));
    expect(screen.getByRole("dialog", { name: "Presentation" })).toBeInTheDocument();
    await user.keyboard("{ArrowRight}{Escape}");
    expect(screen.queryByRole("dialog", { name: "Presentation" })).not.toBeInTheDocument();
    expect(editor().selectedSlideId).toBe(currentDeck().slides[1].id);
  });

  it("opens the chart data editor for the selected chart and disables shortcuts meanwhile", async () => {
    const user = userEvent.setup();
    const chart = createChartElement("bar");
    await persistence.saveDeck({ ...createDeck("Charts"), slides: [{ ...createSlide(), elements: [chart] }] });
    await renderEditor();
    act(() => editor().selectElement(chart.id));
    await user.click(screen.getByRole("button", { name: "Edit data" }));
    expect(screen.getByRole("dialog", { name: "Edit chart data" })).toBeInTheDocument();
    fireEvent.keyDown(document.body, { key: "Delete" });
    expect(currentDeck().slides[0].elements).toHaveLength(1);
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    fireEvent.keyDown(document.body, { key: "Delete" });
    expect(currentDeck().slides[0].elements).toHaveLength(0);
  });

  it("warns when another tab saved the deck and reloads it", async () => {
    const user = userEvent.setup();
    await renderEditor();
    const other = persistence.createTabSync(() => undefined);
    await persistence.saveDeck({ ...createDeck("Other tab"), slides: [createSlide()] });
    other.notifySaved(Date.now());
    expect(await screen.findByText(/changed in another tab/)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Reload" }));
    await vi.waitFor(() => expect(screen.getByRole("textbox", { name: "Presentation title" })).toHaveValue("Other tab"));
    other.notifySaved(Date.now());
    await screen.findByText(/changed in another tab/);
    await user.click(screen.getByRole("button", { name: "Dismiss warning" }));
    expect(screen.queryByText(/changed in another tab/)).not.toBeInTheDocument();
    other.close();
  });
});
