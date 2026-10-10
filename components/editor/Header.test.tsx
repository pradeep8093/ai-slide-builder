import { afterEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { currentDeck, editor, seedDeck, toastMessages } from "@/test/utils";
import { createSlide } from "@/lib/factory";
import Header from "./Header";

const exportPdf = vi.fn();
const exportPptx = vi.fn();
vi.mock("@/lib/export/pdf", () => ({ exportPdf: (...a: unknown[]) => exportPdf(...a) }));
vi.mock("@/lib/export/pptx", () => ({ exportPptx: (...a: unknown[]) => exportPptx(...a) }));
vi.mock("../export/captureSlide", () => ({ captureSlideImage: vi.fn() }));

function renderHeader() {
  const onOpenTemplates = vi.fn();
  const onPresent = vi.fn();
  render(<Header onOpenTemplates={onOpenTemplates} onPresent={onPresent} />);
  return { onOpenTemplates, onPresent };
}

afterEach(() => {
  exportPdf.mockReset();
  exportPptx.mockReset();
});

describe("Header", () => {
  it("edits the presentation title and trims it on blur", async () => {
    const user = userEvent.setup();
    seedDeck([createSlide()], "");
    renderHeader();
    const input = screen.getByRole("textbox", { name: "Presentation title" });
    expect(input).toHaveAttribute("placeholder", "Untitled presentation");
    await user.type(input, "  Board update  ");
    expect(currentDeck().title).toBe("  Board update  ");
    await user.tab();
    expect(currentDeck().title).toBe("Board update");
  });

  it("blurs the title on Enter and caps its length", async () => {
    const user = userEvent.setup();
    seedDeck();
    renderHeader();
    const input = screen.getByRole("textbox", { name: "Presentation title" });
    expect(input).toHaveAttribute("maxLength", "120");
    await user.click(input);
    await user.keyboard("{Enter}");
    expect(input).not.toHaveFocus();
  });

  it("undoes and redoes, disabling buttons when there is nothing to do", async () => {
    const user = userEvent.setup();
    seedDeck();
    renderHeader();
    const undo = screen.getByRole("button", { name: "Undo" });
    const redo = screen.getByRole("button", { name: "Redo" });
    expect(undo).toBeDisabled();
    expect(redo).toBeDisabled();
    act(() => {
      editor().addSlide();
    });
    expect(undo).toBeEnabled();
    await user.click(undo);
    expect(currentDeck().slides).toHaveLength(1);
    expect(redo).toBeEnabled();
    await user.click(redo);
    expect(currentDeck().slides).toHaveLength(2);
  });

  it("opens templates and starts presenting", async () => {
    const user = userEvent.setup();
    seedDeck();
    const { onOpenTemplates, onPresent } = renderHeader();
    await user.click(screen.getByRole("button", { name: "Templates" }));
    await user.click(screen.getByRole("button", { name: "Present" }));
    expect(onOpenTemplates).toHaveBeenCalled();
    expect(onPresent).toHaveBeenCalled();
  });

  it("disables present and export for an empty deck", () => {
    seedDeck([]);
    renderHeader();
    expect(screen.getByRole("button", { name: "Present" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Export" })).toBeDisabled();
  });

  it("exports to PowerPoint and PDF and reports the result", async () => {
    const user = userEvent.setup();
    seedDeck([createSlide(), createSlide()], "Deck");
    exportPptx.mockResolvedValue("Deck.pptx");
    exportPdf.mockImplementation(async (_deck, options: { onProgress: (d: number, t: number) => void }) => {
      options.onProgress(0, 2);
      return "Deck.pdf";
    });
    renderHeader();
    await user.click(screen.getByRole("button", { name: "Export" }));
    await user.click(screen.getByRole("menuitem", { name: "PowerPoint (.pptx)" }));
    await vi.waitFor(() => expect(toastMessages()).toContain("Exported Deck.pptx"));
    await user.click(screen.getByRole("button", { name: "Export" }));
    await user.click(screen.getByRole("menuitem", { name: "PDF document (.pdf)" }));
    await vi.waitFor(() => expect(toastMessages()).toContain("Exported Deck.pdf"));
    expect(exportPdf.mock.calls[0][0].slides).toHaveLength(2);
  });

  it("shows progress while exporting and reports failures", async () => {
    const user = userEvent.setup();
    seedDeck();
    let reject: (e: Error) => void = () => undefined;
    exportPptx.mockReturnValue(new Promise((_r, rej) => (reject = rej)));
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    renderHeader();
    await user.click(screen.getByRole("button", { name: "Export" }));
    await user.click(screen.getByRole("menuitem", { name: "PowerPoint (.pptx)" }));
    expect(screen.getByRole("button", { name: "Export" })).toHaveTextContent("Exporting PowerPoint…");
    expect(screen.getByRole("button", { name: "Export" })).toBeDisabled();
    await act(async () => reject(new Error("disk full")));
    expect(toastMessages()).toContain("Export failed: disk full");
    expect(screen.getByRole("button", { name: "Export" })).toHaveTextContent("Export");
  });

  it("shows the save status", () => {
    seedDeck();
    renderHeader();
    act(() => editor().setSaveStatus("saving"));
    expect(screen.getByTestId("save-status")).toHaveTextContent("Saving…");
    act(() => editor().setSaveStatus("error"));
    expect(screen.getByTestId("save-status")).toHaveTextContent("Not saved");
    act(() => editor().setSaveStatus("unavailable"));
    expect(screen.getByTestId("save-status")).toHaveTextContent("Can't save in this browser");
    fireEvent.blur(screen.getByRole("textbox", { name: "Presentation title" }));
  });
});
