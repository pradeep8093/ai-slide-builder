import { describe, expect, expectTypeOf, it } from "vitest";
import { MAX_NOTES_LENGTH, MAX_TABLE_CELL_LENGTH, MAX_TABLE_COLS, MAX_TABLE_ROWS } from "./constants";
import { createChartElement, createDeck, createImageElement, createShapeElement, createSlide, createTableElement, createTextElement } from "./factory";
import {
  chartElementSchema,
  cropSchema,
  deckSchema,
  hexColorSchema,
  imageElementSchema,
  slideElementSchema,
  slideSchema,
  tableElementSchema,
  type ElementPatch,
  type ImageCrop,
} from "./schema";

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

  it("validates tables and requires every row to have the same number of cells", () => {
    const table = createTableElement();
    expect(tableElementSchema.safeParse(table).success).toBe(true);
    expect(slideElementSchema.safeParse(table).success).toBe(true);
    expect(tableElementSchema.safeParse({ ...table, headerFill: null, borderColor: null }).success).toBe(true);
    expect(tableElementSchema.safeParse({ ...table, rows: [["a", "b"], ["c"]] }).success).toBe(false);
    expect(slideElementSchema.safeParse({ ...table, rows: [["a", "b"], ["c"]] }).success).toBe(false);
    expect(tableElementSchema.safeParse({ ...table, rows: [] }).success).toBe(false);
    expect(tableElementSchema.safeParse({ ...table, rows: [[]] }).success).toBe(false);
    expect(tableElementSchema.safeParse({ ...table, headerFill: "blue" }).success).toBe(false);
  });

  it("enforces the table size limits", () => {
    const table = createTableElement();
    const rows = (r: number, c: number, cell = "x") => Array.from({ length: r }, () => Array.from({ length: c }, () => cell));
    expect(tableElementSchema.safeParse({ ...table, rows: rows(MAX_TABLE_ROWS, MAX_TABLE_COLS) }).success).toBe(true);
    expect(tableElementSchema.safeParse({ ...table, rows: rows(MAX_TABLE_ROWS + 1, 2) }).success).toBe(false);
    expect(tableElementSchema.safeParse({ ...table, rows: rows(2, MAX_TABLE_COLS + 1) }).success).toBe(false);
    expect(tableElementSchema.safeParse({ ...table, rows: rows(1, 1, "x".repeat(MAX_TABLE_CELL_LENGTH)) }).success).toBe(true);
    expect(tableElementSchema.safeParse({ ...table, rows: rows(1, 1, "x".repeat(MAX_TABLE_CELL_LENGTH + 1)) }).success).toBe(false);
  });

  it("keeps image crops inside the picture", () => {
    expect(cropSchema.safeParse({ x: 0.1, y: 0.2, width: 0.5, height: 0.8 }).success).toBe(true);
    expect(cropSchema.safeParse({ x: 0, y: 0, width: 1, height: 1 }).success).toBe(true);
    // A tiny rounding error is tolerated.
    expect(cropSchema.safeParse({ x: 0.5, y: 0, width: 0.50005, height: 1 }).success).toBe(true);
    expect(cropSchema.safeParse({ x: 0.5, y: 0, width: 0.6, height: 1 }).success).toBe(false);
    expect(cropSchema.safeParse({ x: 0, y: 0.5, width: 1, height: 0.6 }).success).toBe(false);
    expect(cropSchema.safeParse({ x: 0, y: 0, width: 0, height: 1 }).success).toBe(false);
    expect(cropSchema.safeParse({ x: -0.1, y: 0, width: 0.5, height: 1 }).success).toBe(false);

    const img = createImageElement("data:image/png;base64,AAAA", 10, 10);
    expect(imageElementSchema.safeParse({ ...img, crop: { x: 0, y: 0, width: 0.5, height: 0.5 } }).success).toBe(true);
    expect(imageElementSchema.safeParse({ ...img, crop: { x: 0.8, y: 0, width: 0.5, height: 0.5 } }).success).toBe(false);
  });

  it("limits speaker notes and defaults them for older decks", () => {
    expect(slideSchema.safeParse(createSlide("#ffffff", "n".repeat(MAX_NOTES_LENGTH))).success).toBe(true);
    expect(slideSchema.safeParse(createSlide("#ffffff", "n".repeat(MAX_NOTES_LENGTH + 1))).success).toBe(false);
    const legacy = { id: "s1", background: "#ffffff", elements: [] };
    expect(slideSchema.parse(legacy).notes).toBe("");
  });

  it("accepts optional locks, groups and chart options", () => {
    const text = createTextElement({ locked: true, groupId: "g1" });
    expect(slideElementSchema.safeParse(text).success).toBe(true);
    expect(slideElementSchema.safeParse({ ...text, groupId: "" }).success).toBe(false);
    expect(slideElementSchema.safeParse({ ...text, locked: "yes" }).success).toBe(false);
    expect(slideElementSchema.safeParse(createShapeElement("rectangle")).success).toBe(true);

    const chart = createChartElement("bar", { stacked: true, showValues: false, dualAxis: true });
    expect(chartElementSchema.safeParse(chart).success).toBe(true);
    expect(chartElementSchema.safeParse({ ...chart, chartType: "doughnut" }).success).toBe(true);
    expect(chartElementSchema.safeParse({ ...chart, chartType: "scatter" }).success).toBe(true);
    expect(chartElementSchema.safeParse({ ...chart, stacked: 1 }).success).toBe(false);
    expect(chartElementSchema.safeParse({ ...chart, chartType: "radar" }).success).toBe(false);
  });

  it("types element patches without ids, types, locks or groups", () => {
    expectTypeOf<ElementPatch>().toHaveProperty("crop");
    expectTypeOf<ElementPatch["crop"]>().toEqualTypeOf<ImageCrop | null | undefined>();
    expectTypeOf<ElementPatch>().toHaveProperty("rows");
    expectTypeOf<ElementPatch>().toHaveProperty("stacked");
    expectTypeOf<ElementPatch>().toHaveProperty("headerFill");
    expectTypeOf<ElementPatch>().not.toHaveProperty("locked");
    expectTypeOf<ElementPatch>().not.toHaveProperty("groupId");
    expectTypeOf<ElementPatch>().not.toHaveProperty("id");
    expectTypeOf<ElementPatch>().not.toHaveProperty("type");
    const patch: ElementPatch = { crop: null, rows: [["a"]], stacked: true, text: "x", x: 1 };
    expect(Object.keys(patch)).toHaveLength(5);
  });
});
