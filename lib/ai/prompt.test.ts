import { describe, expect, it } from "vitest";
import { MAX_TABLE_COLS, MAX_TABLE_ROWS } from "../constants";
import {
  createChartElement,
  createDeck,
  createImageElement,
  createShapeElement,
  createSlide,
  createTableElement,
  createTextElement,
} from "../factory";
import type { Deck, Slide } from "../schema";
import { buildSystemPrompt, MAX_DECK_CONTEXT_CHARS, serializeDeckForAi, summarizeSlide } from "./prompt";

function deck(...slides: Deck["slides"]): Deck {
  return { ...createDeck("Plan"), slides };
}

/** The smallest budget that still forces the first compaction level. */
function justTooSmall(d: Deck, selected: string | null): number {
  return JSON.stringify(serializeDeckForAi(d, selected).context).length - 1;
}

describe("serializeDeckForAi", () => {
  it("uses short refs, maps them back and never includes image data", () => {
    const img = { ...createImageElement("data:image/png;base64,SECRETPIXELS", 100, 100, "Team photo"), crop: { x: 0, y: 0, width: 0.5, height: 0.5 } };
    const text = createTextElement({ text: "Hello" });
    const d = deck({ ...createSlide(), elements: [text, img] }, { ...createSlide("#000000"), elements: [createShapeElement("ellipse")] });
    const { context, refs } = serializeDeckForAi(d, d.slides[1].id);
    expect(context.title).toBe("Plan");
    expect(context.selectedSlide).toBe("S2");
    expect(context.slideCount).toBe(2);
    expect(context.slides.map((s) => [s.id, s.number])).toEqual([
      ["S1", 1],
      ["S2", 2],
    ]);
    expect(context.slides[0].elements?.map((e) => e.id)).toEqual(["E1", "E2"]);
    expect(context.slides[1].elements?.[0].id).toBe("E3");
    expect(context.slides[1].background).toBe("#000000");
    expect(refs.slides).toEqual({ S1: d.slides[0].id, S2: d.slides[1].id });
    expect(refs.elements.E2).toEqual({ slideId: d.slides[0].id, elementId: img.id });
    expect(context.slides[0].elements?.[1]).toEqual({ id: "E2", type: "image", x: img.x, y: img.y, width: img.width, height: img.height, alt: "Team photo" });
    const json = JSON.stringify(context);
    expect(json).not.toContain("SECRETPIXELS");
    expect(json).not.toContain("crop");
    expect(json).toContain("Team photo");
  });

  it("has no selected slide when nothing (or an unknown slide) is selected", () => {
    expect(serializeDeckForAi(deck(createSlide()), null).context.selectedSlide).toBeNull();
    expect(serializeDeckForAi(deck(createSlide()), "missing").context.selectedSlide).toBeNull();
    expect(serializeDeckForAi(deck(), "missing").context.slides).toEqual([]);
  });

  it("describes text and shapes with their style", () => {
    const text = createTextElement({ text: "Hi", bold: true, align: "center" });
    const shape = createShapeElement("triangle", { fill: null, stroke: "#112233", strokeWidth: 3 });
    const d = deck({ ...createSlide(), elements: [text, shape] });
    const [t, s] = serializeDeckForAi(d, null).context.slides[0].elements ?? [];
    expect(t).toEqual({
      id: "E1", type: "text", x: text.x, y: text.y, width: text.width, height: text.height, text: "Hi", fontSize: text.fontSize,
      fontFamily: text.fontFamily, color: text.color, bold: true, italic: false, underline: false, align: "center",
    });
    expect(s).toEqual({ id: "E2", type: "shape", x: shape.x, y: shape.y, width: shape.width, height: shape.height, shape: "triangle", fill: null, stroke: "#112233", strokeWidth: 3 });
  });

  it("marks locked elements and only those", () => {
    const d = deck({ ...createSlide(), elements: [createTextElement({ locked: true }), createTextElement(), createTextElement({ locked: false })] });
    const views = serializeDeckForAi(d, null).context.slides[0].elements ?? [];
    expect(views[0].locked).toBe(true);
    expect(views[1]).not.toHaveProperty("locked");
    expect(views[2]).not.toHaveProperty("locked");
  });

  it("gives groups short refs (G1, G2…) in order of first appearance", () => {
    const d = deck(
      { ...createSlide(), elements: [createShapeElement("ellipse"), createTextElement({ groupId: "grp-b" }), createShapeElement("rectangle", { groupId: "grp-b" })] },
      { ...createSlide(), elements: [createTextElement({ groupId: "grp-a", locked: true }), createTextElement({ groupId: "grp-a" }), createTextElement({ groupId: "grp-b" })] },
    );
    const { context } = serializeDeckForAi(d, null);
    const groups = context.slides.map((s) => s.elements?.map((e) => e.group));
    expect(groups).toEqual([
      [undefined, "G1", "G1"],
      ["G2", "G2", "G1"],
    ]);
    expect(context.slides[0].elements?.[0]).not.toHaveProperty("group");
    expect(context.slides[1].elements?.[0]).toMatchObject({ locked: true, group: "G2" });
    expect(JSON.stringify(context)).not.toContain("grp-");
  });

  it("includes chart options and data, defaulting the flags to false", () => {
    const plain = createChartElement("line");
    const fancy = createChartElement("bar", { stacked: true, showValues: true, dualAxis: true, series: [{ name: "A", values: [1, 2, 3, 4] }, { name: "B", values: [5, 6, 7, 8] }] });
    const d = deck({ ...createSlide(), elements: [plain, fancy] });
    const [p, f] = serializeDeckForAi(d, null).context.slides[0].elements ?? [];
    expect(p).toMatchObject({ chartType: "line", stacked: false, showValues: false, dualAxis: false, showLegend: true, categories: plain.categories, series: plain.series });
    expect(f).toMatchObject({ chartType: "bar", stacked: true, showValues: true, dualAxis: true, series: fancy.series });
    expect(p).not.toHaveProperty("dataOmitted");
  });

  it("includes full table rows and table styling", () => {
    const table = createTableElement({ rows: [["Name", "Score"], ["Ann", "3"], ["Bob", "5"]], headerFill: null });
    const d = deck({ ...createSlide(), elements: [table] });
    const view = serializeDeckForAi(d, null).context.slides[0].elements?.[0];
    expect(view).toEqual({
      id: "E1", type: "table", x: table.x, y: table.y, width: table.width, height: table.height, headerRow: true, fontSize: 20,
      headerFill: null, borderColor: table.borderColor, rows: table.rows,
    });
  });

  it("includes speaker notes only when a slide has them", () => {
    const d = deck(createSlide("#ffffff", "Remember the demo"), createSlide());
    const { context } = serializeDeckForAi(d, null);
    expect(context.slides[0].notes).toBe("Remember the demo");
    expect(context.slides[1]).not.toHaveProperty("notes");
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
    expect(context.slides[0]).toEqual({ id: "S1", number: 1, elementsOmitted: true, summary: summarizeSlide(slides[0]) });
    expect(context.slides[0].summary).toMatch(/^“word word.*…” — 1 text, 1 chart$/);
  });

  it("stays within MAX_DECK_CONTEXT_CHARS by default", () => {
    const long = "x".repeat(4_000);
    const slides = Array.from({ length: 30 }, () => ({ ...createSlide(), elements: [createTextElement({ text: long })] }));
    const d = deck(...slides);
    const full = JSON.stringify(serializeDeckForAi(d, slides[0].id, Number.POSITIVE_INFINITY).context).length;
    expect(full).toBeGreaterThan(MAX_DECK_CONTEXT_CHARS);

    const { context } = serializeDeckForAi(d, slides[0].id);
    expect(JSON.stringify(context).length).toBeLessThanOrEqual(MAX_DECK_CONTEXT_CHARS);
    expect(context.slides[0].elements?.[0].text).toBe(long);
    expect(context.slides[1].elements?.[0].text).toHaveLength(161);

    // A small deck is sent in full.
    const small = deck({ ...createSlide(), elements: [createTextElement({ text: long })] });
    expect(serializeDeckForAi(small, null).context.slides[0].elements?.[0].text).toBe(long);
  });

  it("uses brief detail for other slides at the first compaction level", () => {
    const long = "x".repeat(600);
    const slides = Array.from({ length: 3 }, () => ({ ...createSlide(), elements: [createTextElement({ text: long }), createChartElement("line", { stacked: true })] }));
    const d = deck(...slides);
    const { context } = serializeDeckForAi(d, slides[0].id, justTooSmall(d, slides[0].id));
    expect(context.slides[1].elements?.[0].text).toBe(`${"x".repeat(160)}…`);
    expect(context.slides[1].elements?.[1]).toMatchObject({ dataOmitted: true, stacked: true, showValues: false });
    expect(context.slides[1].elements?.[1]).not.toHaveProperty("categories");
    expect(context.slides[1].elements?.[1]).not.toHaveProperty("series");
    expect(context.slides[0].elements?.[0].text).toBe(long);
    expect(context.slides[0].elements?.[1].series).toEqual(slides[0].elements[1].type === "chart" && slides[0].elements[1].series);
  });

  it("shortens tables and notes in brief detail", () => {
    const rows = [["a".repeat(60), "b"], ["c", "d"], ["e", "f"], ["g", "h"]];
    const longNotes = "n".repeat(300);
    const other = { ...createSlide("#ffffff", longNotes), elements: [createTableElement({ rows }), createTableElement({ rows: [["only"]] })] };
    const selected = { ...createSlide("#ffffff", longNotes), elements: [createTableElement({ rows })] };
    const d = deck(selected, other);
    const { context } = serializeDeckForAi(d, selected.id, justTooSmall(d, selected.id));

    const [brief, tiny] = context.slides[1].elements ?? [];
    expect(brief.rows).toEqual([
      [`${"a".repeat(40)}…`, "b"],
      ["c", "d"],
    ]);
    expect(brief.rowsOmitted).toBe(2);
    expect(tiny.rows).toEqual([["only"]]);
    expect(tiny.rowsOmitted).toBe(0);
    expect(context.slides[1].notes).toBe(`${"n".repeat(200)}…`);

    // The selected slide keeps everything.
    expect(context.slides[0].elements?.[0].rows).toEqual(rows);
    expect(context.slides[0].elements?.[0]).not.toHaveProperty("rowsOmitted");
    expect(context.slides[0].notes).toBe(longNotes);
  });

  it("summarizes other slides without notes at the second level", () => {
    const slides = [
      { ...createSlide("#ffffff", "secret notes"), elements: [createTextElement({ text: "Agenda" }), createTableElement()] },
      { ...createSlide("#ffffff", "keep me"), elements: [createTextElement({ text: "z".repeat(3000) })] },
    ];
    const d = deck(...slides);
    // Too small for the brief level (~3.6k characters), large enough for summaries (~3.4k).
    const { context } = serializeDeckForAi(d, slides[1].id, 3_500);
    expect(JSON.stringify(context).length).toBeLessThanOrEqual(3_500);
    expect(context.slides[0]).toEqual({ id: "S1", number: 1, elementsOmitted: true, summary: "“Agenda” — 1 text, 1 table" });
    expect(context.slides[1].notes).toBe("keep me");
    expect(context.slides[1].elements?.[0].text).toHaveLength(3000);
  });

  it("summarizes every slide when nothing is selected and the deck is too large", () => {
    const slides = Array.from({ length: 5 }, () => ({ ...createSlide(), elements: [createTextElement({ text: "q".repeat(500) })] }));
    const { context } = serializeDeckForAi(deck(...slides), null, 600);
    for (const slide of context.slides) expect(slide.elementsOmitted).toBe(true);
  });

  it("truncates even the selected slide as a last resort", () => {
    const huge = "y".repeat(5000);
    const slides = [{ ...createSlide(), elements: [createTextElement({ text: huge }), createTableElement({ rows: [["1"], ["2"], ["3"]] })] }, createSlide()];
    const { context } = serializeDeckForAi(deck(...slides), slides[0].id, 1000);
    expect(context.slides[0].elements?.[0].text).toHaveLength(161);
    expect(context.slides[0].elements?.[1]).toMatchObject({ rows: [["1"], ["2"]], rowsOmitted: 1 });
    expect(context.slides[1].elementsOmitted).toBe(true);
  });
});

describe("summarizeSlide", () => {
  function slide(...elements: Slide["elements"]): Slide {
    return { ...createSlide(), elements };
  }

  it("describes an empty slide", () => {
    expect(summarizeSlide(createSlide())).toBe("empty slide");
  });

  it("uses the first non-blank text and counts each element type", () => {
    const s = slide(
      createShapeElement("rectangle"),
      createTextElement({ text: "   " }),
      createTextElement({ text: "  Quarterly\n  results " }),
      createShapeElement("ellipse"),
      createImageElement("data:image/png;base64,AAAA", 10, 10),
      createChartElement("pie"),
    );
    expect(summarizeSlide(s)).toBe("“Quarterly results” — 2 shapes, 2 texts, 1 image, 1 chart");
  });

  it("works without any text", () => {
    expect(summarizeSlide(slide(createTableElement(), createTableElement()))).toBe("2 tables");
  });

  it("truncates long titles to 80 characters", () => {
    expect(summarizeSlide(slide(createTextElement({ text: "t".repeat(200) })))).toBe(`“${"t".repeat(80)}…” — 1 text`);
  });
});

describe("buildSystemPrompt", () => {
  const d = deck({ ...createSlide(), elements: [createTextElement({ text: "Quarterly" })] });
  const context = serializeDeckForAi(d, d.slides[0].id).context;

  it("embeds the canvas size, rules and the deck", () => {
    const prompt = buildSystemPrompt(context);
    expect(prompt).toContain("1280 x 720");
    expect(prompt).toContain("Never invent facts");
    expect(prompt).toContain('"selectedSlide":"S1"');
    expect(prompt).toContain("Quarterly");
    expect(prompt.endsWith(`CURRENT DECK\n${JSON.stringify(context)}`)).toBe(true);
  });

  it("documents tables, notes, locks, groups and the chart options", () => {
    const prompt = buildSystemPrompt(context);
    expect(prompt).toContain(`- table: "rows" is a list of rows`);
    expect(prompt).toContain(`at most ${MAX_TABLE_ROWS} rows and ${MAX_TABLE_COLS} columns`);
    expect(prompt).toContain("rowsOmitted");
    expect(prompt).toContain(`speaker "notes"`);
    expect(prompt).toContain("set_slide_notes");
    expect(prompt).toContain(`"locked": true are protected`);
    expect(prompt).toContain(`don't delete slides that contain them`);
    expect(prompt).toContain(`same "group" value`);
    expect(prompt).toMatch(/stacked .*showValues .*dualAxis/);
    expect(prompt).toContain("doughnut");
    expect(prompt).toContain("scatter");
  });

  it("adds the earlier-conversation digest only when there is one", () => {
    const digest = "- User asked: make a deck\n- Assistant changed: Added slide 1";
    const withDigest = buildSystemPrompt(context, `\n  ${digest}  \n`);
    expect(withDigest).toContain(`EARLIER IN THIS CONVERSATION (condensed; older messages are not shown in full)\n${digest}\n\nCURRENT DECK`);

    for (const none of [undefined, null, "", "  \n "]) {
      expect(buildSystemPrompt(context, none)).not.toContain("EARLIER IN THIS CONVERSATION");
      expect(buildSystemPrompt(context, none)).toBe(buildSystemPrompt(context));
    }
  });
});
