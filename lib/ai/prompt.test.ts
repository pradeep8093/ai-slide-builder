import { describe, expect, it } from "vitest";
import { createChartElement, createDeck, createImageElement, createShapeElement, createSlide, createTextElement } from "../factory";
import type { Deck } from "../schema";
import { buildSystemPrompt, serializeDeckForAi } from "./prompt";

function deck(...slides: Deck["slides"]): Deck {
  return { ...createDeck("Plan"), slides };
}

describe("serializeDeckForAi", () => {
  it("uses short refs, maps them back and never includes image data", () => {
    const img = createImageElement("data:image/png;base64,SECRETPIXELS", 100, 100, "Team photo");
    const text = createTextElement({ text: "Hello" });
    const d = deck({ ...createSlide(), elements: [text, img] }, { ...createSlide("#000000"), elements: [createShapeElement("ellipse")] });
    const { context, refs } = serializeDeckForAi(d, d.slides[1].id);
    expect(context.selectedSlide).toBe("S2");
    expect(context.slideCount).toBe(2);
    expect(context.slides[0].elements?.map((e) => e.id)).toEqual(["E1", "E2"]);
    expect(context.slides[1].elements?.[0].id).toBe("E3");
    expect(refs.slides.S2).toBe(d.slides[1].id);
    expect(refs.elements.E2).toEqual({ slideId: d.slides[0].id, elementId: img.id });
    const json = JSON.stringify(context);
    expect(json).not.toContain("SECRETPIXELS");
    expect(json).toContain("Team photo");
  });

  it("has no selected slide when nothing is selected", () => {
    expect(serializeDeckForAi(deck(createSlide()), null).context.selectedSlide).toBeNull();
    expect(serializeDeckForAi(deck(), "missing").context.slides).toEqual([]);
  });

  it("abbreviates large decks but keeps the selected slide in full", () => {
    const long = "word ".repeat(400);
    const slides = Array.from({ length: 30 }, () => ({ ...createSlide(), elements: [createTextElement({ text: long }), createChartElement("bar")] }));
    const d = deck(...slides);
    const { context } = serializeDeckForAi(d, slides[5].id, 8_000);
    expect(JSON.stringify(context).length).toBeLessThanOrEqual(8_000);
    const selected = context.slides[5];
    expect(selected.elements?.[0].text).toBe(long);
    expect(selected.elements?.[1].categories).toBeDefined();
    expect(context.slides[0].elementsOmitted).toBe(true);
    expect(context.slides[0].summary?.length).toBeLessThanOrEqual(81);
  });

  it("truncates even the selected slide as a last resort", () => {
    const huge = "y".repeat(5000);
    const slides = [{ ...createSlide(), elements: [createTextElement({ text: huge })] }, createSlide()];
    const { context } = serializeDeckForAi(deck(...slides), slides[0].id, 1000);
    expect(context.slides[0].elements?.[0].text).toHaveLength(161);
    expect(context.slides[1].elementsOmitted).toBe(true);
  });

  it("uses brief detail for other slides at the first compaction level", () => {
    const long = "x".repeat(600);
    const slides = Array.from({ length: 3 }, () => ({ ...createSlide(), elements: [createTextElement({ text: long }), createChartElement("line")] }));
    const full = JSON.stringify(serializeDeckForAi(deck(...slides), slides[0].id).context).length;
    const { context } = serializeDeckForAi(deck(...slides), slides[0].id, full - 1);
    expect(context.slides[1].elements?.[0].text).toHaveLength(161);
    expect(context.slides[1].elements?.[1].dataOmitted).toBe(true);
    expect(context.slides[0].elements?.[0].text).toBe(long);
  });
});

describe("buildSystemPrompt", () => {
  it("embeds the canvas size, rules and the deck", () => {
    const d = deck({ ...createSlide(), elements: [createTextElement({ text: "Quarterly" })] });
    const prompt = buildSystemPrompt(serializeDeckForAi(d, d.slides[0].id).context);
    expect(prompt).toContain("1280 x 720");
    expect(prompt).toContain("Never invent facts");
    expect(prompt).toContain('"selectedSlide":"S1"');
    expect(prompt).toContain("Quarterly");
  });
});
