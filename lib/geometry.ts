import { MIN_ELEMENT_SIZE, MIN_VISIBLE_PX, SLIDE_HEIGHT, SLIDE_WIDTH } from "./constants";

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export type ResizeHandle = "n" | "s" | "e" | "w" | "ne" | "nw" | "se" | "sw";
export const RESIZE_HANDLES: ResizeHandle[] = ["nw", "n", "ne", "e", "se", "s", "sw", "w"];
export const CORNER_HANDLES: ResizeHandle[] = ["nw", "ne", "se", "sw"];

export function clamp(value: number, min: number, max: number): number {
  if (Number.isNaN(value)) return min;
  return Math.min(max, Math.max(min, value));
}

/**
 * Keeps an element a sane size and makes sure part of it stays on the slide,
 * so it can always be selected again. Values are rounded to whole pixels.
 */
export function clampRect(rect: Rect): Rect {
  const width = Math.round(clamp(rect.width, MIN_ELEMENT_SIZE, SLIDE_WIDTH));
  const height = Math.round(clamp(rect.height, MIN_ELEMENT_SIZE, SLIDE_HEIGHT));
  const visibleX = Math.min(MIN_VISIBLE_PX, width);
  const visibleY = Math.min(MIN_VISIBLE_PX, height);
  const x = Math.round(clamp(rect.x, visibleX - width, SLIDE_WIDTH - visibleX));
  const y = Math.round(clamp(rect.y, visibleY - height, SLIDE_HEIGHT - visibleY));
  return { x, y, width, height };
}

/** Scales (w, h) down uniformly so it fits inside (maxW, maxH). Never scales up. */
export function fitWithin(width: number, height: number, maxWidth: number, maxHeight: number) {
  if (width <= 0 || height <= 0) return { width: maxWidth, height: maxHeight };
  const scale = Math.min(1, maxWidth / width, maxHeight / height);
  return { width: width * scale, height: height * scale };
}

/**
 * Computes a new rect while dragging a resize handle by (dx, dy) slide pixels.
 * The opposite edge/corner stays anchored. `keepAspect` only applies to corner handles.
 */
export function resizeRect(start: Rect, handle: ResizeHandle, dx: number, dy: number, keepAspect = false): Rect {
  const west = handle.includes("w");
  const east = handle.includes("e");
  const north = handle.includes("n");
  const south = handle.includes("s");

  let width = start.width + (east ? dx : 0) - (west ? dx : 0);
  let height = start.height + (south ? dy : 0) - (north ? dy : 0);
  width = Math.max(MIN_ELEMENT_SIZE, width);
  height = Math.max(MIN_ELEMENT_SIZE, height);

  const isCorner = (west || east) && (north || south);
  if (keepAspect && isCorner && start.width > 0 && start.height > 0) {
    const ratio = start.width / start.height;
    if (width / start.width >= height / start.height) {
      height = width / ratio;
    } else {
      width = height * ratio;
    }
    if (width < MIN_ELEMENT_SIZE) {
      width = MIN_ELEMENT_SIZE;
      height = width / ratio;
    }
    if (height < MIN_ELEMENT_SIZE) {
      height = MIN_ELEMENT_SIZE;
      width = height * ratio;
    }
  }

  const x = west ? start.x + start.width - width : start.x;
  const y = north ? start.y + start.height - height : start.y;
  return { x, y, width, height };
}

/** Moves a rect by (dx, dy) and keeps it reachable on the slide. */
export function moveRect(start: Rect, dx: number, dy: number): Rect {
  return clampRect({ ...start, x: start.x + dx, y: start.y + dy });
}

/** Smallest rect containing every given rect. Null for an empty list. */
export function boundingRect(rects: Rect[]): Rect | null {
  if (rects.length === 0) return null;
  const left = Math.min(...rects.map((r) => r.x));
  const top = Math.min(...rects.map((r) => r.y));
  const right = Math.max(...rects.map((r) => r.x + r.width));
  const bottom = Math.max(...rects.map((r) => r.y + r.height));
  return { x: left, y: top, width: right - left, height: bottom - top };
}

/** Rect spanned by two corner points, in any order. */
export function rectFromPoints(x1: number, y1: number, x2: number, y2: number): Rect {
  return { x: Math.min(x1, x2), y: Math.min(y1, y2), width: Math.abs(x2 - x1), height: Math.abs(y2 - y1) };
}

/** True when `inner` lies completely inside `outer` (edges may touch). */
export function containsRect(outer: Rect, inner: Rect): boolean {
  return inner.x >= outer.x && inner.y >= outer.y && inner.x + inner.width <= outer.x + outer.width && inner.y + inner.height <= outer.y + outer.height;
}

/**
 * Maps a rect that lived inside `from` to the matching place inside `to`
 * (used to resize several elements together by their shared bounding box).
 */
export function mapRect(rect: Rect, from: Rect, to: Rect): Rect {
  const sx = from.width > 0 ? to.width / from.width : 1;
  const sy = from.height > 0 ? to.height / from.height : 1;
  return {
    x: to.x + (rect.x - from.x) * sx,
    y: to.y + (rect.y - from.y) * sy,
    width: rect.width * sx,
    height: rect.height * sy,
  };
}

/**
 * Limits a move of several rects together so every one stays reachable on the slide
 * (the same rule as clampRect), without changing the spacing between them.
 */
export function clampGroupDelta(rects: Rect[], dx: number, dy: number): { dx: number; dy: number } {
  let minDx = -Infinity;
  let maxDx = Infinity;
  let minDy = -Infinity;
  let maxDy = Infinity;
  for (const r of rects) {
    const visibleX = Math.min(MIN_VISIBLE_PX, r.width);
    const visibleY = Math.min(MIN_VISIBLE_PX, r.height);
    minDx = Math.max(minDx, visibleX - r.width - r.x);
    maxDx = Math.min(maxDx, SLIDE_WIDTH - visibleX - r.x);
    minDy = Math.max(minDy, visibleY - r.height - r.y);
    maxDy = Math.min(maxDy, SLIDE_HEIGHT - visibleY - r.y);
  }
  // An element that already sits outside the allowed area must not pin the others in place.
  const safe = (value: number, lo: number, hi: number) => (lo > hi ? value : clamp(value, lo, hi));
  return { dx: Math.round(safe(dx, minDx, maxDx)), dy: Math.round(safe(dy, minDy, maxDy)) };
}
