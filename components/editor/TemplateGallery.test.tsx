import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { currentDeck, editor, seedDeck, toastMessages } from "@/test/utils";
import { createSlide } from "@/lib/factory";
import { getTemplates } from "@/lib/templates";
import TemplateGallery from "./TemplateGallery";

describe("TemplateGallery", () => {
  it("lists every template with its slide count", () => {
    seedDeck([]);
    render(<TemplateGallery onClose={() => undefined} />);
    for (const t of getTemplates()) {
      expect(screen.getByRole("button", { name: `${t.name} template, ${t.slides.length} slides` })).toBeInTheDocument();
    }
  });

  it("applies a template immediately to an empty deck and fills the title", async () => {
    const user = userEvent.setup();
    seedDeck([], "");
    const onClose = vi.fn();
    render(<TemplateGallery onClose={onClose} />);
    await user.click(screen.getByRole("button", { name: /Quarterly Review template/ }));
    expect(currentDeck().title).toBe("Quarterly Review");
    expect(currentDeck().slides).toHaveLength(5);
    expect(onClose).toHaveBeenCalled();
    expect(toastMessages()[0]).toContain("Quarterly Review");
  });

  it("asks before replacing existing slides and can be cancelled", async () => {
    const user = userEvent.setup();
    const deck = seedDeck([createSlide(), createSlide()], "Mine");
    const onClose = vi.fn();
    render(<TemplateGallery onClose={onClose} />);
    await user.click(screen.getByRole("button", { name: /Pitch Deck template/ }));
    expect(screen.getByRole("dialog", { name: "Replace your slides?" })).toHaveTextContent("your 2 slides");
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(currentDeck().slides.map((s) => s.id)).toEqual(deck.slides.map((s) => s.id));
    expect(screen.getByRole("dialog", { name: "Templates" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /Pitch Deck template/ }));
    await user.click(screen.getByRole("button", { name: "Replace slides" }));
    expect(currentDeck().title).toBe("Pitch Deck");
    expect(onClose).toHaveBeenCalled();
    editor().undo();
    expect(currentDeck().title).toBe("Mine");
  });

  it("uses singular wording for one slide", async () => {
    const user = userEvent.setup();
    seedDeck([createSlide()]);
    render(<TemplateGallery onClose={() => undefined} />);
    await user.click(screen.getByRole("button", { name: /Product Launch template/ }));
    expect(screen.getByRole("dialog", { name: "Replace your slides?" })).toHaveTextContent("replace your slide and");
  });
});
