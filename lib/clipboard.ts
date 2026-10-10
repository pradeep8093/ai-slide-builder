/**
 * Turning slide content into plain text for the system clipboard, and pasted text into elements.
 */
import { MAX_TABLE_CELL_LENGTH, MAX_TABLE_COLS, MAX_TABLE_ROWS, MAX_TEXT_LENGTH, SLIDE_HEIGHT, SLIDE_WIDTH } from "./constants";
import { createTableElement, createTextElement } from "./factory";
import type { ChartElement, Slide, SlideElement, TableElement, TextElement } from "./schema";
import { parseDelimited, rectangularize, toTsv } from "./tabular";

/** Chart data as a grid: header row of series names, then one row per category. */
export function chartToGrid(chart: Pick<ChartElement, "categories" | "series">): string[][] {
  return [["", ...chart.series.map((s) => s.name)], ...chart.categories.map((category, i) => [category, ...chart.series.map((s) => String(s.values[i] ?? ""))])];
}

/** What a single element contributes to the plain-text clipboard (nothing for shapes and images). */
export function elementPlainText(element: SlideElement): string {
  switch (element.type) {
    case "text":
      return element.text;
    case "table":
      return toTsv(element.rows);
    case "chart":
      return toTsv(chartToGrid(element));
    default:
      return "";
  }
}

export function plainTextForElements(elements: SlideElement[]): string {
  return elements
    .map(elementPlainText)
    .filter((t) => t.trim() !== "")
    .join("\n\n");
}

export function plainTextForSlides(slides: Slide[]): string {
  return slides
    .map((slide) => plainTextForElements(slide.elements))
    .filter((t) => t.trim() !== "")
    .join("\n\n");
}

export interface PastedTable {
  element: TableElement;
  /** True when rows, columns or cell text had to be cut to fit the table limits. */
  truncated: boolean;
}

/** Builds a table from spreadsheet text (tab- or comma-separated). Null when there is nothing to show. */
export function tableFromText(text: string): PastedTable | null {
  const parsed = rectangularize(parseDelimited(text));
  if (parsed.length === 0 || parsed[0].length === 0) return null;
  const tooLong = parsed.some((row) => row.some((cell) => cell.length > MAX_TABLE_CELL_LENGTH));
  const truncated = parsed.length > MAX_TABLE_ROWS || parsed[0].length > MAX_TABLE_COLS || tooLong;
  const rows = parsed.slice(0, MAX_TABLE_ROWS).map((row) => row.slice(0, MAX_TABLE_COLS).map((cell) => cell.slice(0, MAX_TABLE_CELL_LENGTH)));
  if (rows.every((row) => row.every((cell) => cell === ""))) return null;

  const cols = rows[0].length;
  const fontSize = rows.length > 12 ? 14 : rows.length > 8 ? 16 : 20;
  const width = Math.min(SLIDE_WIDTH - 80, Math.max(360, cols * 180));
  const height = Math.min(SLIDE_HEIGHT - 80, Math.max(96, rows.length * Math.round(fontSize * 2.2)));
  const element = createTableElement({
    rows,
    fontSize,
    x: Math.round((SLIDE_WIDTH - width) / 2),
    y: Math.round((SLIDE_HEIGHT - height) / 2),
    width,
    height,
  });
  return { element, truncated };
}

/** A text box holding pasted text, tall enough for its lines. */
export function textElementFromText(text: string): TextElement {
  const content = text.replace(/\r\n?/g, "\n").slice(0, MAX_TEXT_LENGTH);
  const fontSize = 24;
  const lines = content.split("\n").reduce((sum, line) => sum + Math.max(1, Math.ceil(line.length / 45)), 0);
  const height = Math.min(SLIDE_HEIGHT - 80, Math.max(48, Math.ceil(lines * fontSize * 1.2) + 8));
  const width = 720;
  return createTextElement({
    text: content,
    fontSize,
    x: Math.round((SLIDE_WIDTH - width) / 2),
    y: Math.round((SLIDE_HEIGHT - height) / 2),
    width,
    height,
  });
}
