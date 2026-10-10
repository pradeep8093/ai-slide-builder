/** Logical slide size in CSS pixels (16:9). Everything on a slide is positioned in this space. */
export const SLIDE_WIDTH = 1280;
export const SLIDE_HEIGHT = 720;

/** 96 CSS px per inch → 1280×720 px maps to PowerPoint's 13.333×7.5 in "Wide" layout. */
export const PX_PER_INCH = 96;

export const MIN_ELEMENT_SIZE = 8;
/** At least this many px of an element must stay on the slide so it can't get lost off-canvas. */
export const MIN_VISIBLE_PX = 24;

export const MAX_SLIDES = 200;
export const MAX_ELEMENTS_PER_SLIDE = 100;
export const HISTORY_LIMIT = 100;

export const MAX_TITLE_LENGTH = 120;
export const MAX_NOTES_LENGTH = 5000;
export const MAX_TEXT_LENGTH = 5000;
export const MAX_ALT_LENGTH = 300;

export const FONT_FAMILIES = [
  "Arial",
  "Georgia",
  "Times New Roman",
  "Courier New",
  "Verdana",
  "Trebuchet MS",
] as const;
export type FontFamily = (typeof FONT_FAMILIES)[number];
export const DEFAULT_FONT: FontFamily = "Arial";

export const FONT_SIZE_MIN = 8;
export const FONT_SIZE_MAX = 200;

export const TEXT_ALIGNS = ["left", "center", "right"] as const;
export type TextAlign = (typeof TEXT_ALIGNS)[number];

export const SHAPE_KINDS = [
  "rectangle",
  "rounded-rectangle",
  "ellipse",
  "triangle",
  "arrow",
  "line",
] as const;
export type ShapeKind = (typeof SHAPE_KINDS)[number];

export const SHAPE_LABELS: Record<ShapeKind, string> = {
  rectangle: "Rectangle",
  "rounded-rectangle": "Rounded rectangle",
  ellipse: "Ellipse",
  triangle: "Triangle",
  arrow: "Arrow",
  line: "Line",
};

export const CHART_KINDS = ["bar", "line", "area", "pie", "doughnut", "scatter"] as const;
export type ChartKind = (typeof CHART_KINDS)[number];

export const CHART_LABELS: Record<ChartKind, string> = {
  bar: "Bar chart",
  line: "Line chart",
  area: "Area chart",
  pie: "Pie chart",
  doughnut: "Doughnut chart",
  scatter: "Scatter chart",
};

/** Chart types that draw one value per category from the first series only. */
export const RADIAL_CHART_KINDS: readonly ChartKind[] = ["pie", "doughnut"];

export const MAX_CHART_CATEGORIES = 24;
export const MAX_CHART_SERIES = 8;
export const MAX_CHART_LABEL_LENGTH = 60;
export const STROKE_WIDTH_MAX = 40;

/**
 * Categorical series colors, in fixed order (validated palette from the data-viz guidelines).
 * Light steps are used on light slide backgrounds, dark steps on dark backgrounds.
 */
export const CHART_COLORS_LIGHT = [
  "#2a78d6",
  "#eb6834",
  "#1baf7a",
  "#eda100",
  "#e87ba4",
  "#008300",
  "#6250d6",
  "#e34948",
] as const;
export const CHART_COLORS_DARK = [
  "#3987e5",
  "#d95926",
  "#199e70",
  "#c98500",
  "#d55181",
  "#008300",
  "#9085e9",
  "#e66767",
] as const;

export const MAX_TABLE_ROWS = 30;
export const MAX_TABLE_COLS = 10;
export const MAX_TABLE_CELL_LENGTH = 500;

export const MAX_IMAGE_FILE_BYTES = 10 * 1024 * 1024;
export const MAX_IMAGE_DIMENSION = 1920;
export const ACCEPTED_IMAGE_TYPES = ["image/png", "image/jpeg", "image/webp", "image/gif"] as const;

export const DEFAULT_SLIDE_BACKGROUND = "#ffffff";
export const DEFAULT_TEXT_COLOR = "#1f2937";
