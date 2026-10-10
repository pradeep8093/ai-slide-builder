import { describe, expect, it } from "vitest";
import { inkFor, isDarkColor, normalizeColor, relativeLuminance } from "./color";

describe("normalizeColor", () => {
  it("accepts #rrggbb and lowercases it", () => {
    expect(normalizeColor("#AABBCC")).toBe("#aabbcc");
  });
  it("expands #rgb", () => {
    expect(normalizeColor("#fA0")).toBe("#ffaa00");
  });
  it("accepts values without the leading #", () => {
    expect(normalizeColor("112233")).toBe("#112233");
    expect(normalizeColor(" abc ")).toBe("#aabbcc");
  });
  it.each([["red"], ["#12345"], ["#gggggg"], [""], [null], [undefined], [42], ["rgb(0,0,0)"]])("rejects %s", (value) => {
    expect(normalizeColor(value)).toBeNull();
  });
});

describe("luminance and darkness", () => {
  it("computes luminance at the extremes", () => {
    expect(relativeLuminance("#000000")).toBe(0);
    expect(relativeLuminance("#ffffff")).toBeCloseTo(1);
  });
  it("falls back to white for invalid colors", () => {
    expect(relativeLuminance("nope")).toBeCloseTo(1);
  });
  it("classifies dark and light backgrounds", () => {
    expect(isDarkColor("#0f172a")).toBe(true);
    expect(isDarkColor("#312e81")).toBe(true);
    expect(isDarkColor("#ffffff")).toBe(false);
    expect(isDarkColor("#fbfaf7")).toBe(false);
  });
  it("returns light ink for dark backgrounds and dark ink for light ones", () => {
    expect(inkFor("#000000").primary).toBe("#f0efec");
    expect(inkFor("#ffffff").primary).toBe("#0b0b0b");
  });
});
