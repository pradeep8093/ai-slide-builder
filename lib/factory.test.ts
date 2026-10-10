import { describe, expect, it } from "vitest";
import { SLIDE_HEIGHT, SLIDE_WIDTH } from "./constants";
import {
  cascadePosition,
  cloneElement,
  cloneSlide,
  createChartElement,
  createDeck,
  createImageElement,
  createShapeElement,
  createSlide,
  createTextElement,
} from "./factory";
import { deckSchema, slideElementSchema, slideSchema } from "./schema";

describe("factory", () => {
  it("creates a valid empty deck", () => {
    const deck = createDeck("Hello");
    expect(deckSchema.parse(deck)).toEqual(deck);
    expect(deck.slides).toEqual([]);
    expect(deck.title).toBe("Hello");
  });

  it("creates valid elements of every kind", () => {
    const elements = [
      createTextElement(),
      createShapeElement("rectangle"),
      createShapeElement("line"),
      createShapeElement("arrow"),
      createChartElement("pie"),
      createImageElement("data:image/png;base64,AAAA", 400, 200),
    ];
    for (const el of elements) expect(slideElementSchema.safeParse(el).success).toBe(true);
  });

  it("centers new elements on the slide", () => {
    const el = createTextElement();
    expect(el.x + el.width / 2).toBeCloseTo(SLIDE_WIDTH / 2, 0);
    expect(el.y + el.height / 2).toBeCloseTo(SLIDE_HEIGHT / 2, 0);
  });

  it("gives lines a stroke and no fill", () => {
    const line = createShapeElement("line");
    expect(line.fill).toBeNull();
    expect(line.stroke).not.toBeNull();
    expect(line.strokeWidth).toBeGreaterThan(0);
  });

  it("sizes images to their aspect ratio and at most 60% of the slide", () => {
    const img = createImageElement("data:image/png;base64,AAAA", 4000, 1000);
    expect(img.width).toBeCloseTo(SLIDE_WIDTH * 0.6, 0);
    expect(img.width / img.height).toBeCloseTo(4, 1);
    const small = createImageElement("data:image/png;base64,AAAA", 100, 50, "logo");
    expect(small).toMatchObject({ width: 100, height: 50, alt: "logo" });
  });

  it("clones elements and slides with fresh ids, deep-copying data", () => {
    const chart = createChartElement("bar");
    const copy = cloneElement(chart);
    expect(copy.id).not.toBe(chart.id);
    copy.series[0].values[0] = 999;
    expect(chart.series[0].values[0]).not.toBe(999);

    const slide = { ...createSlide("#123456"), elements: [chart, createTextElement()] };
    const slideCopy = cloneSlide(slide);
    expect(slideSchema.parse(slideCopy)).toBeTruthy();
    expect(slideCopy.id).not.toBe(slide.id);
    expect(slideCopy.background).toBe("#123456");
    expect(slideCopy.elements.map((e) => e.id)).not.toEqual(slide.elements.map((e) => e.id));
  });

  it("cascades new elements away from occupied positions", () => {
    const a = createTextElement();
    const b = createTextElement();
    const placed = cascadePosition(b, [a]);
    expect(placed).toMatchObject({ x: a.x + 20, y: a.y + 20 });
    const placed2 = cascadePosition(createTextElement(), [a, placed]);
    expect(placed2).toMatchObject({ x: a.x + 40, y: a.y + 40 });
    expect(cascadePosition(b, [])).toMatchObject({ x: b.x, y: b.y });
  });

  it("stops cascading at the slide edge", () => {
    const el = createTextElement({ x: SLIDE_WIDTH - 30, y: 10 });
    const placed = cascadePosition(createTextElement({ x: SLIDE_WIDTH - 30, y: 10 }), [el]);
    expect(placed.x).toBeLessThanOrEqual(SLIDE_WIDTH);
  });
});
