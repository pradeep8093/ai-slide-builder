import { ACCEPTED_IMAGE_TYPES, MAX_IMAGE_DIMENSION, MAX_IMAGE_FILE_BYTES } from "./constants";

export class ImageImportError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ImageImportError";
  }
}

export interface ImportedImage {
  src: string;
  width: number;
  height: number;
}

function readAsDataUrl(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new ImageImportError("The image file couldn't be read."));
    reader.readAsDataURL(file);
  });
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new ImageImportError("This file isn't a valid image."));
    img.src = src;
  });
}

/**
 * Validates an image file and returns it as a data URL that can be stored locally and exported.
 * Large images are scaled down (longest side ≤ MAX_IMAGE_DIMENSION) to keep the saved deck small;
 * WebP is converted to PNG because older PowerPoint versions can't open it.
 */
export async function importImageFile(file: File): Promise<ImportedImage> {
  if (!(ACCEPTED_IMAGE_TYPES as readonly string[]).includes(file.type)) {
    throw new ImageImportError("Unsupported image type. Use PNG, JPEG, WebP or GIF.");
  }
  if (file.size > MAX_IMAGE_FILE_BYTES) {
    throw new ImageImportError(`Images must be ${Math.round(MAX_IMAGE_FILE_BYTES / 1024 / 1024)} MB or smaller.`);
  }
  const original = await readAsDataUrl(file);
  const img = await loadImage(original);
  const width = img.naturalWidth;
  const height = img.naturalHeight;
  if (!width || !height) throw new ImageImportError("This file isn't a valid image.");

  const scale = Math.min(1, MAX_IMAGE_DIMENSION / Math.max(width, height));
  if (scale === 1 && file.type !== "image/webp") return { src: original, width, height };

  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(width * scale));
  canvas.height = Math.max(1, Math.round(height * scale));
  const context = canvas.getContext("2d");
  if (!context) throw new ImageImportError("Your browser couldn't process this image.");
  context.drawImage(img, 0, 0, canvas.width, canvas.height);
  const type = file.type === "image/jpeg" ? "image/jpeg" : "image/png";
  return { src: canvas.toDataURL(type, 0.9), width: canvas.width, height: canvas.height };
}
