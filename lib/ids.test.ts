import { afterEach, describe, expect, it, vi } from "vitest";
import { createId } from "./ids";

describe("createId", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("creates unique ids", () => {
    const ids = new Set(Array.from({ length: 500 }, () => createId()));
    expect(ids.size).toBe(500);
  });

  it("falls back when crypto.randomUUID is unavailable", () => {
    vi.stubGlobal("crypto", {});
    const a = createId();
    const b = createId();
    expect(a).toMatch(/^id-/);
    expect(a).not.toBe(b);
  });
});
