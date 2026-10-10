import { describe, expect, it } from "vitest";
import { exportFileName, UNTITLED } from "./filename";

describe("exportFileName", () => {
  it("uses the title", () => {
    expect(exportFileName("Quarterly Review", "pdf")).toBe("Quarterly Review.pdf");
  });
  it("replaces characters that aren't allowed in file names", () => {
    expect(exportFileName('Q1/Q2: "Plan" <draft>?', "pptx")).toBe("Q1 Q2 Plan draft .pptx".replace(" .", "."));
  });
  it("falls back for empty or dot-only titles", () => {
    expect(exportFileName("   ", "pdf")).toBe(`${UNTITLED}.pdf`);
    expect(exportFileName("...", "pdf")).toBe(`${UNTITLED}.pdf`);
  });
  it("limits the length", () => {
    expect(exportFileName("a".repeat(300), "pdf")).toBe(`${"a".repeat(80)}.pdf`);
  });
});
