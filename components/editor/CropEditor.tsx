"use client";

import { useEffect, useRef, useState } from "react";
import { RotateCcw } from "lucide-react";
import { SLIDE_HEIGHT, SLIDE_WIDTH } from "@/lib/constants";
import { clamp, fitWithin, type Rect } from "@/lib/geometry";
import type { ImageCrop, ImageElement } from "@/lib/schema";
import { useEditorStore } from "@/lib/store/editorStore";
import Modal from "../ui/Modal";

/** Smallest crop, as a fraction of the image's width/height. */
export const MIN_CROP = 0.05;
const FULL: ImageCrop = { x: 0, y: 0, width: 1, height: 1 };
const PREVIEW_MAX_WIDTH = 640;
const PREVIEW_MAX_HEIGHT = 400;

type CropHandle = "nw" | "ne" | "se" | "sw";
const HANDLES: CropHandle[] = ["nw", "ne", "se", "sw"];

/** Moves the crop box by (dx, dy) image fractions, keeping it inside the image. */
export function moveCrop(start: ImageCrop, dx: number, dy: number): ImageCrop {
  return {
    ...start,
    x: clamp(start.x + dx, 0, 1 - start.width),
    y: clamp(start.y + dy, 0, 1 - start.height),
  };
}

/** Drags one corner of the crop box; the opposite corner stays put. */
export function resizeCrop(start: ImageCrop, handle: CropHandle, dx: number, dy: number): ImageCrop {
  let left = start.x;
  let top = start.y;
  let right = start.x + start.width;
  let bottom = start.y + start.height;
  // A stored crop may already be smaller than MIN_CROP; then the box can only grow, never leave the image.
  if (handle.includes("w")) left = clamp(left + dx, 0, Math.max(0, right - MIN_CROP));
  else right = clamp(right + dx, Math.min(1, left + MIN_CROP), 1);
  if (handle.includes("n")) top = clamp(top + dy, 0, Math.max(0, bottom - MIN_CROP));
  else bottom = clamp(bottom + dy, Math.min(1, top + MIN_CROP), 1);
  return { x: left, y: top, width: right - left, height: bottom - top };
}

/**
 * Where the element goes after its crop changes. Like PowerPoint, the picture keeps its scale and
 * stays put: cropping an edge away shrinks the box from that edge; un-cropping grows it back.
 * If the result would no longer fit on the slide it is scaled down to fit.
 */
export function croppedGeometry(element: Rect, previous: ImageCrop, next: ImageCrop): Rect {
  // Size of the whole (uncropped) picture at the element's current scale.
  const fullWidth = element.width / previous.width;
  const fullHeight = element.height / previous.height;
  const fitted = fitWithin(fullWidth * next.width, fullHeight * next.height, SLIDE_WIDTH, SLIDE_HEIGHT);
  return {
    x: element.x + (next.x - previous.x) * fullWidth,
    y: element.y + (next.y - previous.y) * fullHeight,
    width: fitted.width,
    height: fitted.height,
  };
}

interface CropEditorProps {
  slideId: string;
  image: ImageElement;
  onClose: () => void;
}

interface Drag {
  mode: "move" | CropHandle;
  startX: number;
  startY: number;
  start: ImageCrop;
}

/** Modal for choosing which part of an image is shown. The whole image stays stored, so a crop can be undone. */
export default function CropEditor({ slideId, image, onClose }: CropEditorProps) {
  const [crop, setCrop] = useState<ImageCrop>(image.crop ?? FULL);
  const [natural, setNatural] = useState<{ width: number; height: number } | null>(null);
  const previous = image.crop ?? FULL;
  const frameRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<Drag | null>(null);

  useEffect(() => {
    const onMove = (event: PointerEvent) => {
      const drag = dragRef.current;
      const rect = frameRef.current?.getBoundingClientRect();
      if (!drag || !rect || rect.width <= 0 || rect.height <= 0) return;
      const dx = (event.clientX - drag.startX) / rect.width;
      const dy = (event.clientY - drag.startY) / rect.height;
      setCrop(drag.mode === "move" ? moveCrop(drag.start, dx, dy) : resizeCrop(drag.start, drag.mode, dx, dy));
    };
    const onUp = () => {
      dragRef.current = null;
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
    };
  }, []);

  const startDrag = (event: React.PointerEvent, mode: Drag["mode"]) => {
    if (event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    dragRef.current = { mode, startX: event.clientX, startY: event.clientY, start: crop };
  };

  const onKeyDown = (event: React.KeyboardEvent) => {
    const step = event.shiftKey ? 0.05 : 0.01;
    const moves: Record<string, [number, number]> = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] };
    const move = moves[event.key];
    if (!move) return;
    event.preventDefault();
    setCrop((c) => moveCrop(c, move[0], move[1]));
  };

  const apply = () => {
    const isFull = crop.x <= 0 && crop.y <= 0 && crop.width >= 0.9999 && crop.height >= 0.9999;
    useEditorStore.getState().updateElement(slideId, image.id, {
      crop: isFull ? null : crop,
      ...croppedGeometry(image, previous, crop),
    });
    onClose();
  };

  const preview = natural ? fitWithin(natural.width, natural.height, PREVIEW_MAX_WIDTH, PREVIEW_MAX_HEIGHT) : { width: PREVIEW_MAX_WIDTH, height: PREVIEW_MAX_HEIGHT };
  const pct = (n: number) => `${n * 100}%`;

  return (
    <Modal
      title="Crop image"
      onClose={onClose}
      width={720}
      footer={
        <>
          <button
            type="button"
            onClick={() => setCrop(FULL)}
            className="mr-auto inline-flex h-9 items-center gap-1.5 rounded-md px-3 text-sm font-medium text-neutral-700 hover:bg-neutral-100"
          >
            <RotateCcw size={14} aria-hidden />
            Reset
          </button>
          <button type="button" onClick={onClose} className="h-9 rounded-md border border-neutral-200 px-4 text-sm font-medium text-neutral-700 hover:bg-neutral-50">
            Cancel
          </button>
          <button
            type="button"
            onClick={apply}
            className="h-9 rounded-md bg-indigo-600 px-4 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-40"
          >
            Apply
          </button>
        </>
      }
    >
      <p className="mb-3 text-sm text-neutral-600">Drag the box or its corners to choose what to show. Arrow keys move the box.</p>
      <div className="flex justify-center rounded-lg bg-neutral-100 p-4">
        <div ref={frameRef} data-testid="crop-frame" className="relative select-none" style={{ width: preview.width, height: preview.height, touchAction: "none" }}>
          <div className="absolute inset-0 overflow-hidden">
            {/* eslint-disable-next-line @next/next/no-img-element -- local data URL */}
            <img
              src={image.src}
              alt={image.alt}
              draggable={false}
              onLoad={(event) => setNatural({ width: event.currentTarget.naturalWidth || 1, height: event.currentTarget.naturalHeight || 1 })}
              style={{ display: "block", width: "100%", height: "100%" }}
            />
            {/* Dims everything outside the crop box. */}
            <div
              aria-hidden
              className="pointer-events-none absolute"
              style={{ left: pct(crop.x), top: pct(crop.y), width: pct(crop.width), height: pct(crop.height), boxShadow: "0 0 0 9999px rgba(0, 0, 0, 0.5)" }}
            />
          </div>
          <div
            role="group"
            aria-label="Crop area"
            tabIndex={0}
            data-testid="crop-box"
            data-crop={`${crop.x.toFixed(3)},${crop.y.toFixed(3)},${crop.width.toFixed(3)},${crop.height.toFixed(3)}`}
            onPointerDown={(event) => startDrag(event, "move")}
            onKeyDown={onKeyDown}
            className="absolute cursor-move outline-none focus-visible:ring-2 focus-visible:ring-indigo-400"
            style={{
              left: pct(crop.x),
              top: pct(crop.y),
              width: pct(crop.width),
              height: pct(crop.height),
              border: "2px solid #ffffff",
            }}
          >
            {HANDLES.map((handle) => (
              <div
                key={handle}
                data-crop-handle={handle}
                onPointerDown={(event) => startDrag(event, handle)}
                className="absolute h-3.5 w-3.5 rounded-sm border-2 border-indigo-600 bg-white"
                style={{
                  left: handle.includes("w") ? 0 : "100%",
                  top: handle.includes("n") ? 0 : "100%",
                  transform: "translate(-50%, -50%)",
                  cursor: handle === "nw" || handle === "se" ? "nwse-resize" : "nesw-resize",
                }}
              />
            ))}
          </div>
        </div>
      </div>
    </Modal>
  );
}
