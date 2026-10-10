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
  TextElement,
} from "./schema";

export function createDeck(title = ""): Deck {
  return { version: 1, id: createId(), title, slides: [], updatedAt: Date.now() };
}

export function createSlide(background: string = DEFAULT_SLIDE_BACKGROUND): Slide {
  return { id: createId(), background, elements: [] };
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
  return {
    id: createId(),
    type: "chart",
    chartType,
    ...centered(720, 420),
    title: "",
    categories: ["Q1", "Q2", "Q3", "Q4"],
    series: [{ name: "Series 1", values: [12, 19, 15, 23] }],
    showLegend: true,
    ...overrides,
  };
}

/** Creates an image sized to its natural aspect ratio, at most 60% of the slide. */
export function createImageElement(src: string, naturalWidth: number, naturalHeight: number, alt = ""): ImageElement {
  const size = fitWithin(naturalWidth, naturalHeight, SLIDE_WIDTH * 0.6, SLIDE_HEIGHT * 0.6);
  return { id: createId(), type: "image", ...centered(size.width, size.height), src, alt };
}

/** Copies an element with a fresh id. */
export function cloneElement<T extends SlideElement>(element: T): T {
  return { ...structuredClone(element), id: createId() };
}

/** Copies a slide and all its elements with fresh ids. */
export function cloneSlide(slide: Slide): Slide {
  return { id: createId(), background: slide.background, elements: slide.elements.map((el) => cloneElement(el)) };
}

/**
 * Offsets a new element diagonally while another element already sits at the same spot,
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
