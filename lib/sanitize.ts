import {
  CHART_KINDS,
  FONT_FAMILIES,
  FONT_SIZE_MAX,
  FONT_SIZE_MIN,
  MAX_ALT_LENGTH,
  MAX_CHART_CATEGORIES,
  MAX_CHART_LABEL_LENGTH,
  MAX_CHART_SERIES,
  MAX_TABLE_CELL_LENGTH,
  MAX_TABLE_COLS,
  MAX_TABLE_ROWS,
  MAX_TEXT_LENGTH,
  SHAPE_KINDS,
  SLIDE_HEIGHT,
  SLIDE_WIDTH,
  STROKE_WIDTH_MAX,
  TEXT_ALIGNS,
} from "./constants";
import { normalizeColor } from "./color";
import { clamp, clampRect, fitWithin } from "./geometry";
import type { ChartElement, ChartSeries, ElementPatch, ImageCrop, ImageElement, SlideElement, TableElement } from "./schema";

export const DEFAULT_LINE_COLOR = "#1f2937";

const GEOMETRY_KEYS = ["x", "y", "width", "height"] as const;
const KEYS_BY_TYPE: Record<SlideElement["type"], readonly string[]> = {
  text: [...GEOMETRY_KEYS, "text", "fontSize", "fontFamily", "color", "bold", "italic", "underline", "align"],
  shape: [...GEOMETRY_KEYS, "shape", "fill", "stroke", "strokeWidth"],
  image: [...GEOMETRY_KEYS, "src", "alt", "crop"],
  chart: [...GEOMETRY_KEYS, "chartType", "title", "categories", "series", "showLegend", "stacked", "showValues", "dualAxis"],
  table: [...GEOMETRY_KEYS, "rows", "headerRow", "fontSize", "fontFamily", "color", "headerFill", "borderColor"],
};

export function isGeometryKey(key: string): boolean {
  return (GEOMETRY_KEYS as readonly string[]).includes(key);
}

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

/** Makes table cells a rectangular grid of strings within the size limits. */
export function normalizeTableRows(rows: unknown): string[][] {
  const source = Array.isArray(rows) ? rows.slice(0, MAX_TABLE_ROWS) : [];
  const grid = source.map((row) =>
    (Array.isArray(row) ? row : [row]).slice(0, MAX_TABLE_COLS).map((cell) => (cell === null || cell === undefined ? "" : String(cell)).slice(0, MAX_TABLE_CELL_LENGTH)),
  );
  const width = Math.max(1, ...grid.map((r) => r.length));
  const filled = grid.map((r) => [...r, ...Array.from({ length: width - r.length }, () => "")]);
  return filled.length > 0 ? filled : [[""]];
}

/** Keeps a crop rectangle inside the image and at least 1% in each direction. Invalid crops return undefined. */
export function normalizeCrop(crop: unknown): ImageCrop | undefined {
  if (!crop || typeof crop !== "object") return undefined;
  const c = crop as Record<string, unknown>;
  const nums = [c.x, c.y, c.width, c.height].map((v) => (typeof v === "number" && Number.isFinite(v) ? v : Number.NaN));
  if (nums.some(Number.isNaN)) return undefined;
  const x = clamp(nums[0], 0, 0.99);
  const y = clamp(nums[1], 0, 0.99);
  const width = clamp(nums[2], 0.01, 1 - x);
  const height = clamp(nums[3], 0.01, 1 - y);
  // A crop covering the whole image is the same as no crop.
  if (x === 0 && y === 0 && width >= 0.9999 && height >= 0.9999) return undefined;
  return { x, y, width, height };
}

/** Clamps every numeric/text field of an element into the ranges the editor and exporters support. */
export function sanitizeElement<T extends SlideElement>(element: T): T {
  let rect = {
    x: finiteOr(element.x, 0),
    y: finiteOr(element.y, 0),
    width: finiteOr(element.width, 100),
    height: finiteOr(element.height, 100),
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
    case "image": {
      const image = element as ImageElement;
      const next: ImageElement = { ...image, ...geometry, alt: image.alt.slice(0, MAX_ALT_LENGTH) };
      const crop = normalizeCrop(image.crop);
      if (crop) next.crop = crop;
      else delete next.crop;
      return next as T;
    }
    case "chart": {
      const chart = element as ChartElement;
      return {
        ...chart,
        ...geometry,
        title: chart.title.slice(0, 200),
        ...normalizeChartData(chart.categories, chart.series),
      } as T;
    }
    case "table": {
      const table = element as TableElement;
      return {
        ...table,
        ...geometry,
        rows: normalizeTableRows(table.rows),
        fontSize: Math.round(clamp(finiteOr(table.fontSize, 20), FONT_SIZE_MIN, FONT_SIZE_MAX)),
      } as T;
    }
  }
}

/**
 * Applies a partial update to an element. Keys that don't belong to the element's type and
 * invalid values (bad colors, unknown enums, wrong types) are ignored rather than corrupting the deck.
 * Images keep their aspect ratio unless the image source or crop changes too.
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
      case "stroke":
      case "headerFill":
      case "borderColor": {
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
      case "stacked":
      case "showValues":
      case "dualAxis":
      case "headerRow":
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
      case "crop":
        if (raw === null) delete next.crop;
        else {
          const crop = normalizeCrop(raw);
          if (crop) next.crop = crop;
          else delete next.crop;
        }
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
      case "rows":
        if (Array.isArray(raw)) next.rows = raw;
        break;
    }
  }

  if (element.type === "image" && next.src === element.src && !("crop" in patch)) {
    const ratio = element.width / element.height;
    const widthChanged = next.width !== element.width;
    const heightChanged = next.height !== element.height;
    if (widthChanged) next.height = (next.width as number) / ratio;
    else if (heightChanged) next.width = (next.height as number) * ratio;
  }

  // A category/series edit must keep the data rectangular even if only one side changed.
  return sanitizeElement(next as T);
}

/** Field-by-field comparison; arrays and objects (chart data, table rows, crops) are compared by value. */
export function elementsEqual(a: SlideElement, b: SlideElement): boolean {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const key of keys) {
    const av = (a as unknown as Record<string, unknown>)[key];
    const bv = (b as unknown as Record<string, unknown>)[key];
    if (av === bv) continue;
    if (av && bv && typeof av === "object" && typeof bv === "object" && JSON.stringify(av) === JSON.stringify(bv)) continue;
    return false;
  }
  return true;
}
