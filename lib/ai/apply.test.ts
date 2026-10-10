import { describe, expect, it } from "vitest";
import { MAX_ELEMENTS_PER_SLIDE, MAX_NOTES_LENGTH, MAX_SLIDES } from "../constants";
import { createChartElement, createDeck, createImageElement, createShapeElement, createSlide, createTableElement, createTextElement } from "../factory";
import { deckSchema, type Deck } from "../schema";
import { applyOperations, elementFromSpec, MAX_OPERATIONS, type AiRefs } from "./apply";
import type { AiElementChanges, AiElementSpec, AiOperation } from "./schema";

const NO_CHANGES: AiElementChanges = {
  x: null, y: null, width: null, height: null, text: null, fontSize: null, fontFamily: null, color: null, bold: null, italic: null,
  underline: null, align: null, shape: null, fill: null, stroke: null, strokeWidth: null, chartType: null, title: null, categories: null,
  series: null, showLegend: null, stacked: null, showValues: null, dualAxis: null, rows: null, headerRow: null, headerFill: null,
  borderColor: null, alt: null,
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

const chartSpec = {
  type: "chart" as const, chartType: "bar" as const, x: 0, y: 0, width: 600, height: 400, title: null, categories: ["a", "b"],
  series: [{ name: "s", values: [1, 2] }], showLegend: null, stacked: null, showValues: null, dualAxis: null,
};

const tableSpec = {
  type: "table" as const, x: 100, y: 100, width: 600, height: 200, rows: [["Name", "Score"], ["Ann", "3"]], headerRow: null, fontSize: null,
};

function addSlide(elements: AiElementSpec[] = [], extra: Partial<Extract<AiOperation, { op: "add_slide" }>> = {}): AiOperation {
  return { op: "add_slide", position: null, background: null, notes: null, elements, ...extra };
}

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
    const el = elementFromSpec({ ...chartSpec, chartType: "line", series: [{ name: "s", values: [1] }] });
    expect(el).toMatchObject({ type: "chart", chartType: "line", title: "", categories: ["a", "b"], series: [{ name: "s", values: [1, 0] }] });
  });
  it("leaves the chart options off unless the model sets them", () => {
    const plain = elementFromSpec(chartSpec);
    expect(plain).not.toHaveProperty("stacked");
    expect(plain).not.toHaveProperty("showValues");
    expect(plain).not.toHaveProperty("dualAxis");
    const fancy = elementFromSpec({ ...chartSpec, chartType: "doughnut", stacked: true, showValues: true, dualAxis: false, showLegend: false, title: "Mix" });
    expect(fancy).toMatchObject({ chartType: "doughnut", stacked: true, showValues: true, dualAxis: false, showLegend: false, title: "Mix" });
  });
  it("builds tables with default styling and rectangular rows", () => {
    const el = elementFromSpec(tableSpec);
    expect(el).toMatchObject({ type: "table", x: 100, y: 100, width: 600, height: 200, rows: tableSpec.rows, headerRow: true, fontSize: 20 });
    const ragged = elementFromSpec({ ...tableSpec, rows: [["a", "b", "c"], ["d"]], headerRow: false, fontSize: 2 });
    expect(ragged).toMatchObject({ rows: [["a", "b", "c"], ["d", "", ""]], headerRow: false, fontSize: 8 });
  });
  it("falls back to the default grid for a table without rows", () => {
    const el = elementFromSpec({ ...tableSpec, rows: [] });
    expect(el.type === "table" && el.rows).toEqual(createTableElement().rows);
  });
});

describe("applyOperations", () => {
  it("never mutates the input deck", () => {
    const locked = createTextElement({ locked: true });
    const deck = deckWith({ ...createSlide(), elements: [locked, createTableElement()] });
    const snapshot = structuredClone(deck);
    applyOperations(
      deck,
      [
        { op: "set_title", title: "New" },
        addSlide([textSpec], { position: 1, notes: "n" }),
        { op: "set_slide_notes", slideId: "S2", notes: "changed" },
        { op: "update_element", elementId: "E2", changes: { ...NO_CHANGES, rows: [["x"]] } },
        { op: "delete_element", elementId: "E1" },
      ],
      null,
      refsFor(deck),
    );
    expect(deck).toEqual(snapshot);
  });

  it("builds a deck from scratch", () => {
    const deck = deckWith();
    const ops: AiOperation[] = [
      { op: "set_title", title: "  Offsite  " },
      addSlide([textSpec, tableSpec, chartSpec], { background: "#0f172a", notes: "Welcome everyone" }),
      addSlide([], { background: "bogus" }),
      addSlide([], { position: 1 }),
    ];
    const { deck: next, report, focusSlideId } = applyOperations(deck, ops, null);
    expect(report).toMatchObject({ applied: 4, skipped: [] });
    expect(next.title).toBe("Offsite");
    expect(next.slides).toHaveLength(3);
    expect(next.slides[1].background).toBe("#0f172a");
    expect(next.slides[1].notes).toBe("Welcome everyone");
    expect(next.slides[1].elements.map((e) => e.type)).toEqual(["text", "table", "chart"]);
    expect(next.slides[2].background).toBe("#ffffff");
    expect(next.slides[2].notes).toBe("");
    expect(focusSlideId).toBe(next.slides[0].id);
    expect(deckSchema.safeParse(next).success).toBe(true);
    expect(report.changes).toEqual(["Renamed the deck to “Offsite”", "Added slide 1", "Added slide 2", "Added slide 1"]);
  });

  it("clips notes on new slides to the maximum length", () => {
    const { deck: next } = applyOperations(deckWith(), [addSlide([], { notes: "n".repeat(MAX_NOTES_LENGTH + 50) })], null);
    expect(next.slides[0].notes).toHaveLength(MAX_NOTES_LENGTH);
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
        { op: "set_slide_notes", slideId: "S5", notes: "x" },
        { op: "set_slide_notes", slideId: "S1", notes: "" },
        addSlide(),
      ],
      null,
      refsFor(deck),
    );
    expect(report.applied).toBe(1);
    expect(report.skipped).toEqual([
      { op: "delete_slide", reason: "slide S7 wasn't found" },
      { op: "update_element", reason: "element E9 wasn't found" },
      { op: "set_slide_background", reason: "“blue” is not a valid color" },
      { op: "move_slide", reason: "slide already at that position" },
      { op: "set_title", reason: "title unchanged" },
      { op: "set_slide_notes", reason: "slide S5 wasn't found" },
      { op: "set_slide_notes", reason: "notes unchanged" },
    ]);
    expect(next.slides).toHaveLength(2);
  });

  it("skips no-op element updates", () => {
    const el = createTextElement();
    const table = createTableElement();
    const deck = deckWith({ ...createSlide(), elements: [el, table] });
    const { report } = applyOperations(
      deck,
      [
        { op: "update_element", elementId: "E1", changes: { ...NO_CHANGES, text: el.text } },
        // Table fields on a text box are ignored, so nothing changes.
        { op: "update_element", elementId: "E1", changes: { ...NO_CHANGES, rows: [["a"]], headerRow: false } },
        { op: "update_element", elementId: "E2", changes: { ...NO_CHANGES, rows: structuredClone(table.rows) } },
      ],
      null,
      refsFor(deck),
    );
    expect(report.applied).toBe(0);
    expect(report.skipped.map((s) => s.reason)).toEqual(["nothing to change", "nothing to change", "nothing to change"]);
  });

  it("respects slide and element limits", () => {
    const full = deckWith(...Array.from({ length: MAX_SLIDES }, () => createSlide()));
    expect(applyOperations(full, [addSlide()], null).report.skipped[0].reason).toMatch(/at most/);
    const crowded = deckWith({ ...createSlide(), elements: Array.from({ length: MAX_ELEMENTS_PER_SLIDE }, () => createShapeElement("rectangle")) });
    const r = applyOperations(crowded, [{ op: "add_element", slideId: "S1", element: textSpec }], null, refsFor(crowded));
    expect(r.report.skipped[0].reason).toMatch(/at most/);
    const many = Array.from({ length: MAX_ELEMENTS_PER_SLIDE + 5 }, () => textSpec);
    expect(applyOperations(deckWith(), [addSlide(many)], null).deck.slides[0].elements).toHaveLength(MAX_ELEMENTS_PER_SLIDE);
  });

  it("only applies the first MAX_OPERATIONS operations", () => {
    const ops: AiOperation[] = Array.from({ length: MAX_OPERATIONS + 5 }, (_, i) => ({ op: "set_title", title: `T${i}` }));
    const { report } = applyOperations(deckWith(), ops, null);
    expect(report.applied).toBe(MAX_OPERATIONS);
    expect(report.skipped[0].op).toBe("batch");
  });

  it("describes images, charts and tables in change summaries", () => {
    const img = createImageElement("data:image/png;base64,AAAA", 100, 100);
    const chart = createChartElement("pie");
    const table = createTableElement();
    const deck = deckWith({ ...createSlide(), elements: [img, chart, table] });
    const { report } = applyOperations(
      deck,
      [
        { op: "update_element", elementId: "E1", changes: { ...NO_CHANGES, alt: "Logo" } },
        { op: "delete_element", elementId: "E2" },
        { op: "update_element", elementId: "E3", changes: { ...NO_CHANGES, headerRow: false } },
        { op: "add_element", slideId: "S1", element: tableSpec },
        { op: "delete_element", elementId: "E3" },
      ],
      null,
      refsFor(deck),
    );
    expect(report.changes).toEqual([
      "Updated image on slide 1",
      "Removed pie chart from slide 1",
      "Updated table on slide 1",
      "Added table to slide 1",
      "Removed table from slide 1",
    ]);
  });

  describe("tables", () => {
    it("adds a table to an existing slide", () => {
      const deck = deckWith(createSlide());
      const { deck: next, report } = applyOperations(deck, [{ op: "add_element", slideId: "S1", element: tableSpec }], null, refsFor(deck));
      expect(report.applied).toBe(1);
      expect(next.slides[0].elements[0]).toMatchObject({ type: "table", rows: tableSpec.rows, headerRow: true });
      expect(deckSchema.safeParse(next).success).toBe(true);
    });

    it("updates rows and styling, understanding 'none' and keeping colors on null", () => {
      const table = createTableElement({ borderColor: "#d1d5db", headerFill: "#eef2ff" });
      const deck = deckWith({ ...createSlide(), elements: [table] });
      const { deck: next } = applyOperations(
        deck,
        [
          {
            op: "update_element",
            elementId: "E1",
            changes: { ...NO_CHANGES, rows: [["A", "B"], ["1"]], headerRow: false, headerFill: "none", fontSize: 14, color: "#ABC" },
          },
        ],
        null,
        refsFor(deck),
      );
      expect(next.slides[0].elements[0]).toMatchObject({
        rows: [
          ["A", "B"],
          ["1", ""],
        ],
        headerRow: false,
        headerFill: null,
        borderColor: "#d1d5db",
        fontSize: 14,
        color: "#aabbcc",
      });

      const { deck: again } = applyOperations(
        next,
        [{ op: "update_element", elementId: "E1", changes: { ...NO_CHANGES, borderColor: "#000", headerFill: "not a color" } }],
        null,
        refsFor(next),
      );
      expect(again.slides[0].elements[0]).toMatchObject({ borderColor: "#000000", headerFill: null });
      expect(deckSchema.safeParse(again).success).toBe(true);
    });
  });

  describe("speaker notes", () => {
    it("sets and clips slide notes", () => {
      const deck = deckWith(createSlide(), createSlide("#ffffff", "old"));
      const { deck: next, report, focusSlideId } = applyOperations(
        deck,
        [
          { op: "set_slide_notes", slideId: "S2", notes: "Mention the demo" },
          { op: "set_slide_notes", slideId: "S1", notes: "n".repeat(MAX_NOTES_LENGTH + 10) },
        ],
        null,
        refsFor(deck),
      );
      expect(report.changes).toEqual(["Updated the speaker notes of slide 2", "Updated the speaker notes of slide 1"]);
      expect(next.slides[1].notes).toBe("Mention the demo");
      expect(next.slides[0].notes).toHaveLength(MAX_NOTES_LENGTH);
      expect(focusSlideId).toBe(deck.slides[0].id);
      expect(report.touchedSlideIds).toEqual([deck.slides[1].id, deck.slides[0].id]);
      expect(report.touchedElementIds).toEqual([]);
    });

    it("can clear notes", () => {
      const deck = deckWith(createSlide("#ffffff", "old"));
      const { deck: next, report } = applyOperations(deck, [{ op: "set_slide_notes", slideId: "S1", notes: "" }], null, refsFor(deck));
      expect(report.applied).toBe(1);
      expect(next.slides[0].notes).toBe("");
    });
  });

  describe("locked elements", () => {
    function lockedDeck() {
      const locked = createTextElement({ text: "Keep", locked: true });
      const free = createShapeElement("rectangle");
      const deck = deckWith({ ...createSlide(), elements: [locked, free] }, createSlide());
      return { deck, locked, free, refs: refsFor(deck) };
    }

    it("never updates or deletes a locked element", () => {
      const { deck, locked, refs } = lockedDeck();
      const { deck: next, report } = applyOperations(
        deck,
        [
          { op: "update_element", elementId: "E1", changes: { ...NO_CHANGES, text: "Changed", x: 0 } },
          { op: "delete_element", elementId: "E1" },
          { op: "delete_element", elementId: locked.id },
        ],
        null,
        refs,
      );
      expect(report.applied).toBe(0);
      expect(report.skipped).toEqual([
        { op: "update_element", reason: "element E1 is locked" },
        { op: "delete_element", reason: "element E1 is locked" },
        { op: "delete_element", reason: `element ${locked.id} is locked` },
      ]);
      expect(next.slides[0].elements[0]).toEqual(locked);
      expect(report.touchedElementIds).toEqual([]);
      expect(report.touchedSlideIds).toEqual([]);
    });

    it("won't delete a slide that has locked elements", () => {
      const { deck, refs } = lockedDeck();
      const { deck: next, report } = applyOperations(deck, [{ op: "delete_slide", slideId: "S1" }], null, refs);
      expect(report.skipped).toEqual([{ op: "delete_slide", reason: "slide S1 has locked elements" }]);
      expect(next.slides).toHaveLength(2);
    });

    it("still edits the unlocked elements and the slide itself", () => {
      const { deck, locked, free, refs } = lockedDeck();
      const { deck: next, report } = applyOperations(
        deck,
        [
          { op: "update_element", elementId: "E2", changes: { ...NO_CHANGES, fill: "#ff0000" } },
          { op: "add_element", slideId: "S1", element: textSpec },
          { op: "set_slide_background", slideId: "S1", background: "#000000" },
          { op: "move_slide", slideId: "S1", position: 2 },
          { op: "set_slide_notes", slideId: "S1", notes: "fine" },
          { op: "delete_element", elementId: "E2" },
        ],
        null,
        refs,
      );
      expect(report.skipped).toEqual([]);
      const slide = next.slides[1];
      expect(slide.id).toBe(deck.slides[0].id);
      expect(slide.background).toBe("#000000");
      expect(slide.notes).toBe("fine");
      expect(slide.elements[0]).toEqual(locked);
      expect(slide.elements.map((e) => e.id)).not.toContain(free.id);
    });
  });

  describe("touched ids and focus", () => {
    it("reports added and changed slides and elements", () => {
      const text = createTextElement();
      const other = createShapeElement("ellipse");
      const deck = deckWith({ ...createSlide(), elements: [text, other] }, createSlide(), createSlide());
      const { deck: next, report, focusSlideId } = applyOperations(
        deck,
        [
          { op: "set_title", title: "Renamed" },
          { op: "update_element", elementId: "E1", changes: { ...NO_CHANGES, text: "Changed" } },
          { op: "add_element", slideId: "S2", element: tableSpec },
          addSlide([textSpec, chartSpec]),
          { op: "move_slide", slideId: "S3", position: 1 },
        ],
        null,
        refsFor(deck),
      );
      const added = next.slides.at(-1)!;
      const addedTable = next.slides.find((s) => s.id === deck.slides[1].id)!.elements[0];
      expect(report.touchedSlideIds).toEqual([deck.slides[0].id, deck.slides[1].id, added.id, deck.slides[2].id]);
      expect(report.touchedElementIds).toEqual([text.id, addedTable.id, ...added.elements.map((e) => e.id)]);
      expect(report.touchedElementIds).not.toContain(other.id);
      expect(focusSlideId).toBe(deck.slides[2].id);
    });

    it("only reports things that still exist", () => {
      const doomed = createTextElement();
      const deck = deckWith({ ...createSlide(), elements: [doomed] }, createSlide());
      const refs = refsFor(deck);
      const { deck: next, report, focusSlideId } = applyOperations(
        deck,
        [
          { op: "update_element", elementId: "E1", changes: { ...NO_CHANGES, text: "Changed" } },
          { op: "delete_element", elementId: "E1" },
          { op: "set_slide_notes", slideId: "S2", notes: "bye" },
          { op: "delete_slide", slideId: "S2" },
        ],
        null,
        refs,
      );
      expect(report.applied).toBe(4);
      expect(next.slides.map((s) => s.id)).toEqual([deck.slides[0].id]);
      expect(report.touchedSlideIds).toEqual([deck.slides[0].id]);
      expect(report.touchedElementIds).toEqual([]);
      // The last focused slide was deleted, so there is nothing to focus.
      expect(focusSlideId).toBeNull();
    });

    it("forgets elements added to a slide that is deleted later in the batch", () => {
      const deck = deckWith(createSlide(), createSlide());
      const { deck: next, report, focusSlideId } = applyOperations(
        deck,
        [
          addSlide([textSpec]),
          { op: "add_element", slideId: "S1", element: tableSpec },
          { op: "delete_slide", slideId: "S1" },
        ],
        null,
        refsFor(deck),
      );
      expect(report.applied).toBe(3);
      const added = next.slides.at(-1)!;
      expect(report.touchedSlideIds).toEqual([added.id]);
      expect(report.touchedElementIds).toEqual([added.elements[0].id]);
      expect(focusSlideId).toBeNull();
    });

    it("keeps the earlier focus when a later operation deletes a different slide", () => {
      const deck = deckWith(createSlide(), createSlide());
      const { focusSlideId } = applyOperations(
        deck,
        [
          { op: "set_slide_background", slideId: "S1", background: "#222222" },
          { op: "delete_slide", slideId: "S2" },
        ],
        null,
        refsFor(deck),
      );
      expect(focusSlideId).toBe(deck.slides[0].id);
    });

    it("has no focus or touched ids for deck-level or skipped operations", () => {
      const deck = deckWith(createSlide());
      const result = applyOperations(deck, [{ op: "set_title", title: "New" }, { op: "delete_slide", slideId: "S9" }], null, refsFor(deck));
      expect(result.focusSlideId).toBeNull();
      expect(result.report.touchedSlideIds).toEqual([]);
      expect(result.report.touchedElementIds).toEqual([]);
    });
  });

  describe("chart options", () => {
    it("turns stacking, value labels and the second axis on and off", () => {
      const chart = createChartElement("bar", { series: [{ name: "A", values: [1, 2, 3, 4] }, { name: "B", values: [4, 3, 2, 1] }] });
      const deck = deckWith({ ...createSlide(), elements: [chart] });
      const on = applyOperations(
        deck,
        [{ op: "update_element", elementId: "E1", changes: { ...NO_CHANGES, stacked: true, showValues: true, dualAxis: true } }],
        null,
        refsFor(deck),
      );
      expect(on.report.changes).toEqual(["Updated bar chart on slide 1"]);
      expect(on.deck.slides[0].elements[0]).toMatchObject({ stacked: true, showValues: true, dualAxis: true });
      expect(on.report.touchedElementIds).toEqual([chart.id]);

      const off = applyOperations(on.deck, [{ op: "update_element", elementId: "E1", changes: { ...NO_CHANGES, stacked: false } }], null, refsFor(on.deck));
      expect(off.deck.slides[0].elements[0]).toMatchObject({ stacked: false, showValues: true, dualAxis: true });

      const same = applyOperations(on.deck, [{ op: "update_element", elementId: "E1", changes: { ...NO_CHANGES, showValues: true } }], null, refsFor(on.deck));
      expect(same.report.skipped[0].reason).toBe("nothing to change");
    });
  });
});
