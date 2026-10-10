import { describe, expect, it } from "vitest";
import { SLIDE_HEIGHT, SLIDE_WIDTH } from "./constants";
import {
  cascadeGroup,
  cascadePosition,
  cloneElement,
  cloneElements,
  cloneSlide,
  createChartElement,
  createDeck,
  createImageElement,
  createShapeElement,
  createSlide,
  createTableElement,
  createTextElement,
} from "./factory";
import { deckSchema, slideElementSchema, slideSchema, tableElementSchema, type Slide } from "./schema";

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
      createChartElement("doughnut"),
      createChartElement("scatter"),
      createImageElement("data:image/png;base64,AAAA", 400, 200),
      createTableElement(),
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

describe("createSlide", () => {
  it("starts without notes unless given", () => {
    expect(createSlide().notes).toBe("");
    const slide = createSlide("#000000", "Say hello");
    expect(slide).toMatchObject({ background: "#000000", notes: "Say hello", elements: [] });
    expect(slideSchema.parse(slide)).toEqual(slide);
  });
});

describe("createTableElement", () => {
  it("creates a centered 3x3 table with a header row", () => {
    const table = createTableElement();
    expect(tableElementSchema.safeParse(table).success).toBe(true);
    expect(table.rows).toEqual([
      ["Header 1", "Header 2", "Header 3"],
      ["", "", ""],
      ["", "", ""],
    ]);
    expect(table).toMatchObject({ type: "table", headerRow: true, fontSize: 20, width: 720, height: 192 });
    expect(table.x + table.width / 2).toBe(SLIDE_WIDTH / 2);
    expect(table.y + table.height / 2).toBe(SLIDE_HEIGHT / 2);
    expect(table).not.toHaveProperty("locked");
    expect(table).not.toHaveProperty("groupId");
  });

  it("applies overrides", () => {
    const table = createTableElement({ rows: [["a"]], headerRow: false, headerFill: null, x: 5 });
    expect(table).toMatchObject({ rows: [["a"]], headerRow: false, headerFill: null, x: 5 });
    expect(createTableElement().id).not.toBe(createTableElement().id);
  });
});

describe("cloneElements", () => {
  it("gives copies fresh ids, unlocks them and leaves the originals alone", () => {
    const locked = createTextElement({ locked: true });
    const table = createTableElement();
    const [a, b] = cloneElements([locked, table]);
    expect(a.id).not.toBe(locked.id);
    expect(b.id).not.toBe(table.id);
    expect(a).not.toHaveProperty("locked");
    expect(locked.locked).toBe(true);
    if (b.type !== "table") throw new Error("expected a table copy");
    b.rows[0][0] = "changed";
    expect(table.rows[0][0]).toBe("Header 1");
  });

  it("turns groups inside the copied set into new groups", () => {
    const g1 = [createTextElement({ groupId: "g1" }), createShapeElement("ellipse", { groupId: "g1" })];
    const g2 = [createTextElement({ groupId: "g2" }), createTextElement({ groupId: "g2" })];
    const copies = cloneElements([g1[0], g2[0], g1[1], g2[1], createTextElement()]);
    const [c1, c2, c3, c4, loose] = copies;
    expect(c1.groupId).toBeDefined();
    expect(c1.groupId).not.toBe("g1");
    expect(c3.groupId).toBe(c1.groupId);
    expect(c2.groupId).toBeDefined();
    expect(c2.groupId).not.toBe("g2");
    expect(c4.groupId).toBe(c2.groupId);
    expect(c1.groupId).not.toBe(c2.groupId);
    expect(loose).not.toHaveProperty("groupId");
    // Copying the same group again makes yet another group.
    expect(cloneElements(g1)[0].groupId).not.toBe(c1.groupId);
  });

  it("copies a lone member of a group without a group", () => {
    const member = createTextElement({ groupId: "g1", locked: true });
    const [copy] = cloneElements([member, createTextElement({ groupId: "other" })]);
    expect(copy).not.toHaveProperty("groupId");
    expect(copy).not.toHaveProperty("locked");
    expect(cloneElements([])).toEqual([]);
  });

  it("cloneElement copies one element unlocked and ungrouped", () => {
    const copy = cloneElement(createShapeElement("rectangle", { locked: true, groupId: "g" }));
    expect(copy).not.toHaveProperty("locked");
    expect(copy).not.toHaveProperty("groupId");
  });
});

describe("cloneSlide", () => {
  it("keeps notes and locks and regroups the copied elements", () => {
    const locked = createTextElement({ locked: true, groupId: "g" });
    const free = createShapeElement("ellipse", { groupId: "g" });
    const slide: Slide = { ...createSlide("#123456", "My notes"), elements: [locked, free, createTableElement()] };
    const copy = cloneSlide(slide);
    expect(slideSchema.parse(copy)).toEqual(copy);
    expect(copy.notes).toBe("My notes");
    expect(copy.elements[0].locked).toBe(true);
    expect(copy.elements[1]).not.toHaveProperty("locked");
    expect(copy.elements[0].groupId).toBeDefined();
    expect(copy.elements[0].groupId).not.toBe("g");
    expect(copy.elements[1].groupId).toBe(copy.elements[0].groupId);
    expect(copy.elements[2].type).toBe("table");
    expect(copy.elements.map((e) => e.id)).not.toContain(locked.id);
  });

  it("treats missing notes from older decks as empty", () => {
    const legacy = { id: "s", background: "#ffffff", elements: [] } as unknown as Slide;
    expect(cloneSlide(legacy).notes).toBe("");
  });
});

describe("cascadeGroup", () => {
  it("moves a set of elements together until the first one is on a free spot", () => {
    const a = createTextElement({ x: 100, y: 100 });
    const b = createShapeElement("rectangle", { x: 300, y: 250 });
    const placed = cascadeGroup([a, b], [createTextElement({ x: 100, y: 100 }), createTextElement({ x: 120, y: 120 })]);
    expect(placed.map((e) => [e.x, e.y])).toEqual([
      [140, 140],
      [340, 290],
    ]);
    expect(placed.map((e) => e.id)).toEqual([a.id, b.id]);
    expect(a).toMatchObject({ x: 100, y: 100 });
  });

  it("leaves elements in place when the spot is free, and handles an empty set", () => {
    const a = createTextElement({ x: 100, y: 100 });
    const b = createTextElement({ x: 50, y: 400 });
    expect(cascadeGroup([a, b], [createTextElement({ x: 50, y: 400 })]).map((e) => [e.x, e.y])).toEqual([
      [100, 100],
      [50, 400],
    ]);
    expect(cascadeGroup([], [a])).toEqual([]);
  });
});
