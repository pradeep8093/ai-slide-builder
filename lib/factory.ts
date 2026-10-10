import {
  DEFAULT_FONT,
  DEFAULT_SLIDE_BACKGROUND,
  DEFAULT_TEXT_COLOR,
  SLIDE_HEIGHT,
  SLIDE_WIDTH,
  type ChartKind,
  type ShapeKind,
} from "./constants";
import { fitWithin } from "./geometry";
import { createId } from "./ids";
import type {
  ChartElement,
  Deck,
  ImageElement,
  ShapeElement,
  Slide,
  SlideElement,
  TableElement,
  TextElement,
} from "./schema";

export function createDeck(title = ""): Deck {
  return { version: 1, id: createId(), title, slides: [], updatedAt: Date.now() };
}

export function createSlide(background: string = DEFAULT_SLIDE_BACKGROUND, notes = ""): Slide {
  return { id: createId(), background, elements: [], notes };
}

function centered(width: number, height: number) {
  return {
    x: Math.round((SLIDE_WIDTH - width) / 2),
    y: Math.round((SLIDE_HEIGHT - height) / 2),
    width: Math.round(width),
    height: Math.round(height),
  };
}

export function createTextElement(overrides: Partial<Omit<TextElement, "type">> = {}): TextElement {
  return {
    id: createId(),
    type: "text",
    ...centered(560, 80),
    text: "Text",
    fontSize: 36,
    fontFamily: DEFAULT_FONT,
    color: DEFAULT_TEXT_COLOR,
    bold: false,
    italic: false,
    underline: false,
    align: "left",
    ...overrides,
  };
}

export function createShapeElement(shape: ShapeKind, overrides: Partial<Omit<ShapeElement, "type">> = {}): ShapeElement {
  const isLine = shape === "line";
  const size = isLine ? { width: 320, height: 24 } : shape === "arrow" ? { width: 280, height: 140 } : { width: 240, height: 240 };
  return {
    id: createId(),
    type: "shape",
    shape,
    ...centered(size.width, size.height),
    fill: isLine ? null : "#4f6bed",
    stroke: isLine ? "#1f2937" : null,
    strokeWidth: isLine ? 4 : 0,
    ...overrides,
  };
}

export function createChartElement(chartType: ChartKind, overrides: Partial<Omit<ChartElement, "type">> = {}): ChartElement {
  const scatter = chartType === "scatter";
  return {
    id: createId(),
    type: "chart",
    chartType,
    ...centered(720, 420),
    title: "",
    // Scatter charts need numeric X values in the first column.
    categories: scatter ? ["1", "2", "3", "4"] : ["Q1", "Q2", "Q3", "Q4"],
    series: [{ name: "Series 1", values: [12, 19, 15, 23] }],
    showLegend: true,
    ...overrides,
  };
}

export function createTableElement(overrides: Partial<Omit<TableElement, "type">> = {}): TableElement {
  return {
    id: createId(),
    type: "table",
    ...centered(720, 192),
    rows: [
      ["Header 1", "Header 2", "Header 3"],
      ["", "", ""],
      ["", "", ""],
    ],
    headerRow: true,
    fontSize: 20,
    fontFamily: DEFAULT_FONT,
    color: DEFAULT_TEXT_COLOR,
    headerFill: "#eef2ff",
    borderColor: "#d1d5db",
    ...overrides,
  };
}

/** Creates an image sized to its natural aspect ratio, at most 60% of the slide. */
export function createImageElement(src: string, naturalWidth: number, naturalHeight: number, alt = ""): ImageElement {
  const size = fitWithin(naturalWidth, naturalHeight, SLIDE_WIDTH * 0.6, SLIDE_HEIGHT * 0.6);
  return { id: createId(), type: "image", ...centered(size.width, size.height), src, alt };
}

/**
 * Copies elements with fresh ids. Copies are unlocked; groups inside the copied set become new groups,
 * and a lone member of a group is copied without a group.
 */
export function cloneElements<T extends SlideElement>(elements: T[]): T[] {
  const counts = new Map<string, number>();
  for (const el of elements) if (el.groupId) counts.set(el.groupId, (counts.get(el.groupId) ?? 0) + 1);
  const newGroupIds = new Map<string, string>();
  return elements.map((element) => {
    const copy = { ...structuredClone(element), id: createId() } as T;
    delete copy.locked;
    delete copy.groupId;
    if (element.groupId && (counts.get(element.groupId) ?? 0) > 1) {
      if (!newGroupIds.has(element.groupId)) newGroupIds.set(element.groupId, createId());
      copy.groupId = newGroupIds.get(element.groupId);
    }
    return copy;
  });
}

/** Copies one element with a fresh id (unlocked, not grouped). */
export function cloneElement<T extends SlideElement>(element: T): T {
  return cloneElements([element])[0];
}

/** Copies a slide and all its elements (and their groups) with fresh ids, keeping notes. */
export function cloneSlide(slide: Slide): Slide {
  return { id: createId(), background: slide.background, notes: slide.notes ?? "", elements: cloneElementsKeepingLocks(slide.elements) };
}

/** Like cloneElements, but a duplicated slide keeps its locks so it is an exact copy. */
function cloneElementsKeepingLocks(elements: SlideElement[]): SlideElement[] {
  const copies = cloneElements(elements);
  return copies.map((copy, i) => (elements[i].locked ? { ...copy, locked: true } : copy));
}

/**
 * Offsets new elements diagonally while another element already sits at the same spot,
 * so repeated inserts/pastes don't stack invisibly on top of each other.
 */
export function cascadePosition<T extends SlideElement>(element: T, existing: SlideElement[]): T {
  let { x, y } = element;
  for (let i = 0; i < 20; i += 1) {
    const taken = existing.some((other) => other.x === x && other.y === y);
    if (!taken) break;
    x += 20;
    y += 20;
    if (x + 24 > SLIDE_WIDTH || y + 24 > SLIDE_HEIGHT) break;
  }
  return { ...element, x, y };
}

/** Offsets a set of elements together (keeping their arrangement) until the first one lands on a free spot. */
export function cascadeGroup<T extends SlideElement>(elements: T[], existing: SlideElement[]): T[] {
  if (elements.length === 0) return elements;
  const anchor = cascadePosition(elements[0], existing);
  const dx = anchor.x - elements[0].x;
  const dy = anchor.y - elements[0].y;
  return elements.map((el) => ({ ...el, x: el.x + dx, y: el.y + dy }));
}
