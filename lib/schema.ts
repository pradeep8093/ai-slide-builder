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
  MAX_SLIDES,
  MAX_TEXT_LENGTH,
  MAX_TITLE_LENGTH,
  SHAPE_KINDS,
  STROKE_WIDTH_MAX,
  TEXT_ALIGNS,
} from "./constants";

export const hexColorSchema = z.string().regex(/^#[0-9a-f]{6}$/i, "Expected a #rrggbb color");

const geometry = {
  id: z.string().min(1),
  x: z.number().finite(),
  y: z.number().finite(),
  width: z.number().finite().positive(),
  height: z.number().finite().positive(),
};

export const textElementSchema = z.object({
  ...geometry,
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
  ...geometry,
  type: z.literal("shape"),
  shape: z.enum(SHAPE_KINDS),
  fill: hexColorSchema.nullable(),
  stroke: hexColorSchema.nullable(),
  strokeWidth: z.number().min(0).max(STROKE_WIDTH_MAX),
});

export const imageElementSchema = z.object({
  ...geometry,
  type: z.literal("image"),
  src: z.string().regex(/^data:image\/(png|jpeg|webp|gif);base64,/, "Expected an image data URL"),
  alt: z.string().max(MAX_ALT_LENGTH),
});

export const chartSeriesSchema = z.object({
  name: z.string().max(MAX_CHART_LABEL_LENGTH),
  values: z.array(z.number().finite()),
});

export const chartElementSchema = z
  .object({
    ...geometry,
    type: z.literal("chart"),
    chartType: z.enum(CHART_KINDS),
    title: z.string().max(200),
    categories: z.array(z.string().max(MAX_CHART_LABEL_LENGTH)).min(1).max(MAX_CHART_CATEGORIES),
    series: z.array(chartSeriesSchema).min(1).max(MAX_CHART_SERIES),
    showLegend: z.boolean(),
  })
  .refine((c) => c.series.every((s) => s.values.length === c.categories.length), {
    message: "Every series needs exactly one value per category",
  });

export const slideElementSchema = z.discriminatedUnion("type", [
  textElementSchema,
  shapeElementSchema,
  imageElementSchema,
  chartElementSchema,
]);

export const slideSchema = z.object({
  id: z.string().min(1),
  background: hexColorSchema,
  elements: z.array(slideElementSchema).max(MAX_ELEMENTS_PER_SLIDE),
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
export type ChartElement = z.infer<typeof chartElementSchema>;
export type ChartSeries = z.infer<typeof chartSeriesSchema>;
export type SlideElement = z.infer<typeof slideElementSchema>;
export type ElementType = SlideElement["type"];
export type Slide = z.infer<typeof slideSchema>;
export type Deck = z.infer<typeof deckSchema>;

/** Fields any element patch may touch. `id` and `type` are never patchable. */
export type ElementPatch = Partial<
  Omit<TextElement, "id" | "type"> &
    Omit<ShapeElement, "id" | "type"> &
    Omit<ImageElement, "id" | "type"> &
    Omit<ChartElement, "id" | "type">
>;
