import { CHART_COLORS_DARK, CHART_COLORS_LIGHT, MAX_CHART_CATEGORIES, MAX_CHART_LABEL_LENGTH, MAX_CHART_SERIES, RADIAL_CHART_KINDS, type ChartKind } from "./constants";
import { isDarkColor } from "./color";
import type { ChartElement } from "./schema";
import { parseNumber, rectangularize } from "./tabular";

/** Max pie slices before the smallest ones are folded into "Other" (one color per slot, never cycled). */
export const MAX_PIE_SLICES = 8;

export function chartPalette(background: string): readonly string[] {
  return isDarkColor(background) ? CHART_COLORS_DARK : CHART_COLORS_LIGHT;
}

export interface PieSlice {
  name: string;
  value: number;
}

/**
 * Pie charts show the first series only. Negative/invalid values can't be drawn as slices and are
 * treated as 0; past MAX_PIE_SLICES the smallest slices are combined into "Other".
 */
export function pieSlices(chart: Pick<ChartElement, "categories" | "series">): PieSlice[] {
  const values = chart.series[0]?.values ?? [];
  const slices = chart.categories.map((name, i) => ({
    name,
    value: Number.isFinite(values[i]) && values[i] > 0 ? values[i] : 0,
  }));
  if (slices.length <= MAX_PIE_SLICES) return slices;
  const indexed = slices.map((slice, index) => ({ ...slice, index }));
  const top = [...indexed].sort((a, b) => b.value - a.value || a.index - b.index).slice(0, MAX_PIE_SLICES - 1);
  const keep = new Set(top.map((s) => s.index));
  const other = indexed.filter((s) => !keep.has(s.index)).reduce((sum, s) => sum + s.value, 0);
  // Remaining slices keep their original category order; "Other" goes last.
  return [...indexed.filter((s) => keep.has(s.index)).map(({ name, value }) => ({ name, value })), { name: "Other", value: other }];
}

export function isRadial(chartType: ChartKind): boolean {
  return RADIAL_CHART_KINDS.includes(chartType);
}

export interface ScatterPoint {
  x: number;
  y: number;
}

/** Scatter charts read X from the category column; rows whose X isn't a number are skipped. */
export function scatterPoints(chart: Pick<ChartElement, "categories" | "series">): ScatterPoint[][] {
  return chart.series.map((series) =>
    chart.categories.flatMap((category, i) => {
      const x = parseNumber(category);
      const y = series.values[i];
      return x === null || !Number.isFinite(y) ? [] : [{ x, y }];
    }),
  );
}

/** Indexes (1-based rows) of scatter X values that aren't numbers. */
export function invalidScatterRows(categories: string[]): number[] {
  return categories.flatMap((c, i) => (parseNumber(c) === null ? [i + 1] : []));
}

export function hasDrawableData(chart: Pick<ChartElement, "chartType" | "categories" | "series">): boolean {
  if (isRadial(chart.chartType)) return pieSlices(chart).some((s) => s.value > 0);
  if (chart.chartType === "scatter") return scatterPoints(chart).some((points) => points.length > 0);
  return chart.series.some((s) => s.values.some((v) => Number.isFinite(v)));
}

/** Stacking only applies to bar charts with at least two series. */
export function stackingApplies(chart: Pick<ChartElement, "chartType" | "series" | "stacked">): boolean {
  return chart.chartType === "bar" && chart.series.length > 1 && Boolean(chart.stacked);
}

/** A second axis only applies to bar and line charts with at least two series; the last series uses it. */
export function dualAxisApplies(chart: Pick<ChartElement, "chartType" | "series" | "dualAxis">): boolean {
  return (chart.chartType === "bar" || chart.chartType === "line") && chart.series.length > 1 && Boolean(chart.dualAxis);
}

export interface GridChartData {
  categories: string[];
  /** Values stay as the pasted text so the data editor can flag cells that aren't numbers. */
  series: { name: string; values: string[] }[];
  /** True when rows or columns beyond the chart limits were left out. */
  truncated: boolean;
}

/**
 * Turns pasted spreadsheet cells into chart data. The first column holds the labels (or X values for
 * scatter charts); every other column is a series. The first row is used as series names when any
 * of its value cells isn't a number.
 */
export function chartDataFromGrid(grid: string[][]): GridChartData | null {
  const rows = rectangularize(grid.filter((r) => r.some((c) => c.trim() !== "")));
  if (rows.length === 0 || rows[0].length < 2) return null;
  const hasHeader = rows[0].slice(1).some((cell) => cell.trim() !== "" && parseNumber(cell) === null);
  const header = hasHeader ? rows[0] : null;
  const allBody = hasHeader ? rows.slice(1) : rows;
  if (allBody.length === 0) return null;
  const body = allBody.slice(0, MAX_CHART_CATEGORIES);
  const columnCount = Math.min(rows[0].length - 1, MAX_CHART_SERIES);
  const truncated = allBody.length > MAX_CHART_CATEGORIES || rows[0].length - 1 > MAX_CHART_SERIES;
  const series = Array.from({ length: columnCount }, (_, c) => ({
    name: (header?.[c + 1]?.trim() || `Series ${c + 1}`).slice(0, MAX_CHART_LABEL_LENGTH),
    values: body.map((row) => (row[c + 1] ?? "").trim()),
  }));
  return { categories: body.map((row) => row[0].slice(0, MAX_CHART_LABEL_LENGTH)), series, truncated };
}

const compact = new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 });

/** 950 → "950", 1200 → "1.2K", 2500000 → "2.5M". */
export function formatCompact(value: number): string {
  return Number.isFinite(value) ? compact.format(value) : "";
}

/** Whether a legend adds information: pies/doughnuts always (categories), other charts only with 2+ series. */
export function legendVisible(chart: Pick<ChartElement, "chartType" | "series" | "showLegend">): boolean {
  if (!chart.showLegend) return false;
  return isRadial(chart.chartType) || chart.series.length > 1;
}
