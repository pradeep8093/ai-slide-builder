import { z } from "zod";
import { CHART_KINDS, FONT_FAMILIES, SHAPE_KINDS, TEXT_ALIGNS } from "../constants";

/*
 * The contract between the app and the LLM. The model must answer with `aiResponseSchema`.
 * Every object is strict and every field is required (optional values are nullable) because
 * Groq's strict structured-output mode requires exactly that. Value ranges are NOT expressed here
 * (unsupported by strict mode); they are enforced when operations are applied.
 */

const geometry = {
  x: z.number(),
  y: z.number(),
  width: z.number(),
  height: z.number(),
};

const chartSeries = z.strictObject({ name: z.string(), values: z.array(z.number()) });

export const aiTextSpecSchema = z.strictObject({
  type: z.literal("text"),
  ...geometry,
  text: z.string(),
  fontSize: z.number().nullable(),
  fontFamily: z.enum(FONT_FAMILIES).nullable(),
  color: z.string().nullable(),
  bold: z.boolean().nullable(),
  italic: z.boolean().nullable(),
  underline: z.boolean().nullable(),
  align: z.enum(TEXT_ALIGNS).nullable(),
});

export const aiShapeSpecSchema = z.strictObject({
  type: z.literal("shape"),
  shape: z.enum(SHAPE_KINDS),
  ...geometry,
  fill: z.string().nullable(),
  stroke: z.string().nullable(),
  strokeWidth: z.number().nullable(),
});

export const aiChartSpecSchema = z.strictObject({
  type: z.literal("chart"),
  chartType: z.enum(CHART_KINDS),
  ...geometry,
  title: z.string().nullable(),
  categories: z.array(z.string()),
  series: z.array(chartSeries),
  showLegend: z.boolean().nullable(),
  stacked: z.boolean().nullable(),
  showValues: z.boolean().nullable(),
  dualAxis: z.boolean().nullable(),
});

export const aiTableSpecSchema = z.strictObject({
  type: z.literal("table"),
  ...geometry,
  rows: z.array(z.array(z.string())),
  headerRow: z.boolean().nullable(),
  fontSize: z.number().nullable(),
});

export const aiElementSpecSchema = z.union([aiTextSpecSchema, aiShapeSpecSchema, aiChartSpecSchema, aiTableSpecSchema]);

export const aiElementChangesSchema = z.strictObject({
  x: z.number().nullable(),
  y: z.number().nullable(),
  width: z.number().nullable(),
  height: z.number().nullable(),
  text: z.string().nullable(),
  fontSize: z.number().nullable(),
  fontFamily: z.enum(FONT_FAMILIES).nullable(),
  color: z.string().nullable(),
  bold: z.boolean().nullable(),
  italic: z.boolean().nullable(),
  underline: z.boolean().nullable(),
  align: z.enum(TEXT_ALIGNS).nullable(),
  shape: z.enum(SHAPE_KINDS).nullable(),
  fill: z.string().nullable(),
  stroke: z.string().nullable(),
  strokeWidth: z.number().nullable(),
  chartType: z.enum(CHART_KINDS).nullable(),
  title: z.string().nullable(),
  categories: z.array(z.string()).nullable(),
  series: z.array(chartSeries).nullable(),
  showLegend: z.boolean().nullable(),
  stacked: z.boolean().nullable(),
  showValues: z.boolean().nullable(),
  dualAxis: z.boolean().nullable(),
  rows: z.array(z.array(z.string())).nullable(),
  headerRow: z.boolean().nullable(),
  headerFill: z.string().nullable(),
  borderColor: z.string().nullable(),
  alt: z.string().nullable(),
});

export const aiOperationSchema = z.union([
  z.strictObject({ op: z.literal("set_title"), title: z.string() }),
  z.strictObject({
    op: z.literal("add_slide"),
    position: z.number().int().nullable(),
    background: z.string().nullable(),
    notes: z.string().nullable(),
    elements: z.array(aiElementSpecSchema),
  }),
  z.strictObject({ op: z.literal("delete_slide"), slideId: z.string() }),
  z.strictObject({ op: z.literal("move_slide"), slideId: z.string(), position: z.number().int() }),
  z.strictObject({ op: z.literal("set_slide_background"), slideId: z.string(), background: z.string() }),
  z.strictObject({ op: z.literal("set_slide_notes"), slideId: z.string(), notes: z.string() }),
  z.strictObject({ op: z.literal("add_element"), slideId: z.string(), element: aiElementSpecSchema }),
  z.strictObject({ op: z.literal("update_element"), elementId: z.string(), changes: aiElementChangesSchema }),
  z.strictObject({ op: z.literal("delete_element"), elementId: z.string() }),
]);

export const aiResponseSchema = z.strictObject({
  reply: z.string(),
  operations: z.array(aiOperationSchema),
});

export type AiElementSpec = z.infer<typeof aiElementSpecSchema>;
export type AiElementChanges = z.infer<typeof aiElementChangesSchema>;
export type AiOperation = z.infer<typeof aiOperationSchema>;
export type AiResponse = z.infer<typeof aiResponseSchema>;

const ALLOWED_KEYWORDS = new Set([
  "type",
  "properties",
  "required",
  "additionalProperties",
  "items",
  "anyOf",
  "enum",
  "description",
  "$defs",
  "$ref",
]);

type JsonSchema = { [key: string]: unknown };

function clean(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(clean);
  if (!node || typeof node !== "object") return node;
  const source = node as JsonSchema;
  const out: JsonSchema = {};
  for (const [key, value] of Object.entries(source)) {
    if (key === "const") {
      out.enum = [value];
      continue;
    }
    if (!ALLOWED_KEYWORDS.has(key)) continue;
    if (key === "properties" || key === "$defs") {
      out[key] = Object.fromEntries(Object.entries(value as JsonSchema).map(([k, v]) => [k, clean(v)]));
    } else {
      out[key] = clean(value);
    }
  }
  return out;
}

/** JSON Schema for the response, restricted to the keywords Groq's strict mode accepts. */
export function buildResponseJsonSchema(): JsonSchema {
  return clean(z.toJSONSchema(aiResponseSchema, { target: "draft-7" })) as JsonSchema;
}
