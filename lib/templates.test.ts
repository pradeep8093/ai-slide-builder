import { describe, expect, it } from "vitest";
import { SLIDE_HEIGHT, SLIDE_WIDTH } from "./constants";
import { deckSchema } from "./schema";
import { getTemplates } from "./templates";

describe("templates", () => {
  const templates = getTemplates();

  it("are built once and reused", () => {
    expect(getTemplates()).toBe(templates);
  });

  it("have unique ids, names and at least one slide", () => {
    expect(new Set(templates.map((t) => t.id)).size).toBe(templates.length);
    for (const t of templates) {
      expect(t.name).toBeTruthy();
      expect(t.description).toBeTruthy();
      expect(t.slides.length).toBeGreaterThan(0);
    }
  });

  it.each(getTemplates().map((t) => [t.name, t] as const))("%s is a valid deck that fits the slide", (_name, template) => {
    const deck = { version: 1 as const, id: "t", title: template.name, slides: template.slides, updatedAt: 0 };
    expect(deckSchema.safeParse(deck).success).toBe(true);
    for (const slide of template.slides) {
      for (const el of slide.elements) {
        expect(el.x).toBeGreaterThanOrEqual(0);
        expect(el.y).toBeGreaterThanOrEqual(0);
        expect(el.x + el.width).toBeLessThanOrEqual(SLIDE_WIDTH);
        expect(el.y + el.height).toBeLessThanOrEqual(SLIDE_HEIGHT);
      }
    }
  });

  it("only uses placeholder copy and labels chart data as placeholder", () => {
    for (const t of templates) {
      for (const slide of t.slides) {
        for (const el of slide.elements) {
          if (el.type === "chart") expect(el.title.toLowerCase()).toContain("placeholder");
        }
      }
    }
  });
});
