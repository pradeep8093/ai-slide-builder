import { describe, expect, it } from "vitest";
import {
  FONT_SIZE_MAX,
  FONT_SIZE_MIN,
  MAX_CHART_CATEGORIES,
  MAX_CHART_SERIES,
  MAX_TABLE_CELL_LENGTH,
  MAX_TABLE_COLS,
  MAX_TABLE_ROWS,
  MAX_TEXT_LENGTH,
  SLIDE_HEIGHT,
  SLIDE_WIDTH,
} from "./constants";
import { createChartElement, createImageElement, createShapeElement, createTableElement, createTextElement } from "./factory";
import {
  applyElementPatch,
  DEFAULT_LINE_COLOR,
  elementsEqual,
  isGeometryKey,
  normalizeChartData,
  normalizeCrop,
  normalizeTableRows,
  sanitizeElement,
} from "./sanitize";
import { slideElementSchema, type ImageElement } from "./schema";

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
    expect(elementsEqual(a, { ...a, series: [{ name: "Series 1", values: [12, 19, 15, 24] }] })).toBe(false);
  });

  it("compares table rows and image crops deeply", () => {
    const table = createTableElement();
    expect(elementsEqual(table, { ...table, rows: structuredClone(table.rows) })).toBe(true);
    expect(elementsEqual(table, { ...table, rows: [["Header 1", "Header 2", "Header 3"], ["", "x", ""], ["", "", ""]] })).toBe(false);

    const img = { ...createImageElement("data:image/png;base64,AAAA", 100, 100), crop: { x: 0.1, y: 0.1, width: 0.5, height: 0.5 } };
    expect(elementsEqual(img, { ...img, crop: { x: 0.1, y: 0.1, width: 0.5, height: 0.5 } })).toBe(true);
    expect(elementsEqual(img, { ...img, crop: { x: 0.2, y: 0.1, width: 0.5, height: 0.5 } })).toBe(false);
    const uncropped: ImageElement = { ...img };
    delete uncropped.crop;
    expect(elementsEqual(img, uncropped)).toBe(false);
  });

  it("notices lock, group and chart option changes", () => {
    const text = createTextElement();
    expect(elementsEqual(text, { ...text, locked: true })).toBe(false);
    expect(elementsEqual(text, { ...text, groupId: "g" })).toBe(false);
    const chart = createChartElement("bar");
    expect(elementsEqual(chart, { ...chart, stacked: true })).toBe(false);
    // An explicitly undefined field is the same as a missing one.
    expect(elementsEqual(chart, { ...chart, stacked: undefined })).toBe(true);
  });
});

describe("isGeometryKey", () => {
  it("is true only for position and size keys", () => {
    for (const key of ["x", "y", "width", "height"]) expect(isGeometryKey(key)).toBe(true);
    for (const key of ["crop", "text", "rows", "locked", "groupId", "fontSize", ""]) expect(isGeometryKey(key)).toBe(false);
  });
});

describe("normalizeTableRows", () => {
  it("falls back to a single empty cell for missing or empty rows", () => {
    expect(normalizeTableRows(undefined)).toEqual([[""]]);
    expect(normalizeTableRows("nope")).toEqual([[""]]);
    expect(normalizeTableRows([])).toEqual([[""]]);
    expect(normalizeTableRows([[]])).toEqual([[""]]);
  });

  it("makes rows rectangular and cells strings", () => {
    expect(normalizeTableRows([["a"], ["b", "c"], "d", [null, undefined, 3, true]])).toEqual([
      ["a", "", "", ""],
      ["b", "c", "", ""],
      ["d", "", "", ""],
      ["", "", "3", "true"],
    ]);
  });

  it("enforces the row, column and cell length limits", () => {
    const rows = Array.from({ length: MAX_TABLE_ROWS + 5 }, () => Array.from({ length: MAX_TABLE_COLS + 3 }, () => "x".repeat(MAX_TABLE_CELL_LENGTH + 20)));
    const out = normalizeTableRows(rows);
    expect(out).toHaveLength(MAX_TABLE_ROWS);
    for (const row of out) {
      expect(row).toHaveLength(MAX_TABLE_COLS);
      for (const cell of row) expect(cell).toHaveLength(MAX_TABLE_CELL_LENGTH);
    }
  });
});

describe("normalizeCrop", () => {
  it("returns undefined for missing or invalid crops", () => {
    expect(normalizeCrop(undefined)).toBeUndefined();
    expect(normalizeCrop(null)).toBeUndefined();
    expect(normalizeCrop("crop")).toBeUndefined();
    expect(normalizeCrop({ x: 0, y: 0, width: 0.5 })).toBeUndefined();
    expect(normalizeCrop({ x: Number.NaN, y: 0, width: 0.5, height: 0.5 })).toBeUndefined();
    expect(normalizeCrop({ x: 0, y: 0, width: Infinity, height: 0.5 })).toBeUndefined();
    expect(normalizeCrop({ x: "0", y: 0, width: 0.5, height: 0.5 })).toBeUndefined();
  });

  it("treats a crop of the whole image as no crop", () => {
    expect(normalizeCrop({ x: 0, y: 0, width: 1, height: 1 })).toBeUndefined();
    expect(normalizeCrop({ x: -1, y: -1, width: 5, height: 5 })).toBeUndefined();
  });

  it("keeps valid crops", () => {
    expect(normalizeCrop({ x: 0.1, y: 0.2, width: 0.5, height: 0.6 })).toEqual({ x: 0.1, y: 0.2, width: 0.5, height: 0.6 });
    expect(normalizeCrop({ x: 0, y: 0, width: 1, height: 0.5 })).toEqual({ x: 0, y: 0, width: 1, height: 0.5 });
  });

  it("clamps crops into the image with at least 1% in each direction", () => {
    expect(normalizeCrop({ x: -0.5, y: 0.25, width: 0.5, height: 0.9 })).toEqual({ x: 0, y: 0.25, width: 0.5, height: 0.75 });
    expect(normalizeCrop({ x: 1.5, y: 0, width: 0.5, height: 0.5 })).toEqual({ x: 0.99, y: 0, width: expect.closeTo(0.01, 6), height: 0.5 });
    expect(normalizeCrop({ x: 0.2, y: 0.2, width: 0, height: -1 })).toEqual({ x: 0.2, y: 0.2, width: 0.01, height: 0.01 });
  });
});

describe("tables and crops in sanitizeElement", () => {
  it("normalizes table rows and font size", () => {
    const table = sanitizeElement({ ...createTableElement(), rows: [["a", "b"], ["c"]], fontSize: 13.6 });
    expect(table.rows).toEqual([
      ["a", "b"],
      ["c", ""],
    ]);
    expect(table.fontSize).toBe(14);
    expect(sanitizeElement({ ...createTableElement(), fontSize: Number.NaN }).fontSize).toBe(20);
    expect(sanitizeElement({ ...createTableElement(), fontSize: 999 }).fontSize).toBe(FONT_SIZE_MAX);
    expect(slideElementSchema.safeParse(table).success).toBe(true);
  });

  it("normalizes image crops and drops full or invalid ones", () => {
    const img = createImageElement("data:image/png;base64,AAAA", 100, 100);
    expect(sanitizeElement({ ...img, crop: { x: 0.5, y: 0, width: 0.9, height: 1 } }).crop).toEqual({ x: 0.5, y: 0, width: 0.5, height: 1 });
    expect(sanitizeElement({ ...img, crop: { x: 0, y: 0, width: 1, height: 1 } })).not.toHaveProperty("crop");
    expect(sanitizeElement({ ...img, crop: { x: Number.NaN, y: 0, width: 1, height: 1 } })).not.toHaveProperty("crop");
    expect(sanitizeElement(img)).not.toHaveProperty("crop");
  });

  it("keeps locks and groups", () => {
    const el = sanitizeElement(createTableElement({ locked: true, groupId: "g" }));
    expect(el).toMatchObject({ locked: true, groupId: "g" });
  });
});

describe("applyElementPatch for tables, crops and chart options", () => {
  it("updates table cells and styling", () => {
    const table = applyElementPatch(createTableElement(), {
      rows: [["Name", "Score"], ["Ann"]],
      headerRow: false,
      headerFill: null,
      borderColor: "#ABC",
      fontFamily: "Georgia",
      color: "#000",
      fontSize: 18,
    });
    expect(table).toMatchObject({
      rows: [
        ["Name", "Score"],
        ["Ann", ""],
      ],
      headerRow: false,
      headerFill: null,
      borderColor: "#aabbcc",
      fontFamily: "Georgia",
      color: "#000000",
      fontSize: 18,
    });
  });

  it("ignores invalid table values and fields of other types", () => {
    const table = createTableElement();
    const patched = applyElementPatch(table, {
      rows: "a\tb" as never,
      headerRow: "no" as never,
      headerFill: "nope",
      text: "x",
      bold: true,
      fill: "#ff0000",
      crop: { x: 0, y: 0, width: 0.5, height: 0.5 },
    });
    expect(patched).toEqual(table);
  });

  it("switches chart options on and off", () => {
    const chart = applyElementPatch(createChartElement("bar"), { stacked: true, showValues: true, dualAxis: true });
    expect(chart).toMatchObject({ stacked: true, showValues: true, dualAxis: true });
    expect(applyElementPatch(chart, { stacked: false, showValues: "yes" as never })).toMatchObject({ stacked: false, showValues: true });
    expect(applyElementPatch(createTextElement(), { stacked: true })).not.toHaveProperty("stacked");
  });

  it("sets and removes image crops without forcing the old aspect ratio", () => {
    const img = { ...createImageElement("data:image/png;base64,AAAA", 200, 100), width: 200, height: 100 };
    const cropped = applyElementPatch(img, { crop: { x: 0, y: 0, width: 0.5, height: 1 }, width: 100 });
    expect(cropped).toMatchObject({ width: 100, height: 100, crop: { x: 0, y: 0, width: 0.5, height: 1 } });

    const uncropped = applyElementPatch(cropped, { crop: null, width: 200 });
    expect(uncropped).toMatchObject({ width: 200, height: 100 });
    expect(uncropped).not.toHaveProperty("crop");

    // A crop covering the whole picture is stored as no crop.
    expect(applyElementPatch(cropped, { crop: { x: 0, y: 0, width: 1, height: 1 } })).not.toHaveProperty("crop");
  });

  it("lets a replaced image keep a new size, but not an invalid source", () => {
    const img = { ...createImageElement("data:image/png;base64,AAAA", 200, 100), width: 200, height: 100 };
    expect(applyElementPatch(img, { src: "data:image/webp;base64,NEW", width: 400 })).toMatchObject({ src: "data:image/webp;base64,NEW", width: 400, height: 100 });
    // An ignored source means the aspect ratio still applies.
    expect(applyElementPatch(img, { src: "javascript:alert(1)", width: 400 })).toMatchObject({ src: img.src, width: 400, height: 200 });
  });

  it("can't change locks or groups", () => {
    const el = createTextElement({ locked: true, groupId: "g" });
    const patched = applyElementPatch(el, { locked: false, groupId: "other", id: "new", type: "shape" } as never);
    expect(patched).toEqual(el);
  });
});
