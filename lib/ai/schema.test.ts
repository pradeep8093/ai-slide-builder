import { describe, expect, it } from "vitest";
import { aiResponseSchema, buildResponseJsonSchema } from "./schema";

type Node = Record<string, unknown>;

/** Walks every sub-schema of a JSON schema. */
function walk(node: unknown, visit: (n: Node) => void) {
  if (Array.isArray(node)) return node.forEach((n) => walk(n, visit));
  if (!node || typeof node !== "object") return;
  visit(node as Node);
  for (const value of Object.values(node as Node)) walk(value, visit);
}

describe("response JSON schema (Groq strict mode)", () => {
  const schema = buildResponseJsonSchema();

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
      expect(n.pattern).toBeUndefined();
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

  it("accepts a well-formed response and rejects extra keys", () => {
    const ok = { reply: "Done", operations: [{ op: "set_title", title: "X" }] };
    expect(aiResponseSchema.safeParse(ok).success).toBe(true);
    expect(aiResponseSchema.safeParse({ ...ok, extra: 1 }).success).toBe(false);
    expect(aiResponseSchema.safeParse({ reply: "x", operations: [{ op: "explode" }] }).success).toBe(false);
  });
});
