import { describe, expect, it } from "vitest";
import { createChartElement, createDeck, createImageElement, createSlide, createTextElement } from "./factory";
import { chartElementSchema, deckSchema, hexColorSchema, imageElementSchema, slideElementSchema } from "./schema";

describe("schemas", () => {
  it("validates hex colors", () => {
    expect(hexColorSchema.safeParse("#a1B2c3").success).toBe(true);
    expect(hexColorSchema.safeParse("#abc").success).toBe(false);
    expect(hexColorSchema.safeParse("red").success).toBe(false);
  });

  it("requires chart series to match the categories", () => {
    const chart = createChartElement("bar");
    expect(chartElementSchema.safeParse(chart).success).toBe(true);
    expect(chartElementSchema.safeParse({ ...chart, series: [{ name: "s", values: [1] }] }).success).toBe(false);
  });

  it("only accepts embedded raster image data", () => {
    const img = createImageElement("data:image/png;base64,AAAA", 10, 10);
    expect(imageElementSchema.safeParse(img).success).toBe(true);
    expect(imageElementSchema.safeParse({ ...img, src: "https://example.com/a.png" }).success).toBe(false);
    expect(imageElementSchema.safeParse({ ...img, src: "data:image/svg+xml;base64,AAAA" }).success).toBe(false);
  });

  it("rejects unknown element types and non-positive sizes", () => {
    expect(slideElementSchema.safeParse({ ...createTextElement(), type: "video" }).success).toBe(false);
    expect(slideElementSchema.safeParse({ ...createTextElement(), width: 0 }).success).toBe(false);
  });

  it("validates a whole deck", () => {
    const deck = { ...createDeck("x"), slides: [{ ...createSlide(), elements: [createTextElement()] }] };
    expect(deckSchema.safeParse(deck).success).toBe(true);
    expect(deckSchema.safeParse({ ...deck, version: 2 }).success).toBe(false);
  });
});
