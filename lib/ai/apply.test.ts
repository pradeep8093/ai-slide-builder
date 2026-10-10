import { describe, expect, it } from "vitest";
import { MAX_ELEMENTS_PER_SLIDE, MAX_SLIDES } from "../constants";
import { createChartElement, createDeck, createImageElement, createShapeElement, createSlide, createTextElement } from "../factory";
import { deckSchema, type Deck } from "../schema";
import { applyOperations, elementFromSpec, MAX_OPERATIONS, type AiRefs } from "./apply";
import type { AiElementChanges, AiOperation } from "./schema";

const NO_CHANGES: AiElementChanges = {
  x: null, y: null, width: null, height: null, text: null, fontSize: null, fontFamily: null, color: null, bold: null, italic: null,
  underline: null, align: null, shape: null, fill: null, stroke: null, strokeWidth: null, chartType: null, title: null, categories: null,
  series: null, showLegend: null, alt: null,
};

function deckWith(...slides: Deck["slides"]): Deck {
  return { ...createDeck("Deck"), slides };
}

function refsFor(deck: Deck): AiRefs {
  const refs: AiRefs = { slides: {}, elements: {} };
  let n = 0;
  deck.slides.forEach((s, i) => {
    refs.slides[`S${i + 1}`] = s.id;
    s.elements.forEach((e) => {
      n += 1;
      refs.elements[`E${n}`] = { slideId: s.id, elementId: e.id };
    });
  });
  return refs;
}

const textSpec = {
  type: "text" as const, x: 64, y: 64, width: 800, height: 80, text: "Title", fontSize: 48, fontFamily: "Georgia" as const,
  color: "#FFF", bold: true, italic: null, underline: null, align: "center" as const,
};

describe("elementFromSpec", () => {
  it("builds text with defaults for null fields and normalized colors", () => {
    const el = elementFromSpec(textSpec);
    expect(el).toMatchObject({ type: "text", text: "Title", fontSize: 48, fontFamily: "Georgia", color: "#ffffff", bold: true, italic: false, align: "center" });
  });
  it("understands 'none' for shape fill/stroke and null for defaults", () => {
    const el = elementFromSpec({ type: "shape", shape: "ellipse", x: 0, y: 0, width: 100, height: 100, fill: "none", stroke: "#000", strokeWidth: 2 });
    expect(el).toMatchObject({ fill: null, stroke: "#000000", strokeWidth: 2 });
    const def = elementFromSpec({ type: "shape", shape: "rectangle", x: 0, y: 0, width: 100, height: 100, fill: null, stroke: "transparent", strokeWidth: null });
    expect(def).toMatchObject({ fill: createShapeElement("rectangle").fill, stroke: null });
    const bad = elementFromSpec({ type: "shape", shape: "rectangle", x: 0, y: 0, width: 100, height: 100, fill: "purple-ish", stroke: null, strokeWidth: null });
    expect(bad.type === "shape" && bad.fill).toBe(createShapeElement("rectangle").fill);
  });
  it("normalizes chart data from the model", () => {
    const el = elementFromSpec({
      type: "chart", chartType: "line", x: 0, y: 0, width: 600, height: 400, title: null, categories: ["a", "b"],
      series: [{ name: "s", values: [1] }], showLegend: null,
    });
    expect(el).toMatchObject({ type: "chart", chartType: "line", title: "", categories: ["a", "b"], series: [{ name: "s", values: [1, 0] }] });
  });
});

describe("applyOperations", () => {
  it("never mutates the input deck", () => {
    const deck = deckWith(createSlide());
    const snapshot = structuredClone(deck);
    applyOperations(deck, [{ op: "set_title", title: "New" }, { op: "add_slide", position: 1, background: null, elements: [textSpec] }], null);
    expect(deck).toEqual(snapshot);
  });

  it("builds a deck from scratch", () => {
    const deck = deckWith();
    const ops: AiOperation[] = [
      { op: "set_title", title: "  Offsite  " },
      { op: "add_slide", position: null, background: "#0f172a", elements: [textSpec] },
      { op: "add_slide", position: null, background: "bogus", elements: [] },
      { op: "add_slide", position: 1, background: null, elements: [] },
    ];
    const { deck: next, report, focusSlideId } = applyOperations(deck, ops, null);
    expect(report).toMatchObject({ applied: 4, skipped: [] });
    expect(next.title).toBe("Offsite");
    expect(next.slides).toHaveLength(3);
    expect(next.slides[1].background).toBe("#0f172a");
    expect(next.slides[2].background).toBe("#ffffff");
    expect(focusSlideId).toBe(next.slides[0].id);
    expect(deckSchema.safeParse(next).success).toBe(true);
    expect(report.changes).toEqual(["Renamed the deck to “Offsite”", "Added slide 1", "Added slide 2", "Added slide 1"]);
  });

  it("resolves short refs and edits, moves and deletes", () => {
    const title = createTextElement({ text: "Old" });
    const shape = createShapeElement("rectangle");
    const deck = deckWith({ ...createSlide(), elements: [title, shape] }, createSlide(), createSlide());
    const refs = refsFor(deck);
    const { deck: next, report } = applyOperations(
      deck,
      [
        { op: "update_element", elementId: "E1", changes: { ...NO_CHANGES, text: "New", color: "#ff0000", fontSize: 500 } },
        { op: "update_element", elementId: "E2", changes: { ...NO_CHANGES, fill: "none", stroke: "#000000", strokeWidth: 3 } },
        { op: "set_slide_background", slideId: "S2", background: "#123456" },
        { op: "move_slide", slideId: "S3", position: 1 },
        { op: "add_element", slideId: "S2", element: textSpec },
        { op: "delete_element", elementId: "E2" },
        { op: "delete_slide", slideId: "S1" },
      ],
      deck.slides[0].id,
      refs,
    );
    expect(report.skipped).toEqual([]);
    expect(report.applied).toBe(7);
    expect(next.slides.map((s) => s.id)).toEqual([deck.slides[2].id, deck.slides[1].id]);
    expect(next.slides[1].background).toBe("#123456");
    expect(next.slides[1].elements).toHaveLength(1);
    expect(report.changes).toContain("Updated text on slide 1");
    expect(report.changes).toContain("Deleted slide 2");
  });

  it("applies element updates with clamping and keeps the element type", () => {
    const el = createTextElement();
    const deck = deckWith({ ...createSlide(), elements: [el] });
    const { deck: next } = applyOperations(
      deck,
      [{ op: "update_element", elementId: "E1", changes: { ...NO_CHANGES, fontSize: 9999, x: -99999, fill: "#ff0000" } }],
      null,
      refsFor(deck),
    );
    const updated = next.slides[0].elements[0];
    expect(updated.type).toBe("text");
    expect(updated.type === "text" && updated.fontSize).toBe(200);
    expect(updated.x).toBeGreaterThan(-99999);
  });

  it("accepts real ids too", () => {
    const el = createTextElement();
    const deck = deckWith({ ...createSlide(), elements: [el] });
    const { report } = applyOperations(deck, [{ op: "delete_element", elementId: el.id }, { op: "delete_slide", slideId: deck.slides[0].id }], null);
    expect(report.applied).toBe(2);
  });

  it("skips invalid operations with reasons and keeps the rest", () => {
    const deck = deckWith(createSlide());
    const { deck: next, report } = applyOperations(
      deck,
      [
        { op: "delete_slide", slideId: "S7" },
        { op: "update_element", elementId: "E9", changes: NO_CHANGES },
        { op: "set_slide_background", slideId: "S1", background: "blue" },
        { op: "move_slide", slideId: "S1", position: 1 },
        { op: "set_title", title: deck.title },
        { op: "add_slide", position: null, background: null, elements: [] },
      ],
      null,
      refsFor(deck),
    );
    expect(report.applied).toBe(1);
    expect(report.skipped.map((s) => s.reason)).toEqual([
      "slide S7 wasn't found",
      "element E9 wasn't found",
      "“blue” is not a valid color",
      "slide already at that position",
      "title unchanged",
    ]);
    expect(next.slides).toHaveLength(2);
  });

  it("skips no-op element updates", () => {
    const el = createTextElement();
    const deck = deckWith({ ...createSlide(), elements: [el] });
    const { report } = applyOperations(deck, [{ op: "update_element", elementId: "E1", changes: { ...NO_CHANGES, text: el.text } }], null, refsFor(deck));
    expect(report.skipped[0].reason).toBe("nothing to change");
  });

  it("respects slide and element limits", () => {
    const full = deckWith(...Array.from({ length: MAX_SLIDES }, () => createSlide()));
    expect(applyOperations(full, [{ op: "add_slide", position: null, background: null, elements: [] }], null).report.skipped[0].reason).toMatch(/at most/);
    const crowded = deckWith({ ...createSlide(), elements: Array.from({ length: MAX_ELEMENTS_PER_SLIDE }, () => createShapeElement("rectangle")) });
    const r = applyOperations(crowded, [{ op: "add_element", slideId: "S1", element: textSpec }], null, refsFor(crowded));
    expect(r.report.skipped[0].reason).toMatch(/at most/);
  });

  it("only applies the first MAX_OPERATIONS operations", () => {
    const ops: AiOperation[] = Array.from({ length: MAX_OPERATIONS + 5 }, (_, i) => ({ op: "set_title", title: `T${i}` }));
    const { report } = applyOperations(deckWith(), ops, null);
    expect(report.applied).toBe(MAX_OPERATIONS);
    expect(report.skipped[0].op).toBe("batch");
  });

  it("describes images and charts in change summaries", () => {
    const img = createImageElement("data:image/png;base64,AAAA", 100, 100);
    const chart = createChartElement("pie");
    const deck = deckWith({ ...createSlide(), elements: [img, chart] });
    const { report } = applyOperations(
      deck,
      [
        { op: "update_element", elementId: "E1", changes: { ...NO_CHANGES, alt: "Logo" } },
        { op: "delete_element", elementId: "E2" },
      ],
      null,
      refsFor(deck),
    );
    expect(report.changes).toEqual(["Updated image on slide 1", "Removed pie chart from slide 1"]);
  });
});
