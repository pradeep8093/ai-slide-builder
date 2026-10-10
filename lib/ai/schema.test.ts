import { describe, expect, it } from "vitest";
import {
  aiChartSpecSchema,
  aiElementChangesSchema,
  aiOperationSchema,
  aiResponseSchema,
  aiTableSpecSchema,
  buildResponseJsonSchema,
} from "./schema";

type Node = Record<string, unknown>;

/** Walks every sub-schema of a JSON schema. */
function walk(node: unknown, visit: (n: Node) => void) {
  if (Array.isArray(node)) return node.forEach((n) => walk(n, visit));
  if (!node || typeof node !== "object") return;
  visit(node as Node);
  for (const value of Object.values(node as Node)) walk(value, visit);
}

const tableSpec = { type: "table", x: 0, y: 0, width: 400, height: 200, rows: [["a", "b"], ["1", "2"]], headerRow: null, fontSize: null };
const chartSpec = {
  type: "chart", chartType: "scatter", x: 0, y: 0, width: 400, height: 200, title: null, categories: ["1", "2"], series: [{ name: "s", values: [1, 2] }],
  showLegend: null, stacked: null, showValues: true, dualAxis: false,
};

describe("AI operation schemas", () => {
  it("accepts table specs with every field present", () => {
    expect(aiTableSpecSchema.safeParse(tableSpec).success).toBe(true);
    expect(aiTableSpecSchema.safeParse({ ...tableSpec, headerRow: true, fontSize: 18, rows: [] }).success).toBe(true);
    const { headerRow: _headerRow, ...missing } = tableSpec;
    void _headerRow;
    expect(aiTableSpecSchema.safeParse(missing).success).toBe(false);
    expect(aiTableSpecSchema.safeParse({ ...tableSpec, headerFill: "#ffffff" }).success).toBe(false);
    expect(aiTableSpecSchema.safeParse({ ...tableSpec, rows: [[1, 2]] }).success).toBe(false);
  });

  it("requires the new chart options (nullable)", () => {
    expect(aiChartSpecSchema.safeParse(chartSpec).success).toBe(true);
    expect(aiChartSpecSchema.safeParse({ ...chartSpec, chartType: "doughnut" }).success).toBe(true);
    for (const key of ["stacked", "showValues", "dualAxis"] as const) {
      const copy: Record<string, unknown> = { ...chartSpec };
      delete copy[key];
      expect(aiChartSpecSchema.safeParse(copy).success).toBe(false);
    }
    expect(aiChartSpecSchema.safeParse({ ...chartSpec, chartType: "radar" }).success).toBe(false);
  });

  it("supports set_slide_notes and notes on add_slide", () => {
    expect(aiOperationSchema.safeParse({ op: "set_slide_notes", slideId: "S1", notes: "Hello" }).success).toBe(true);
    expect(aiOperationSchema.safeParse({ op: "set_slide_notes", slideId: "S1", notes: null }).success).toBe(false);
    expect(aiOperationSchema.safeParse({ op: "set_slide_notes", slideId: "S1" }).success).toBe(false);

    const addSlide = { op: "add_slide", position: null, background: null, notes: "Speaker notes", elements: [tableSpec, chartSpec] };
    expect(aiOperationSchema.safeParse(addSlide).success).toBe(true);
    expect(aiOperationSchema.safeParse({ ...addSlide, notes: null }).success).toBe(true);
    const { notes: _notes, ...withoutNotes } = addSlide;
    void _notes;
    expect(aiOperationSchema.safeParse(withoutNotes).success).toBe(false);
    expect(aiOperationSchema.safeParse({ ...addSlide, position: 1.5 }).success).toBe(false);
  });

  it("requires every element change key, including the table and chart ones", () => {
    const changes = Object.fromEntries(Object.keys(aiElementChangesSchema.shape).map((k) => [k, null]));
    for (const key of ["stacked", "showValues", "dualAxis", "rows", "headerRow", "headerFill", "borderColor"]) expect(changes).toHaveProperty(key);
    expect(aiElementChangesSchema.safeParse(changes).success).toBe(true);
    expect(aiElementChangesSchema.safeParse({ ...changes, rows: [["a"]], headerRow: true, headerFill: "none", stacked: true }).success).toBe(true);
    const { rows: _rows, ...missing } = changes;
    void _rows;
    expect(aiElementChangesSchema.safeParse(missing).success).toBe(false);
    expect(aiElementChangesSchema.safeParse({ ...changes, locked: false }).success).toBe(false);
    expect(aiElementChangesSchema.safeParse({ ...changes, groupId: "g" }).success).toBe(false);
  });

  it("accepts a well-formed response and rejects extra keys", () => {
    const ok = { reply: "Done", operations: [{ op: "set_title", title: "X" }] };
    expect(aiResponseSchema.safeParse(ok).success).toBe(true);
    expect(aiResponseSchema.safeParse({ ...ok, extra: 1 }).success).toBe(false);
    expect(aiResponseSchema.safeParse({ reply: "x", operations: [{ op: "explode" }] }).success).toBe(false);
    expect(aiResponseSchema.safeParse({ reply: "x", operations: [{ op: "add_element", slideId: "S1", element: tableSpec }] }).success).toBe(true);
    expect(aiResponseSchema.safeParse({ reply: "x", operations: [{ op: "add_element", slideId: "S1", element: { ...tableSpec, type: "image" } }] }).success).toBe(false);
  });
});

describe("response JSON schema (Groq strict mode)", () => {
  const schema = buildResponseJsonSchema();

  function operations(): Node[] {
    return ((schema.properties as Node).operations as Node & { items: { anyOf: Node[] } }).items.anyOf;
  }

  function operation(name: string): Node & { properties: Record<string, Node>; required: string[] } {
    const found = operations().find((o) => ((o.properties as Record<string, Node>).op.enum as string[])[0] === name);
    if (!found) throw new Error(`no ${name} operation`);
    return found as Node & { properties: Record<string, Node>; required: string[] };
  }

  it("has no $schema and only supported keywords", () => {
    expect(schema.$schema).toBeUndefined();
    const allowed = new Set(["type", "properties", "required", "additionalProperties", "items", "anyOf", "enum", "description", "$defs", "$ref"]);
    walk(schema, (n) => {
      if ("properties" in n && typeof n.properties === "object" && n.type === "object") {
        for (const key of Object.keys(n)) expect(allowed.has(key)).toBe(true);
      }
      expect(n.const).toBeUndefined();
      expect(n.minimum).toBeUndefined();
      expect(n.maximum).toBeUndefined();
      expect(n.exclusiveMinimum).toBeUndefined();
      expect(n.exclusiveMaximum).toBeUndefined();
      expect(n.pattern).toBeUndefined();
      expect(n.format).toBeUndefined();
    });
  });

  it("makes every object strict with all properties required", () => {
    let objects = 0;
    walk(schema, (n) => {
      if (n.type === "object") {
        objects += 1;
        expect(n.additionalProperties).toBe(false);
        expect([...(n.required as string[])].sort()).toEqual(Object.keys(n.properties as Node).sort());
      }
    });
    expect(objects).toBeGreaterThan(10);
  });

  it("describes the reply and operations at the top level", () => {
    expect(Object.keys(schema.properties as Node)).toEqual(["reply", "operations"]);
  });

  it("lists every operation, turning literals into single-value enums", () => {
    const ops = operations().map((o) => (o.properties as Record<string, Node>).op);
    expect(ops.map((o) => o.enum)).toEqual([
      ["set_title"],
      ["add_slide"],
      ["delete_slide"],
      ["move_slide"],
      ["set_slide_background"],
      ["set_slide_notes"],
      ["add_element"],
      ["update_element"],
      ["delete_element"],
    ]);
    for (const op of ops) expect(op.type).toBe("string");
  });

  it("includes notes on add_slide and the notes operation", () => {
    expect(operation("add_slide").required).toContain("notes");
    expect(operation("add_slide").properties.notes).toEqual({ type: ["string", "null"] });
    expect(operation("set_slide_notes").properties.notes).toEqual({ type: "string" });
  });

  it("describes all four element specs, including tables and the new chart options", () => {
    const specs = ((operation("add_element").properties.element as Node).anyOf as Node[]).map((s) => s as Node & { properties: Record<string, Node> });
    expect(specs.map((s) => s.properties.type.enum)).toEqual([["text"], ["shape"], ["chart"], ["table"]]);
    const table = specs[3];
    expect(table.properties.rows).toEqual({ type: "array", items: { type: "array", items: { type: "string" } } });
    expect(table.properties.headerRow).toEqual({ type: ["boolean", "null"] });
    const chart = specs[2];
    for (const key of ["stacked", "showValues", "dualAxis"]) expect(chart.properties[key]).toEqual({ type: ["boolean", "null"] });
    expect((chart.properties.chartType.enum as string[]).sort()).toEqual(["area", "bar", "doughnut", "line", "pie", "scatter"]);
  });

  it("lets update_element change table fields and chart options", () => {
    const changes = operation("update_element").properties.changes as Node & { properties: Record<string, Node> };
    for (const key of ["stacked", "showValues", "dualAxis", "rows", "headerRow", "headerFill", "borderColor"]) {
      expect(changes.properties).toHaveProperty(key);
      expect(changes.required as string[]).toContain(key);
    }
    expect(changes.properties).not.toHaveProperty("locked");
    expect(changes.properties).not.toHaveProperty("groupId");
  });
});
