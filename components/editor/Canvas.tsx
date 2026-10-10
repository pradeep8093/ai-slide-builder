"use client";

import { useEffect, useLayoutEffect, useRef } from "react";
import { SLIDE_HEIGHT, SLIDE_WIDTH } from "@/lib/constants";
import { CORNER_HANDLES, moveRect, RESIZE_HANDLES, resizeRect, type Rect, type ResizeHandle } from "@/lib/geometry";
import type { SlideElement, TextElement } from "@/lib/schema";
import { selectCurrentSlide, useEditorStore } from "@/lib/store/editorStore";
import { useElementSize } from "../hooks/useElementSize";
import ElementView, { textStyle } from "../slide/ElementView";

export const CANVAS_PADDING = 32;
/** Pointer travel (screen px) before a press turns into a drag, so clicks don't nudge elements. */
export const DRAG_THRESHOLD = 3;

export function computeScale(width: number, height: number): number {
  if (width <= 0 || height <= 0) return 0.5;
  const scale = Math.min((width - CANVAS_PADDING * 2) / SLIDE_WIDTH, (height - CANVAS_PADDING * 2) / SLIDE_HEIGHT);
  return Math.max(0.1, scale);
}

export function handlesFor(element: SlideElement): ResizeHandle[] {
  if (element.type === "shape" && element.shape === "line") return ["w", "e"];
  if (element.type === "image") return CORNER_HANDLES;
  return RESIZE_HANDLES;
}

export function describeElement(element: SlideElement): string {
  switch (element.type) {
    case "text":
      return `Text: ${element.text.slice(0, 40) || "empty"}`;
    case "shape":
      return `Shape: ${element.shape.replace("-", " ")}`;
    case "image":
      return `Image${element.alt ? `: ${element.alt}` : ""}`;
    case "chart":
      return `${element.chartType[0].toUpperCase()}${element.chartType.slice(1)} chart${element.title ? `: ${element.title}` : ""}`;
  }
}

const CURSORS: Record<ResizeHandle, string> = {
  n: "ns-resize",
  s: "ns-resize",
  e: "ew-resize",
  w: "ew-resize",
  ne: "nesw-resize",
  sw: "nesw-resize",
  nw: "nwse-resize",
  se: "nwse-resize",
};

function handlePosition(handle: ResizeHandle): React.CSSProperties {
  const x = handle.includes("w") ? "0%" : handle.includes("e") ? "100%" : "50%";
  const y = handle.includes("n") ? "0%" : handle.includes("s") ? "100%" : "50%";
  return { left: x, top: y };
}

interface DragState {
  mode: "move" | "resize";
  handle?: ResizeHandle;
  slideId: string;
  elementId: string;
  startX: number;
  startY: number;
  startRect: Rect;
  keepAspect: boolean;
  dragging: boolean;
}

function TextEditor({ element, slideId, selectAll }: { element: TextElement; slideId: string; selectAll: boolean }) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const { updateElementLive, beginGesture, endGesture, deleteElement, setEditing } = useEditorStore.getState();

  const grow = () => {
    const textarea = ref.current;
    if (!textarea) return;
    textarea.style.height = "auto";
    const needed = Math.ceil(textarea.scrollHeight);
    textarea.style.height = "100%";
    const current = useEditorStore.getState().deck.slides.find((s) => s.id === slideId)?.elements.find((e) => e.id === element.id);
    if (current && needed > current.height) updateElementLive(slideId, element.id, { height: needed });
  };

  useLayoutEffect(() => {
    const textarea = ref.current;
    if (!textarea) return;
    beginGesture();
    textarea.focus({ preventScroll: true });
    if (selectAll) textarea.select();
    else textarea.setSelectionRange(textarea.value.length, textarea.value.length);
    // Only on mount: the editor owns the text while it's open.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const finish = () => {
    const state = useEditorStore.getState();
    const current = state.deck.slides.find((s) => s.id === slideId)?.elements.find((e) => e.id === element.id);
    endGesture();
    if (current && current.type === "text" && !current.text.trim()) deleteElement(slideId, element.id);
    if (useEditorStore.getState().editingElementId === element.id) setEditing(null);
  };

  return (
    <textarea
      ref={ref}
      aria-label="Edit text"
      value={element.text}
      onChange={(event) => {
        updateElementLive(slideId, element.id, { text: event.target.value });
        grow();
      }}
      onBlur={finish}
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.preventDefault();
          event.currentTarget.blur();
        }
      }}
      onPointerDown={(event) => event.stopPropagation()}
      spellCheck
      style={{
        ...textStyle(element),
        display: "block",
        width: "100%",
        height: "100%",
        resize: "none",
        border: "none",
        outline: "none",
        background: "transparent",
        overflow: "hidden",
      }}
    />
  );
}

interface CanvasProps {
  onEditChartData: (elementId: string) => void;
}

export default function Canvas({ onEditChartData }: CanvasProps) {
  const slide = useEditorStore(selectCurrentSlide);
  const selectedElementId = useEditorStore((s) => s.selectedElementId);
  const editingElementId = useEditorStore((s) => s.editingElementId);
  const editingSelectAll = useEditorStore((s) => s.editingSelectAll);
  const containerRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<DragState | null>(null);
  const size = useElementSize(containerRef);
  const scale = computeScale(size.width, size.height);
  const scaleRef = useRef(scale);
  useEffect(() => {
    scaleRef.current = scale;
  }, [scale]);

  useEffect(() => {
    const onMove = (event: PointerEvent) => {
      const drag = dragRef.current;
      if (!drag) return;
      const screenDx = event.clientX - drag.startX;
      const screenDy = event.clientY - drag.startY;
      if (!drag.dragging && Math.hypot(screenDx, screenDy) < DRAG_THRESHOLD) return;
      drag.dragging = true;
      const dx = screenDx / scaleRef.current;
      const dy = screenDy / scaleRef.current;
      const rect =
        drag.mode === "move"
          ? moveRect(drag.startRect, dx, dy)
          : resizeRect(drag.startRect, drag.handle as ResizeHandle, dx, dy, drag.keepAspect || event.shiftKey);
      useEditorStore.getState().updateElementLive(drag.slideId, drag.elementId, rect);
    };
    const onUp = () => {
      if (!dragRef.current) return;
      dragRef.current = null;
      useEditorStore.getState().endGesture();
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

  if (!slide) return null;
  const selected = slide.elements.find((e) => e.id === selectedElementId) ?? null;

  const startDrag = (event: React.PointerEvent, element: SlideElement, mode: DragState["mode"], handle?: ResizeHandle) => {
    if (event.button !== 0) return;
    event.stopPropagation();
    const state = useEditorStore.getState();
    if (state.editingElementId && state.editingElementId !== element.id) {
      (document.activeElement as HTMLElement | null)?.blur?.();
    }
    stageRef.current?.focus({ preventScroll: true });
    state.selectElement(element.id);
    state.beginGesture();
    dragRef.current = {
      mode,
      handle,
      slideId: slide.id,
      elementId: element.id,
      startX: event.clientX,
      startY: event.clientY,
      startRect: { x: element.x, y: element.y, width: element.width, height: element.height },
      keepAspect: element.type === "image",
      dragging: false,
    };
  };

  return (
    <div
      ref={containerRef}
      className="absolute inset-0 flex items-center justify-center overflow-hidden"
      onPointerDown={(event) => {
        const target = event.target as HTMLElement;
        if (target.closest("[data-element-id], [data-handle]")) return;
        if (useEditorStore.getState().editingElementId) (document.activeElement as HTMLElement | null)?.blur?.();
        useEditorStore.getState().selectElement(null);
        stageRef.current?.focus({ preventScroll: true });
      }}
    >
      <div style={{ position: "relative", width: SLIDE_WIDTH * scale, height: SLIDE_HEIGHT * scale }}>
        <div
          ref={stageRef}
          tabIndex={-1}
          aria-label="Slide canvas"
          data-testid="slide-canvas"
          className="outline-none"
          style={{ position: "absolute", left: 0, top: 0, width: SLIDE_WIDTH, height: SLIDE_HEIGHT, transform: `scale(${scale})`, transformOrigin: "top left" }}
        >
          <div
            style={{
              position: "relative",
              width: SLIDE_WIDTH,
              height: SLIDE_HEIGHT,
              background: slide.background,
              overflow: "hidden",
              boxShadow: "0 1px 3px rgba(0,0,0,0.12), 0 8px 24px rgba(0,0,0,0.08)",
            }}
          >
            {slide.elements.map((element) => {
              const editing = element.id === editingElementId && element.type === "text";
              return (
                <div
                  key={element.id}
                  data-element-id={element.id}
                  aria-label={describeElement(element)}
                  onPointerDown={editing ? undefined : (event) => startDrag(event, element, "move")}
                  onDoubleClick={() => {
                    if (element.type === "text") useEditorStore.getState().setEditing(element.id);
                    else if (element.type === "chart") onEditChartData(element.id);
                  }}
                  style={{
                    position: "absolute",
                    left: element.x,
                    top: element.y,
                    width: element.width,
                    height: element.height,
                    cursor: editing ? "text" : "move",
                    touchAction: "none",
                  }}
                >
                  {editing ? (
                    <TextEditor element={element as TextElement} slideId={slide.id} selectAll={editingSelectAll} />
                  ) : (
                    <ElementView element={element} background={slide.background} />
                  )}
                </div>
              );
            })}
          </div>

          {selected && (
            <div
              data-testid="selection-box"
              style={{
                position: "absolute",
                left: selected.x,
                top: selected.y,
                width: selected.width,
                height: selected.height,
                outline: `${2 / scale}px solid #6366f1`,
                pointerEvents: "none",
              }}
            >
              {editingElementId !== selected.id &&
                handlesFor(selected).map((handle) => (
                  <div
                    key={handle}
                    data-handle={handle}
                    aria-label={`Resize ${handle}`}
                    onPointerDown={(event) => startDrag(event, selected, "resize", handle)}
                    style={{
                      ...handlePosition(handle),
                      position: "absolute",
                      width: 10 / scale,
                      height: 10 / scale,
                      transform: "translate(-50%, -50%)",
                      background: "#ffffff",
                      border: `${1.5 / scale}px solid #6366f1`,
                      borderRadius: 2 / scale,
                      cursor: CURSORS[handle],
                      pointerEvents: "auto",
                      touchAction: "none",
                    }}
                  />
                ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
