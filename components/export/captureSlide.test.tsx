import { afterEach, describe, expect, it, vi } from "vitest";
import { createChartElement, createImageElement, createSlide, createTableElement, createTextElement } from "@/lib/factory";
import { CAPTURE_PIXEL_RATIO, captureSlideImage, captureSlideMarkup } from "./captureSlide";

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

describe("captureSlideMarkup", () => {
  afterEach(() => {
    toJpeg.mockReset();
    delete (HTMLImageElement.prototype as Partial<HTMLImageElement>).decode;
  });

  function parseMarkup(markup: string) {
    const container = document.createElement("div");
    container.innerHTML = markup;
    return container;
  }

  it("returns the static markup of the slide at full size without editor-only attributes", async () => {
    const text = createTextElement({ text: "Hello <web>", x: 10, y: 20 });
    const table = createTableElement({ rows: [["Region", "Sales"], ["North", "12"]] });
    const chart = createChartElement("bar", { title: "Revenue" });
    const slide = { ...createSlide("#123456"), elements: [text, table, chart] };
    const markup = await captureSlideMarkup(slide);

    expect(markup).not.toContain("data-slide-id");
    expect(markup).not.toContain(slide.id);
    const fragment = parseMarkup(markup);
    expect(fragment.children).toHaveLength(1);
    const root = fragment.firstElementChild as HTMLElement;
    expect(root).toHaveStyle({ width: "1280px", height: "720px", position: "relative", overflow: "hidden" });
    expect(root.style.background).toBe("rgb(18, 52, 86)");
    expect(root.children).toHaveLength(3);
    expect((root.children[0] as HTMLElement).style.left).toBe("10px");
    expect(root.querySelector('[data-element-type="text"]')?.textContent).toBe("Hello <web>");
    expect(Array.from(root.querySelectorAll("td")).map((td) => td.textContent)).toEqual(["Region", "Sales", "North", "12"]);
    expect(root.querySelector('[data-chart-type="bar"] svg')).not.toBeNull();
    expect(root.textContent).toContain("Revenue");
    expect(toJpeg).not.toHaveBeenCalled();
  });

  it("removes its off-screen host after rendering", async () => {
    const before = document.body.innerHTML;
    let hostDuringRender: Element | null = null;
    // Capture the hidden host while the slide waits for paint.
    HTMLImageElement.prototype.decode = function () {
      hostDuringRender = document.body.querySelector(':scope > div[aria-hidden="true"]');
      return Promise.resolve();
    };
    await captureSlideMarkup({ ...createSlide(), elements: [createImageElement("data:image/png;base64,AAAA", 10, 10, "dot")] });
    expect(hostDuringRender).not.toBeNull();
    expect((hostDuringRender as unknown as HTMLElement).style.left).toBe("-20000px");
    expect(document.body.innerHTML).toBe(before);
  });

  it("still returns markup when an image fails to decode", async () => {
    HTMLImageElement.prototype.decode = () => Promise.reject(new Error("broken image"));
    const markup = await captureSlideMarkup({ ...createSlide(), elements: [createImageElement("data:image/png;base64,AAAA", 10, 10, "Broken")] });
    const img = parseMarkup(markup).querySelector("img");
    expect(img?.getAttribute("alt")).toBe("Broken");
    expect(img?.getAttribute("src")).toBe("data:image/png;base64,AAAA");
  });
});
