import {
  CHART_KINDS,
  FONT_FAMILIES,
  FONT_SIZE_MAX,
  FONT_SIZE_MIN,
  MAX_ALT_LENGTH,
  MAX_CHART_CATEGORIES,
  MAX_CHART_LABEL_LENGTH,
  MAX_CHART_SERIES,
  MAX_TEXT_LENGTH,
  SHAPE_KINDS,
  SLIDE_HEIGHT,
  SLIDE_WIDTH,
  STROKE_WIDTH_MAX,
  TEXT_ALIGNS,
} from "./constants";
import { normalizeColor } from "./color";

export const DEFAULT_LINE_COLOR = "#1f2937";
import { clamp, clampRect, fitWithin } from "./geometry";
import type { ChartElement, ChartSeries, ElementPatch, SlideElement } from "./schema";

const GEOMETRY_KEYS = ["x", "y", "width", "height"] as const;
const KEYS_BY_TYPE: Record<SlideElement["type"], readonly string[]> = {
  text: [...GEOMETRY_KEYS, "text", "fontSize", "fontFamily", "color", "bold", "italic", "underline", "align"],
  shape: [...GEOMETRY_KEYS, "shape", "fill", "stroke", "strokeWidth"],
  image: [...GEOMETRY_KEYS, "src", "alt"],
  chart: [...GEOMETRY_KEYS, "chartType", "title", "categories", "series", "showLegend"],
};

function finiteOr(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

/** Makes chart data rectangular: every series gets exactly one finite value per category. */
export function normalizeChartData(
  categories: unknown[],
  series: { name?: unknown; values?: unknown[] }[],
): { categories: string[]; series: ChartSeries[] } {
  const cats = categories
    .slice(0, MAX_CHART_CATEGORIES)
    .map((c, i) => (typeof c === "string" || typeof c === "number" ? String(c) : `Item ${i + 1}`))
    .map((c) => c.slice(0, MAX_CHART_LABEL_LENGTH));
  const safeCategories = cats.length > 0 ? cats : ["Item 1"];
  const rawSeries = series.slice(0, MAX_CHART_SERIES);
  const safeSeries = (rawSeries.length > 0 ? rawSeries : [{ name: "Series 1", values: [] }]).map((s, i) => ({
    name: (typeof s.name === "string" && s.name.trim() ? s.name : `Series ${i + 1}`).slice(0, MAX_CHART_LABEL_LENGTH),
    values: safeCategories.map((_, ci) => finiteOr(Array.isArray(s.values) ? s.values[ci] : undefined, 0)),
  }));
  return { categories: safeCategories, series: safeSeries };
}

/** Clamps every numeric/text field of an element into the ranges the editor and exporters support. */
export function sanitizeElement<T extends SlideElement>(element: T): T {
  let rect = { x: element.x, y: element.y, width: element.width, height: element.height };
  rect = {
    x: finiteOr(rect.x, 0),
    y: finiteOr(rect.y, 0),
    width: finiteOr(rect.width, 100),
    height: finiteOr(rect.height, 100),
  };
  if (element.type === "image") {
    const fitted = fitWithin(Math.max(rect.width, 1), Math.max(rect.height, 1), SLIDE_WIDTH, SLIDE_HEIGHT);
    rect = { ...rect, ...fitted };
  }
  const geometry = clampRect(rect);

  switch (element.type) {
    case "text":
      return {
        ...element,
        ...geometry,
        text: element.text.slice(0, MAX_TEXT_LENGTH),
        fontSize: Math.round(clamp(finiteOr(element.fontSize, 24), FONT_SIZE_MIN, FONT_SIZE_MAX)),
      };
    case "shape": {
      const strokeWidth = clamp(finiteOr(element.strokeWidth, 0), 0, STROKE_WIDTH_MAX);
      // A line is drawn with its stroke only, so it must always have one.
      if (element.shape === "line") {
        return { ...element, ...geometry, fill: null, stroke: element.stroke ?? DEFAULT_LINE_COLOR, strokeWidth: Math.max(1, strokeWidth) };
      }
      return { ...element, ...geometry, strokeWidth };
    }
    case "image":
      return { ...element, ...geometry, alt: element.alt.slice(0, MAX_ALT_LENGTH) };
    case "chart": {
      const chart = element as ChartElement;
      return {
        ...chart,
        ...geometry,
        title: chart.title.slice(0, 200),
        ...normalizeChartData(chart.categories, chart.series),
      } as T;
    }
  }
}

/**
 * Applies a partial update to an element. Keys that don't belong to the element's type and
 * invalid values (bad colors, unknown enums, wrong types) are ignored rather than corrupting the deck.
 * Images keep their aspect ratio unless the image source itself changes.
 */
export function applyElementPatch<T extends SlideElement>(element: T, patch: ElementPatch): T {
  const allowed = KEYS_BY_TYPE[element.type];
  const next: Record<string, unknown> = { ...element };

  for (const [key, raw] of Object.entries(patch)) {
    if (!allowed.includes(key) || raw === undefined) continue;
    switch (key) {
      case "x":
      case "y":
      case "width":
      case "height":
      case "fontSize":
      case "strokeWidth":
        if (typeof raw === "number" && Number.isFinite(raw)) next[key] = raw;
        break;
      case "color": {
        const c = normalizeColor(raw);
        if (c) next.color = c;
        break;
      }
      case "fill":
      case "stroke": {
        if (raw === null) next[key] = null;
        else {
          const c = normalizeColor(raw);
          if (c) next[key] = c;
        }
        break;
      }
      case "bold":
      case "italic":
      case "underline":
      case "showLegend":
        if (typeof raw === "boolean") next[key] = raw;
        break;
      case "text":
      case "title":
      case "alt":
        if (typeof raw === "string") next[key] = raw;
        break;
      case "src":
        if (typeof raw === "string" && /^data:image\/(png|jpeg|webp|gif);base64,/.test(raw)) next.src = raw;
        break;
      case "fontFamily":
        if ((FONT_FAMILIES as readonly unknown[]).includes(raw)) next.fontFamily = raw;
        break;
      case "align":
        if ((TEXT_ALIGNS as readonly unknown[]).includes(raw)) next.align = raw;
        break;
      case "shape":
        if ((SHAPE_KINDS as readonly unknown[]).includes(raw)) next.shape = raw;
        break;
      case "chartType":
        if ((CHART_KINDS as readonly unknown[]).includes(raw)) next.chartType = raw;
        break;
      case "categories":
        if (Array.isArray(raw)) next.categories = raw;
        break;
      case "series":
        if (Array.isArray(raw)) next.series = raw;
        break;
    }
  }

  if (element.type === "image" && next.src === element.src) {
    const ratio = element.width / element.height;
    const widthChanged = next.width !== element.width;
    const heightChanged = next.height !== element.height;
    if (widthChanged) next.height = (next.width as number) / ratio;
    else if (heightChanged) next.width = (next.height as number) * ratio;
  }

  // A category/series edit must keep the data rectangular even if only one side changed.
  return sanitizeElement(next as T);
}

/** Field-by-field comparison; arrays (chart data) are compared by value. */
export function elementsEqual(a: SlideElement, b: SlideElement): boolean {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const key of keys) {
    const av = (a as unknown as Record<string, unknown>)[key];
    const bv = (b as unknown as Record<string, unknown>)[key];
    if (av === bv) continue;
    if (Array.isArray(av) && Array.isArray(bv) && JSON.stringify(av) === JSON.stringify(bv)) continue;
    return false;
  }
  return true;
}
