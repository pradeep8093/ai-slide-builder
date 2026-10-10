import { describe, expect, it, vi } from "vitest";
import { createDeck, createSlide } from "../factory";
import { exportPdf, PDF_PAGE_HEIGHT, PDF_PAGE_WIDTH, type PdfDocument } from "./pdf";

const jspdf = vi.hoisted(() => ({ options: null as unknown, saved: "" }));
vi.mock("jspdf", () => ({
  jsPDF: class {
    constructor(options: unknown) {
      jspdf.options = options;
    }
    addPage() {}
    addImage() {}
    setProperties() {}
    save(name: string) {
      jspdf.saved = name;
    }
  },
}));

function fakeDoc() {
  const calls: string[] = [];
  const doc: PdfDocument = {
    addPage: vi.fn(() => calls.push("addPage")),
    addImage: vi.fn((data: string) => calls.push(`image:${data}`)),
    setProperties: vi.fn(),
    save: vi.fn(),
  };
  return { doc, calls };
}

describe("exportPdf", () => {
  it("adds one page per slide in order and saves with the title", async () => {
    const deck = { ...createDeck("Plan"), slides: [createSlide(), createSlide(), createSlide()] };
    const { doc, calls } = fakeDoc();
    const progress: [number, number][] = [];
    const name = await exportPdf(deck, {
      captureSlide: async (_slide, i) => `img${i}`,
      createDocument: async () => doc,
      onProgress: (done, total) => progress.push([done, total]),
    });
    expect(name).toBe("Plan.pdf");
    expect(calls).toEqual(["image:img0", "addPage", "image:img1", "addPage", "image:img2"]);
    expect(doc.addImage).toHaveBeenCalledWith("img0", "JPEG", 0, 0, PDF_PAGE_WIDTH, PDF_PAGE_HEIGHT, "slide-1", "FAST");
    expect(doc.setProperties).toHaveBeenCalledWith({ title: "Plan" });
    expect(doc.save).toHaveBeenCalledWith("Plan.pdf");
    expect(progress).toEqual([[0, 3], [1, 3], [2, 3], [3, 3]]);
  });

  it("refuses an empty deck and propagates capture errors without saving", async () => {
    const { doc } = fakeDoc();
    await expect(exportPdf(createDeck(), { captureSlide: async () => "", createDocument: async () => doc })).rejects.toThrow(/at least one slide/);
    const deck = { ...createDeck(""), slides: [createSlide()] };
    await expect(
      exportPdf(deck, { captureSlide: () => Promise.reject(new Error("render failed")), createDocument: async () => doc }),
    ).rejects.toThrow("render failed");
    expect(doc.save).not.toHaveBeenCalled();
  });

  it("creates a 16:9 jsPDF document by default", async () => {
    const deck = { ...createDeck(""), slides: [createSlide()] };
    const name = await exportPdf(deck, { captureSlide: async () => "data:image/jpeg;base64,AAAA" });
    expect(name).toBe("Untitled presentation.pdf");
    expect(jspdf.options).toEqual({ orientation: "landscape", unit: "pt", format: [PDF_PAGE_WIDTH, PDF_PAGE_HEIGHT], compress: true });
    expect(jspdf.saved).toBe("Untitled presentation.pdf");
  });
});
