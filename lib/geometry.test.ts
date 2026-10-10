import { describe, expect, it } from "vitest";
import { MIN_ELEMENT_SIZE, MIN_VISIBLE_PX, SLIDE_HEIGHT, SLIDE_WIDTH } from "./constants";
import { boundingRect, clamp, clampGroupDelta, clampRect, containsRect, fitWithin, mapRect, moveRect, rectFromPoints, resizeRect } from "./geometry";

describe("clamp", () => {
  it("bounds values and maps NaN to the minimum", () => {
    expect(clamp(5, 0, 10)).toBe(5);
    expect(clamp(-1, 0, 10)).toBe(0);
    expect(clamp(11, 0, 10)).toBe(10);
    expect(clamp(Number.NaN, 2, 10)).toBe(2);
  });
});

describe("clampRect", () => {
  it("rounds and keeps sizes between the minimum and the slide size", () => {
    expect(clampRect({ x: 10.4, y: 20.6, width: 2, height: 5000 })).toEqual({ x: 10, y: 21, width: MIN_ELEMENT_SIZE, height: SLIDE_HEIGHT });
  });
  it("keeps part of the element on the slide", () => {
    const r = clampRect({ x: -5000, y: 9000, width: 200, height: 100 });
    expect(r.x).toBe(MIN_VISIBLE_PX - 200);
    expect(r.y).toBe(SLIDE_HEIGHT - MIN_VISIBLE_PX);
  });
  it("leaves in-bounds rects untouched", () => {
    expect(clampRect({ x: 100, y: 100, width: 300, height: 200 })).toEqual({ x: 100, y: 100, width: 300, height: 200 });
  });
});

describe("fitWithin", () => {
  it("scales down preserving aspect ratio", () => {
    expect(fitWithin(4000, 2000, SLIDE_WIDTH, SLIDE_HEIGHT)).toEqual({ width: 1280, height: 640 });
  });
  it("never scales up", () => {
    expect(fitWithin(100, 50, 1000, 1000)).toEqual({ width: 100, height: 50 });
  });
  it("returns the box for degenerate sizes", () => {
    expect(fitWithin(0, 10, 300, 200)).toEqual({ width: 300, height: 200 });
  });
});

describe("resizeRect", () => {
  const start = { x: 100, y: 100, width: 200, height: 100 };
  it("grows from the south-east corner", () => {
    expect(resizeRect(start, "se", 50, 20)).toEqual({ x: 100, y: 100, width: 250, height: 120 });
  });
  it("anchors the opposite edge for north-west drags", () => {
    expect(resizeRect(start, "nw", 50, 20)).toEqual({ x: 150, y: 120, width: 150, height: 80 });
  });
  it("only changes one dimension for edge handles", () => {
    expect(resizeRect(start, "e", 30, 999)).toEqual({ x: 100, y: 100, width: 230, height: 100 });
    expect(resizeRect(start, "n", 999, -40)).toEqual({ x: 100, y: 60, width: 200, height: 140 });
  });
  it("never shrinks below the minimum size or flips", () => {
    const r = resizeRect(start, "w", 500, 0);
    expect(r.width).toBe(MIN_ELEMENT_SIZE);
    expect(r.x).toBe(start.x + start.width - MIN_ELEMENT_SIZE);
  });
  it("keeps the aspect ratio on corners when asked", () => {
    const r = resizeRect(start, "se", 100, 0, true);
    expect(r.width / r.height).toBeCloseTo(2);
    expect(r.width).toBe(300);
    const nw = resizeRect(start, "nw", 0, -50, true);
    expect(nw.width / nw.height).toBeCloseTo(2);
    expect(nw.x + nw.width).toBe(start.x + start.width);
    expect(nw.y + nw.height).toBe(start.y + start.height);
  });
  it("keeps the aspect ratio at the minimum size", () => {
    const r = resizeRect({ x: 0, y: 0, width: 100, height: 10 }, "se", -99, -9, true);
    expect(r.height).toBeGreaterThanOrEqual(MIN_ELEMENT_SIZE);
    expect(r.width / r.height).toBeCloseTo(10);
  });
  it("ignores keepAspect for edge handles", () => {
    expect(resizeRect(start, "s", 0, 50, true)).toEqual({ x: 100, y: 100, width: 200, height: 150 });
  });
});

describe("moveRect", () => {
  it("moves and clamps", () => {
    expect(moveRect({ x: 0, y: 0, width: 100, height: 100 }, 10, 20)).toEqual({ x: 10, y: 20, width: 100, height: 100 });
    expect(moveRect({ x: 0, y: 0, width: 100, height: 100 }, 99999, 0).x).toBe(SLIDE_WIDTH - MIN_VISIBLE_PX);
  });
});

describe("boundingRect", () => {
  it("returns null for nothing", () => {
    expect(boundingRect([])).toBeNull();
  });
  it("spans every rect", () => {
    expect(
      boundingRect([
        { x: 10, y: 20, width: 30, height: 40 },
        { x: -5, y: 50, width: 10, height: 100 },
      ]),
    ).toEqual({ x: -5, y: 20, width: 45, height: 130 });
  });
});

describe("rectFromPoints", () => {
  it("normalizes any drag direction", () => {
    expect(rectFromPoints(100, 80, 20, 10)).toEqual({ x: 20, y: 10, width: 80, height: 70 });
    expect(rectFromPoints(5, 5, 5, 5)).toEqual({ x: 5, y: 5, width: 0, height: 0 });
  });
});

describe("containsRect", () => {
  const outer = { x: 0, y: 0, width: 100, height: 100 };
  it("accepts touching edges", () => {
    expect(containsRect(outer, { x: 0, y: 0, width: 100, height: 100 })).toBe(true);
  });
  it("rejects partial overlap", () => {
    expect(containsRect(outer, { x: 50, y: 50, width: 60, height: 10 })).toBe(false);
    expect(containsRect(outer, { x: -1, y: 10, width: 10, height: 10 })).toBe(false);
  });
});

describe("mapRect", () => {
  it("scales positions and sizes relative to the box", () => {
    const from = { x: 100, y: 100, width: 200, height: 100 };
    const to = { x: 100, y: 100, width: 400, height: 200 };
    expect(mapRect({ x: 200, y: 150, width: 50, height: 20 }, from, to)).toEqual({ x: 300, y: 200, width: 100, height: 40 });
  });
  it("follows a moved anchor", () => {
    const from = { x: 0, y: 0, width: 100, height: 100 };
    const to = { x: 50, y: 50, width: 50, height: 50 };
    expect(mapRect({ x: 0, y: 0, width: 100, height: 100 }, from, to)).toEqual(to);
  });
  it("leaves zero-size axes unscaled", () => {
    const from = { x: 0, y: 0, width: 100, height: 0 };
    const to = { x: 0, y: 0, width: 200, height: 0 };
    expect(mapRect({ x: 10, y: 0, width: 20, height: 0 }, from, to)).toEqual({ x: 20, y: 0, width: 40, height: 0 });
  });
});

describe("clampGroupDelta", () => {
  it("passes small moves through", () => {
    expect(clampGroupDelta([{ x: 100, y: 100, width: 50, height: 50 }], 10.4, -20)).toEqual({ dx: 10, dy: -20 });
  });
  it("stops the whole group when one member reaches the edge", () => {
    const rects = [
      { x: 100, y: 100, width: 100, height: 100 },
      { x: 1000, y: 100, width: 100, height: 100 },
    ];
    // The right one may only move until MIN_VISIBLE_PX of it remains visible.
    expect(clampGroupDelta(rects, 1000, 0).dx).toBe(SLIDE_WIDTH - MIN_VISIBLE_PX - 1000);
    expect(clampGroupDelta(rects, -1000, 0).dx).toBe(MIN_VISIBLE_PX - 100 - 100);
  });
  it("clamps vertically too", () => {
    expect(clampGroupDelta([{ x: 0, y: 600, width: 100, height: 100 }], 0, 500).dy).toBe(SLIDE_HEIGHT - MIN_VISIBLE_PX - 600);
  });
});
