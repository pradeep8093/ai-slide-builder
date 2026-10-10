import { afterEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { currentDeck, editor, seedDeck, toastMessages } from "@/test/utils";
import { createSlide } from "@/lib/factory";
import { downloadBlob } from "@/lib/export/html";
import { captureSlideImage, captureSlideMarkup } from "../export/captureSlide";
import Header from "./Header";

const exportPdf = vi.fn();
const exportPptx = vi.fn();
const exportHtml = vi.fn();
vi.mock("@/lib/export/pdf", () => ({ exportPdf: (...a: unknown[]) => exportPdf(...a) }));
vi.mock("@/lib/export/pptx", () => ({ exportPptx: (...a: unknown[]) => exportPptx(...a) }));
vi.mock("@/lib/export/html", () => ({ exportHtml: (...a: unknown[]) => exportHtml(...a), downloadBlob: vi.fn() }));
vi.mock("../export/captureSlide", () => ({ captureSlideImage: vi.fn(), captureSlideMarkup: vi.fn() }));

function renderHeader() {
  const props = {
    onOpenTemplates: vi.fn(),
    onPresent: vi.fn(),
    onHome: vi.fn(),
    onNewDeck: vi.fn(),
    onDuplicateDeck: vi.fn(),
    onDeleteDeck: vi.fn(),
  };
  render(<Header {...props} />);
  return props;
}

function exportButton() {
  return screen.getByRole("button", { name: "Export" });
}

async function chooseExport(user: ReturnType<typeof userEvent.setup>, item: string) {
  await user.click(exportButton());
  await user.click(screen.getByRole("menuitem", { name: item }));
}

afterEach(() => {
  exportPdf.mockReset();
  exportPptx.mockReset();
  exportHtml.mockReset();
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

  it("blurs the title on Enter and Escape and caps its length", async () => {
    const user = userEvent.setup();
    seedDeck();
    renderHeader();
    const input = screen.getByRole("textbox", { name: "Presentation title" });
    expect(input).toHaveAttribute("maxLength", "120");
    await user.click(input);
    await user.keyboard("{Enter}");
    expect(input).not.toHaveFocus();
    await user.click(input);
    await user.keyboard("{Escape}");
    expect(input).not.toHaveFocus();
  });

  it("does not record an undo step when blurring an already trimmed title", () => {
    seedDeck([createSlide()], "Clean");
    renderHeader();
    fireEvent.blur(screen.getByRole("textbox", { name: "Presentation title" }));
    expect(editor().past).toHaveLength(0);
    expect(currentDeck().title).toBe("Clean");
  });

  it("goes back to all presentations", async () => {
    const user = userEvent.setup();
    seedDeck();
    const { onHome } = renderHeader();
    await user.click(screen.getByRole("button", { name: "All presentations" }));
    expect(onHome).toHaveBeenCalledTimes(1);
  });

  it("offers new, duplicate and delete in the presentation actions menu", async () => {
    const user = userEvent.setup();
    seedDeck();
    const { onNewDeck, onDuplicateDeck, onDeleteDeck } = renderHeader();
    await user.click(screen.getByRole("button", { name: "Presentation actions" }));
    const menu = screen.getByRole("menu", { name: "Presentation actions" });
    expect(within(menu).getAllByRole("menuitem").map((item) => item.textContent)).toEqual([
      "New presentation",
      "Duplicate presentation",
      "Delete presentation",
    ]);
    await user.click(screen.getByRole("menuitem", { name: "New presentation" }));
    expect(onNewDeck).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Presentation actions" }));
    await user.click(screen.getByRole("menuitem", { name: "Duplicate presentation" }));
    expect(onDuplicateDeck).toHaveBeenCalledTimes(1);
    await user.click(screen.getByRole("button", { name: "Presentation actions" }));
    await user.click(screen.getByRole("menuitem", { name: "Delete presentation" }));
    expect(onDeleteDeck).toHaveBeenCalledTimes(1);
    expect(onNewDeck).toHaveBeenCalledTimes(1);
    expect(onDuplicateDeck).toHaveBeenCalledTimes(1);
  });

  it("keeps the presentation actions available for an empty deck", async () => {
    const user = userEvent.setup();
    seedDeck([]);
    const { onDeleteDeck } = renderHeader();
    expect(screen.getByRole("button", { name: "Presentation actions" })).toBeEnabled();
    await user.click(screen.getByRole("button", { name: "Presentation actions" }));
    await user.click(screen.getByRole("menuitem", { name: "Delete presentation" }));
    expect(onDeleteDeck).toHaveBeenCalled();
  });

  it("undoes and redoes, disabling buttons when there is nothing to do", async () => {
    const user = userEvent.setup();
    seedDeck();
    renderHeader();
    const undo = screen.getByRole("button", { name: "Undo" });
    const redo = screen.getByRole("button", { name: "Redo" });
    expect(undo).toBeDisabled();
    expect(redo).toBeDisabled();
    expect(undo.title).toMatch(/^Undo \(.+Z\)$/);
    expect(redo.title).toMatch(/^Redo \(.+Z\)$/);
    act(() => {
      editor().addSlide();
    });
    expect(undo).toBeEnabled();
    await user.click(undo);
    expect(currentDeck().slides).toHaveLength(1);
    expect(redo).toBeEnabled();
    expect(undo).toBeDisabled();
    await user.click(redo);
    expect(currentDeck().slides).toHaveLength(2);
    expect(redo).toBeDisabled();
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
    expect(screen.getByRole("button", { name: "Present" })).toHaveAttribute("title", "Add a slide to present");
    expect(exportButton()).toBeDisabled();
    expect(exportButton()).toHaveAttribute("title", "Add a slide to export");
  });

  it("offers PDF, PowerPoint and web page exports", async () => {
    const user = userEvent.setup();
    seedDeck();
    renderHeader();
    await user.click(exportButton());
    const menu = screen.getByRole("menu", { name: "Export" });
    expect(within(menu).getAllByRole("menuitem").map((item) => item.textContent)).toEqual([
      "PDF document (.pdf)",
      "PowerPoint (.pptx)",
      "Web page (.html)",
    ]);
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
    await chooseExport(user, "PowerPoint (.pptx)");
    await vi.waitFor(() => expect(toastMessages()).toContain("Exported Deck.pptx"));
    expect(exportPptx).toHaveBeenCalledWith(currentDeck());
    await chooseExport(user, "PDF document (.pdf)");
    await vi.waitFor(() => expect(toastMessages()).toContain("Exported Deck.pdf"));
    expect(exportPdf.mock.calls[0][0].slides).toHaveLength(2);
    expect(exportPdf.mock.calls[0][1].captureSlide).toBe(captureSlideImage);
    expect(exportHtml).not.toHaveBeenCalled();
  });

  it("shows PDF progress per slide", async () => {
    const user = userEvent.setup();
    seedDeck([createSlide(), createSlide()], "Deck");
    let progress: (done: number, total: number) => void = () => undefined;
    let resolve: (name: string) => void = () => undefined;
    exportPdf.mockImplementation((_deck, options: { onProgress: (d: number, t: number) => void }) => {
      progress = options.onProgress;
      return new Promise((r) => (resolve = r));
    });
    renderHeader();
    await chooseExport(user, "PDF document (.pdf)");
    expect(exportButton()).toHaveTextContent("Exporting PDF…");
    act(() => progress(0, 2));
    expect(exportButton()).toHaveTextContent("Exporting PDF 1/2…");
    act(() => progress(1, 2));
    expect(exportButton()).toHaveTextContent("Exporting PDF 2/2…");
    act(() => progress(2, 2));
    expect(exportButton()).toHaveTextContent("Exporting PDF 2/2…");
    await act(async () => resolve("Deck.pdf"));
    expect(toastMessages()).toContain("Exported Deck.pdf");
    expect(exportButton()).toHaveTextContent(/^Export$/);
  });

  it("exports a web page with slide markup and a download", async () => {
    const user = userEvent.setup();
    seedDeck([createSlide(), createSlide()], "Deck");
    exportHtml.mockResolvedValue("Deck.html");
    renderHeader();
    await chooseExport(user, "Web page (.html)");
    await vi.waitFor(() => expect(toastMessages()).toContain("Exported Deck.html"));
    expect(exportHtml).toHaveBeenCalledTimes(1);
    const [deck, options] = exportHtml.mock.calls[0];
    expect(deck).toBe(currentDeck());
    expect(options).toEqual({ renderSlide: captureSlideMarkup, download: downloadBlob });
    expect(exportPdf).not.toHaveBeenCalled();
    expect(exportPptx).not.toHaveBeenCalled();
  });

  it("shows progress while exporting a web page and reports failures", async () => {
    const user = userEvent.setup();
    seedDeck();
    let reject: (e: unknown) => void = () => undefined;
    exportHtml.mockReturnValue(new Promise((_r, rej) => (reject = rej)));
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    renderHeader();
    await chooseExport(user, "Web page (.html)");
    expect(exportButton()).toHaveTextContent("Exporting web page…");
    expect(exportButton()).toBeDisabled();
    await act(async () => reject(new Error("render failed")));
    expect(toastMessages()).toContain("Export failed: render failed");
    expect(consoleError).toHaveBeenCalled();
    expect(exportButton()).toHaveTextContent(/^Export$/);
    expect(exportButton()).toBeEnabled();
  });

  it("shows progress while exporting and reports failures", async () => {
    const user = userEvent.setup();
    seedDeck();
    let reject: (e: Error) => void = () => undefined;
    exportPptx.mockReturnValue(new Promise((_r, rej) => (reject = rej)));
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    renderHeader();
    await chooseExport(user, "PowerPoint (.pptx)");
    expect(exportButton()).toHaveTextContent("Exporting PowerPoint…");
    expect(exportButton()).toBeDisabled();
    await act(async () => reject(new Error("disk full")));
    expect(toastMessages()).toContain("Export failed: disk full");
    expect(exportButton()).toHaveTextContent("Export");
  });

  it("reports an unknown error when the export fails without an Error", async () => {
    const user = userEvent.setup();
    seedDeck();
    exportHtml.mockRejectedValue("nope");
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    renderHeader();
    await chooseExport(user, "Web page (.html)");
    await vi.waitFor(() => expect(toastMessages()).toContain("Export failed: unknown error"));
  });

  it("shows the save status", () => {
    seedDeck();
    renderHeader();
    expect(screen.getByTestId("save-status")).toHaveTextContent("");
    act(() => editor().setSaveStatus("saving"));
    expect(screen.getByTestId("save-status")).toHaveTextContent("Saving…");
    act(() => editor().setSaveStatus("saved"));
    expect(screen.getByTestId("save-status")).toHaveTextContent("Saved");
    expect(screen.getByTestId("save-status")).not.toHaveClass("text-red-600");
    act(() => editor().setSaveStatus("error"));
    expect(screen.getByTestId("save-status")).toHaveTextContent("Not saved");
    expect(screen.getByTestId("save-status")).toHaveClass("text-red-600");
    act(() => editor().setSaveStatus("unavailable"));
    expect(screen.getByTestId("save-status")).toHaveTextContent("Can't save in this browser");
    expect(screen.getByTestId("save-status")).toHaveClass("text-red-600");
  });
});
