import { describe, expect, it } from "vitest";
import { FONT_SIZE_MAX, FONT_SIZE_MIN, MAX_CHART_CATEGORIES, MAX_CHART_SERIES, MAX_TEXT_LENGTH, SLIDE_HEIGHT, SLIDE_WIDTH } from "./constants";
import { createChartElement, createImageElement, createShapeElement, createTextElement } from "./factory";
import { applyElementPatch, DEFAULT_LINE_COLOR, elementsEqual, normalizeChartData, sanitizeElement } from "./sanitize";
import { slideElementSchema } from "./schema";

describe("normalizeChartData", () => {
  it("pads missing values with 0 and truncates extra ones", () => {
    expect(normalizeChartData(["a", "b", "c"], [{ name: "s", values: [1] }, { name: "t", values: [1, 2, 3, 4] }])).toEqual({
      categories: ["a", "b", "c"],
      series: [
        { name: "s", values: [1, 0, 0] },
        { name: "t", values: [1, 2, 3] },
      ],
    });
  });
  it("replaces non-finite values, missing names and invalid categories", () => {
    const out = normalizeChartData([1, null, "x"], [{ name: "", values: [Number.NaN, Infinity, 5] }]);
    expect(out.categories).toEqual(["1", "Item 2", "x"]);
    expect(out.series).toEqual([{ name: "Series 1", values: [0, 0, 5] }]);
  });
  it("never returns empty data", () => {
    expect(normalizeChartData([], [])).toEqual({ categories: ["Item 1"], series: [{ name: "Series 1", values: [0] }] });
  });
  it("enforces the category and series limits", () => {
    const cats = Array.from({ length: 40 }, (_, i) => `c${i}`);
    const series = Array.from({ length: 12 }, (_, i) => ({ name: `s${i}`, values: [] }));
    const out = normalizeChartData(cats, series);
    expect(out.categories).toHaveLength(MAX_CHART_CATEGORIES);
    expect(out.series).toHaveLength(MAX_CHART_SERIES);
  });
});

describe("sanitizeElement", () => {
  it("clamps font size and truncates text", () => {
    const big = sanitizeElement(createTextElement({ fontSize: 9999, text: "x".repeat(MAX_TEXT_LENGTH + 10) }));
    expect(big.fontSize).toBe(FONT_SIZE_MAX);
    expect(big.text).toHaveLength(MAX_TEXT_LENGTH);
    expect(sanitizeElement(createTextElement({ fontSize: 1 })).fontSize).toBe(FONT_SIZE_MIN);
  });
  it("replaces non-finite geometry", () => {
    const el = sanitizeElement(createShapeElement("rectangle", { x: Number.NaN, width: Infinity }));
    expect(Number.isFinite(el.x)).toBe(true);
    expect(Number.isFinite(el.width)).toBe(true);
  });
  it("forces lines to have a visible stroke and no fill", () => {
    const line = sanitizeElement(createShapeElement("line", { stroke: null, strokeWidth: 0, fill: "#ff0000" }));
    expect(line).toMatchObject({ stroke: DEFAULT_LINE_COLOR, strokeWidth: 1, fill: null });
  });
  it("fits oversized images within the slide preserving aspect ratio", () => {
    const img = sanitizeElement({ ...createImageElement("data:image/png;base64,AAAA", 100, 100), width: 4000, height: 2000 });
    expect(img.width).toBeLessThanOrEqual(SLIDE_WIDTH);
    expect(img.height).toBeLessThanOrEqual(SLIDE_HEIGHT);
    expect(img.width / img.height).toBeCloseTo(2, 1);
  });
  it("keeps chart data rectangular", () => {
    const chart = sanitizeElement({ ...createChartElement("bar"), categories: ["a", "b"], series: [{ name: "s", values: [1] }] });
    expect(chart.series[0].values).toEqual([1, 0]);
    expect(slideElementSchema.safeParse(chart).success).toBe(true);
  });
});

describe("applyElementPatch", () => {
  it("applies valid fields for the element type", () => {
    const text = applyElementPatch(createTextElement(), { text: "Hi", bold: true, color: "#F00", align: "center", fontFamily: "Georgia" });
    expect(text).toMatchObject({ text: "Hi", bold: true, color: "#ff0000", align: "center", fontFamily: "Georgia" });
  });
  it("ignores fields from other element types and invalid values", () => {
    const text = createTextElement();
    const patched = applyElementPatch(text, {
      fill: "#ff0000",
      color: "not-a-color",
      align: "justify" as never,
      fontFamily: "Comic Sans" as never,
      fontSize: Number.NaN,
      bold: "yes" as never,
    });
    expect(patched).toEqual(text);
  });
  it("supports clearing fill and stroke on shapes", () => {
    const shape = applyElementPatch(createShapeElement("rectangle"), { fill: null, stroke: "#000000", strokeWidth: 3 });
    expect(shape).toMatchObject({ fill: null, stroke: "#000000", strokeWidth: 3 });
  });
  it("rejects unsupported image sources", () => {
    const img = createImageElement("data:image/png;base64,AAAA", 100, 100);
    expect(applyElementPatch(img, { src: "https://example.com/x.png" }).src).toBe(img.src);
    expect(applyElementPatch(img, { src: "data:image/jpeg;base64,BBBB" }).src).toBe("data:image/jpeg;base64,BBBB");
  });
  it("keeps image aspect ratio when only one dimension changes", () => {
    const img = { ...createImageElement("data:image/png;base64,AAAA", 200, 100), width: 200, height: 100 };
    expect(applyElementPatch(img, { width: 400 })).toMatchObject({ width: 400, height: 200 });
    expect(applyElementPatch(img, { height: 50 })).toMatchObject({ width: 100, height: 50 });
    expect(applyElementPatch(img, { width: 300, height: 300 })).toMatchObject({ width: 300, height: 150 });
  });
  it("lets a new image source define a new aspect ratio", () => {
    const img = { ...createImageElement("data:image/png;base64,AAAA", 200, 100), width: 200, height: 100 };
    expect(applyElementPatch(img, { src: "data:image/png;base64,CCCC", width: 200, height: 400 })).toMatchObject({ width: 200, height: 400 });
  });
  it("normalizes chart updates", () => {
    const chart = applyElementPatch(createChartElement("bar"), { categories: ["x"], chartType: "pie", showLegend: false });
    expect(chart).toMatchObject({ categories: ["x"], chartType: "pie", showLegend: false });
    expect(chart.series[0].values).toHaveLength(1);
    expect(applyElementPatch(chart, { chartType: "radar" as never }).chartType).toBe("pie");
  });
});

describe("elementsEqual", () => {
  it("compares fields and arrays by value", () => {
    const a = createChartElement("bar");
    expect(elementsEqual(a, structuredClone(a))).toBe(true);
    expect(elementsEqual(a, { ...a, title: "x" })).toBe(false);
    expect(elementsEqual(a, { ...a, categories: ["z", "y", "x", "w"] })).toBe(false);
  });
});
