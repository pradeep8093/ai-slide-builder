import { afterEach, describe, expect, it, vi } from "vitest";
import { createSlide, createTextElement } from "@/lib/factory";
import { CAPTURE_PIXEL_RATIO, captureSlideImage } from "./captureSlide";

const toJpeg = vi.fn();
vi.mock("html-to-image", () => ({ toJpeg: (...args: unknown[]) => toJpeg(...args) }));

describe("captureSlideImage", () => {
  afterEach(() => toJpeg.mockReset());

  it("renders the slide off-screen at full size and cleans up", async () => {
    const slide = { ...createSlide("#123456"), elements: [createTextElement({ text: "Captured" })] };
    let rendered = "";
    toJpeg.mockImplementation(async (node: HTMLElement) => {
      rendered = node.textContent ?? "";
      expect(node.getAttribute("data-slide-id")).toBe(slide.id);
      return "data:image/jpeg;base64,OK";
    });
    const before = document.body.childElementCount;
    await expect(captureSlideImage(slide)).resolves.toBe("data:image/jpeg;base64,OK");
    expect(rendered).toContain("Captured");
    expect(toJpeg).toHaveBeenCalledWith(expect.any(HTMLElement), expect.objectContaining({ width: 1280, height: 720, pixelRatio: CAPTURE_PIXEL_RATIO, backgroundColor: "#123456" }));
    expect(document.body.childElementCount).toBe(before);
  });

  it("cleans up when rendering to an image fails", async () => {
    toJpeg.mockRejectedValue(new Error("tainted canvas"));
    const before = document.body.childElementCount;
    await expect(captureSlideImage(createSlide())).rejects.toThrow("tainted canvas");
    expect(document.body.childElementCount).toBe(before);
  });
});
