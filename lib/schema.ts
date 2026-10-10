import { z } from "zod";
import {
  CHART_KINDS,
  FONT_FAMILIES,
  FONT_SIZE_MAX,
  FONT_SIZE_MIN,
  MAX_ALT_LENGTH,
  MAX_CHART_CATEGORIES,
  MAX_CHART_LABEL_LENGTH,
  MAX_CHART_SERIES,
  MAX_ELEMENTS_PER_SLIDE,
  MAX_NOTES_LENGTH,
  MAX_SLIDES,
  MAX_TABLE_CELL_LENGTH,
  MAX_TABLE_COLS,
  MAX_TABLE_ROWS,
  MAX_TEXT_LENGTH,
  MAX_TITLE_LENGTH,
  SHAPE_KINDS,
  STROKE_WIDTH_MAX,
  TEXT_ALIGNS,
} from "./constants";

export const hexColorSchema = z.string().regex(/^#[0-9a-f]{6}$/i, "Expected a #rrggbb color");

/*
 * Fields added after the first release (locked, groupId, crop, notes, chart options) are optional
 * so decks saved by earlier versions still load unchanged.
 */
const base = {
  id: z.string().min(1),
  x: z.number().finite(),
  y: z.number().finite(),
  width: z.number().finite().positive(),
  height: z.number().finite().positive(),
  /** Locked elements can't be moved, resized or deleted, and the AI can't change them. */
  locked: z.boolean().optional(),
  /** Elements sharing a groupId are selected and moved together. */
  groupId: z.string().min(1).optional(),
};

export const textElementSchema = z.object({
  ...base,
  type: z.literal("text"),
  text: z.string().max(MAX_TEXT_LENGTH),
  fontSize: z.number().min(FONT_SIZE_MIN).max(FONT_SIZE_MAX),
  fontFamily: z.enum(FONT_FAMILIES),
  color: hexColorSchema,
  bold: z.boolean(),
  italic: z.boolean(),
  underline: z.boolean(),
  align: z.enum(TEXT_ALIGNS),
});

export const shapeElementSchema = z.object({
  ...base,
  type: z.literal("shape"),
  shape: z.enum(SHAPE_KINDS),
  fill: hexColorSchema.nullable(),
  stroke: hexColorSchema.nullable(),
  strokeWidth: z.number().min(0).max(STROKE_WIDTH_MAX),
});

/** Visible part of an image, as fractions (0–1) of the original picture. */
export const cropSchema = z
  .object({
    x: z.number().min(0).max(1),
    y: z.number().min(0).max(1),
    width: z.number().gt(0).max(1),
    height: z.number().gt(0).max(1),
  })
  .refine((c) => c.x + c.width <= 1.0001 && c.y + c.height <= 1.0001, { message: "Crop must stay inside the image" });

export const imageElementSchema = z.object({
  ...base,
  type: z.literal("image"),
  src: z.string().regex(/^data:image\/(png|jpeg|webp|gif);base64,/, "Expected an image data URL"),
  alt: z.string().max(MAX_ALT_LENGTH),
  crop: cropSchema.optional(),
});

export const chartSeriesSchema = z.object({
  name: z.string().max(MAX_CHART_LABEL_LENGTH),
  values: z.array(z.number().finite()),
});

export const chartElementSchema = z
  .object({
    ...base,
    type: z.literal("chart"),
    chartType: z.enum(CHART_KINDS),
    title: z.string().max(200),
    /** Category labels; for scatter charts these are the X values. */
    categories: z.array(z.string().max(MAX_CHART_LABEL_LENGTH)).min(1).max(MAX_CHART_CATEGORIES),
    series: z.array(chartSeriesSchema).min(1).max(MAX_CHART_SERIES),
    showLegend: z.boolean(),
    /** Bar charts: stack the series instead of placing them side by side. */
    stacked: z.boolean().optional(),
    /** Show each value next to its mark. */
    showValues: z.boolean().optional(),
    /** Bar/line charts with 2+ series: the last series uses a second value axis on the right. */
    dualAxis: z.boolean().optional(),
  })
  .refine((c) => c.series.every((s) => s.values.length === c.categories.length), {
    message: "Every series needs exactly one value per category",
  });

export const tableElementSchema = z
  .object({
    ...base,
    type: z.literal("table"),
    rows: z.array(z.array(z.string().max(MAX_TABLE_CELL_LENGTH)).min(1).max(MAX_TABLE_COLS)).min(1).max(MAX_TABLE_ROWS),
    /** Style the first row as a header. */
    headerRow: z.boolean(),
    fontSize: z.number().min(FONT_SIZE_MIN).max(FONT_SIZE_MAX),
    fontFamily: z.enum(FONT_FAMILIES),
    color: hexColorSchema,
    headerFill: hexColorSchema.nullable(),
    borderColor: hexColorSchema.nullable(),
  })
  .refine((t) => t.rows.every((r) => r.length === t.rows[0].length), { message: "Every row needs the same number of cells" });

export const slideElementSchema = z.discriminatedUnion("type", [
  textElementSchema,
  shapeElementSchema,
  imageElementSchema,
  chartElementSchema,
  tableElementSchema,
]);

export const slideSchema = z.object({
  id: z.string().min(1),
  background: hexColorSchema,
  elements: z.array(slideElementSchema).max(MAX_ELEMENTS_PER_SLIDE),
  notes: z.string().max(MAX_NOTES_LENGTH).default(""),
});

export const deckSchema = z.object({
  version: z.literal(1),
  id: z.string().min(1),
  title: z.string().max(MAX_TITLE_LENGTH),
  slides: z.array(slideSchema).max(MAX_SLIDES),
  updatedAt: z.number(),
});

export type TextElement = z.infer<typeof textElementSchema>;
export type ShapeElement = z.infer<typeof shapeElementSchema>;
export type ImageElement = z.infer<typeof imageElementSchema>;
export type ImageCrop = z.infer<typeof cropSchema>;
export type ChartElement = z.infer<typeof chartElementSchema>;
export type ChartSeries = z.infer<typeof chartSeriesSchema>;
export type TableElement = z.infer<typeof tableElementSchema>;
export type SlideElement = z.infer<typeof slideElementSchema>;
export type ElementType = SlideElement["type"];
export type Slide = z.infer<typeof slideSchema>;
export type Deck = z.infer<typeof deckSchema>;

type Editable<T> = Omit<T, "id" | "type" | "locked" | "groupId">;

/** Fields any element patch may touch. `id`, `type`, `locked` and `groupId` have dedicated actions. */
export type ElementPatch = Partial<
  Editable<TextElement> &
    Editable<ShapeElement> &
    Omit<Editable<ImageElement>, "crop"> &
    Editable<ChartElement> &
    Editable<TableElement> & {
      /** `null` removes the crop. */
      crop: ImageCrop | null;
    }
>;
