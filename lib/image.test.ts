import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MAX_IMAGE_DIMENSION, MAX_IMAGE_FILE_BYTES } from "./constants";
import { ImageImportError, importImageFile } from "./image";

let nextSize = { width: 800, height: 600 };
let failLoad = false;

class FakeImage {
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  naturalWidth = 0;
  naturalHeight = 0;
  set src(_value: string) {
    setTimeout(() => {
      if (failLoad) {
        this.onerror?.();
        return;
      }
      this.naturalWidth = nextSize.width;
      this.naturalHeight = nextSize.height;
      this.onload?.();
    }, 0);
  }
}

function file(type: string, size = 100, name = "photo") {
  const f = new File([new Uint8Array(Math.min(size, 64))], name, { type });
  if (size > 64) Object.defineProperty(f, "size", { value: size });
  return f;
}

describe("importImageFile", () => {
  beforeEach(() => {
    nextSize = { width: 800, height: 600 };
    failLoad = false;
    vi.stubGlobal("Image", FakeImage);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("returns small images unchanged as data URLs", async () => {
    const result = await importImageFile(file("image/png"));
    expect(result.src).toMatch(/^data:image\/png;base64,/);
    expect(result).toMatchObject({ width: 800, height: 600 });
  });

  it("rejects unsupported types", async () => {
    await expect(importImageFile(file("image/svg+xml"))).rejects.toThrow(/Unsupported image type/);
    await expect(importImageFile(file("application/pdf"))).rejects.toBeInstanceOf(ImageImportError);
  });

  it("rejects files that are too large", async () => {
    await expect(importImageFile(file("image/png", MAX_IMAGE_FILE_BYTES + 1))).rejects.toThrow(/10 MB or smaller/);
  });

  it("rejects files that aren't decodable images", async () => {
    failLoad = true;
    await expect(importImageFile(file("image/png"))).rejects.toThrow(/isn't a valid image/);
  });

  it("rejects images with no dimensions", async () => {
    nextSize = { width: 0, height: 0 };
    await expect(importImageFile(file("image/png"))).rejects.toThrow(/isn't a valid image/);
  });

  it("scales large images down, keeping the format for JPEG", async () => {
    nextSize = { width: 4000, height: 2000 };
    const drawImage = vi.fn();
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({ drawImage } as unknown as CanvasRenderingContext2D);
    const toDataURL = vi.spyOn(HTMLCanvasElement.prototype, "toDataURL").mockReturnValue("data:image/jpeg;base64,SCALED");
    const result = await importImageFile(file("image/jpeg"));
    expect(result).toEqual({ src: "data:image/jpeg;base64,SCALED", width: MAX_IMAGE_DIMENSION, height: MAX_IMAGE_DIMENSION / 2 });
    expect(toDataURL).toHaveBeenCalledWith("image/jpeg", 0.9);
    expect(drawImage).toHaveBeenCalled();
  });

  it("converts WebP to PNG even when small", async () => {
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({ drawImage: vi.fn() } as unknown as CanvasRenderingContext2D);
    const toDataURL = vi.spyOn(HTMLCanvasElement.prototype, "toDataURL").mockReturnValue("data:image/png;base64,PNG");
    const result = await importImageFile(file("image/webp"));
    expect(result.src).toBe("data:image/png;base64,PNG");
    expect(toDataURL).toHaveBeenCalledWith("image/png", 0.9);
  });

  it("reports when the browser can't process the image", async () => {
    nextSize = { width: 5000, height: 5000 };
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
    await expect(importImageFile(file("image/png"))).rejects.toThrow(/couldn't process/);
  });
});
