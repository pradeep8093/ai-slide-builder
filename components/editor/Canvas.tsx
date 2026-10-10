"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Lock } from "lucide-react";
import { SLIDE_HEIGHT, SLIDE_WIDTH } from "@/lib/constants";
import {
  boundingRect,
  clampGroupDelta,
  containsRect,
  CORNER_HANDLES,
  mapRect,
  RESIZE_HANDLES,
  rectFromPoints,
  resizeRect,
  type Rect,
  type ResizeHandle,
} from "@/lib/geometry";
import type { ElementPatch, Slide, SlideElement, TextElement } from "@/lib/schema";
import { useChatStore } from "@/lib/store/chatStore";
import { expandToGroups, LOCKED_MESSAGE, selectCurrentSlide, useEditorStore } from "@/lib/store/editorStore";
import { toast } from "@/lib/store/toastStore";
import { useElementSize } from "../hooks/useElementSize";
import ElementView, { textStyle } from "../slide/ElementView";

export const CANVAS_PADDING = 32;
/** Pointer travel (screen px) before a press turns into a drag, so clicks don't nudge elements. */
export const DRAG_THRESHOLD = 3;
const ACCENT = "#6366f1";

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

const CHART_NAMES: Record<string, string> = { bar: "Bar", line: "Line", area: "Area", pie: "Pie", doughnut: "Doughnut", scatter: "Scatter" };

export function describeElement(element: SlideElement): string {
  const suffix = element.locked ? " (locked)" : "";
  switch (element.type) {
    case "text":
      return `Text: ${element.text.slice(0, 40) || "empty"}${suffix}`;
    case "shape":
      return `Shape: ${element.shape.replace("-", " ")}${suffix}`;
    case "image":
      return `Image${element.alt ? `: ${element.alt}` : ""}${suffix}`;
    case "chart":
      return `${CHART_NAMES[element.chartType] ?? "Chart"} chart${element.title ? `: ${element.title}` : ""}${suffix}`;
    case "table":
      return `Table: ${element.rows.length} × ${element.rows[0]?.length ?? 0}${suffix}`;
  }
}

/**
 * Ids selected by a marquee: an element counts when it lies fully inside the box;
 * a group counts only when all of its members do (then all of them are selected).
 */
export function idsInMarquee(slide: Slide, box: Rect): string[] {
  const units = new Map<string, SlideElement[]>();
  for (const element of slide.elements) {
    const key = element.groupId ? `g:${element.groupId}` : `e:${element.id}`;
    units.set(key, [...(units.get(key) ?? []), element]);
  }
  const ids: string[] = [];
  for (const members of units.values()) {
    const bounds = boundingRect(members);
    if (bounds && containsRect(box, bounds)) ids.push(...members.map((m) => m.id));
  }
  return ids;
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

const rectOf = (e: SlideElement): Rect => ({ x: e.x, y: e.y, width: e.width, height: e.height });

interface PointerStart {
  slideId: string;
  startX: number;
  startY: number;
  dragging: boolean;
}

type Interaction =
  | (PointerStart & {
      kind: "move";
      starts: Map<string, Rect>;
      locked: boolean;
      warned: boolean;
      /** A plain click (no drag) on one member of a larger selection narrows the selection to it. */
      collapseTo: string | null;
    })
  | (PointerStart & { kind: "resize"; elementId: string; handle: ResizeHandle; startRect: Rect; keepAspect: boolean })
  | (PointerStart & { kind: "group-resize"; handle: ResizeHandle; box: Rect; starts: Map<string, Rect> })
  | (PointerStart & { kind: "marquee"; originX: number; originY: number; stageLeft: number; stageTop: number; base: string[] });

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
    // An emptied text box disappears, like in PowerPoint (locked ones stay).
    if (current && current.type === "text" && !current.text.trim() && !current.locked) deleteElement(slideId, element.id);
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

function LockBadge({ scale }: { scale: number }) {
  return (
    <div
      data-testid="lock-badge"
      title="Locked"
      style={{
        position: "absolute",
        right: 0,
        top: 0,
        transform: "translate(50%, -50%)",
        width: 20 / scale,
        height: 20 / scale,
        borderRadius: 999,
        background: ACCENT,
        color: "#ffffff",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <Lock size={12 / scale} strokeWidth={2.5} aria-hidden />
    </div>
  );
}

function Handle({ handle, scale, onPointerDown }: { handle: ResizeHandle; scale: number; onPointerDown: (event: React.PointerEvent) => void }) {
  return (
    <div
      data-handle={handle}
      aria-label={`Resize ${handle}`}
      onPointerDown={onPointerDown}
      style={{
        ...handlePosition(handle),
        position: "absolute",
        width: 10 / scale,
        height: 10 / scale,
        transform: "translate(-50%, -50%)",
        background: "#ffffff",
        border: `${1.5 / scale}px solid ${ACCENT}`,
        borderRadius: 2 / scale,
        cursor: CURSORS[handle],
        pointerEvents: "auto",
        touchAction: "none",
      }}
    />
  );
}

interface CanvasProps {
  /** Opens the dedicated editor for an element (chart data, table cells, image crop). */
  onEditElement: (elementId: string) => void;
}

export default function Canvas({ onEditElement }: CanvasProps) {
  const slide = useEditorStore(selectCurrentSlide);
  const selectedElementIds = useEditorStore((s) => s.selectedElementIds);
  const editingElementId = useEditorStore((s) => s.editingElementId);
  const editingSelectAll = useEditorStore((s) => s.editingSelectAll);
  const aiHighlight = useEditorStore((s) => s.aiHighlight);
  const aiPending = useChatStore((s) => s.pending);
  const containerRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const interactionRef = useRef<Interaction | null>(null);
  const [marquee, setMarquee] = useState<Rect | null>(null);
  const size = useElementSize(containerRef);
  const scale = computeScale(size.width, size.height);
  const scaleRef = useRef(scale);
  useEffect(() => {
    scaleRef.current = scale;
  }, [scale]);

  useEffect(() => {
    const onMove = (event: PointerEvent) => {
      const action = interactionRef.current;
      if (!action) return;
      const screenDx = event.clientX - action.startX;
      const screenDy = event.clientY - action.startY;
      if (!action.dragging && Math.hypot(screenDx, screenDy) < DRAG_THRESHOLD) return;
      action.dragging = true;
      const dx = screenDx / scaleRef.current;
      const dy = screenDy / scaleRef.current;
      const store = useEditorStore.getState();

      if (action.kind === "move") {
        if (action.locked) {
          if (!action.warned) toast.info(LOCKED_MESSAGE);
          action.warned = true;
          return;
        }
        const delta = clampGroupDelta([...action.starts.values()], dx, dy);
        const patches: Record<string, ElementPatch> = {};
        for (const [id, start] of action.starts) patches[id] = { x: start.x + delta.dx, y: start.y + delta.dy };
        store.updateElementsLive(action.slideId, patches);
      } else if (action.kind === "resize") {
        const rect = resizeRect(action.startRect, action.handle, dx, dy, action.keepAspect || event.shiftKey);
        store.updateElementLive(action.slideId, action.elementId, rect);
      } else if (action.kind === "group-resize") {
        // Several elements always scale uniformly so nothing inside the selection gets distorted.
        const box = resizeRect(action.box, action.handle, dx, dy, true);
        const patches: Record<string, ElementPatch> = {};
        for (const [id, start] of action.starts) patches[id] = mapRect(start, action.box, box);
        store.updateElementsLive(action.slideId, patches);
      } else {
        const x = (event.clientX - action.stageLeft) / scaleRef.current;
        const y = (event.clientY - action.stageTop) / scaleRef.current;
        const box = rectFromPoints(action.originX, action.originY, x, y);
        setMarquee(box);
        const current = store.deck.slides.find((s) => s.id === action.slideId);
        if (current) store.selectElements([...action.base, ...idsInMarquee(current, box)]);
      }
    };
    const onUp = () => {
      const action = interactionRef.current;
      if (!action) return;
      interactionRef.current = null;
      const store = useEditorStore.getState();
      if (action.kind === "marquee") {
        setMarquee(null);
        return;
      }
      store.endGesture();
      if (action.kind === "move" && !action.dragging && action.collapseTo) store.selectElement(action.collapseTo);
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
  const selectedSet = new Set(selectedElementIds);
  const selected = slide.elements.filter((e) => selectedSet.has(e.id));
  const single = selected.length === 1 ? selected[0] : null;
  const bounds = selected.length > 1 ? boundingRect(selected.map(rectOf)) : null;
  const anyLocked = selected.some((e) => e.locked);
  const highlighted = aiHighlight ? slide.elements.filter((e) => aiHighlight.elementIds.includes(e.id)) : [];
  const slideHighlighted = Boolean(aiHighlight?.slideIds.includes(slide.id)) && highlighted.length === 0;

  const blurEditor = (exceptId?: string) => {
    const state = useEditorStore.getState();
    if (state.editingElementId && state.editingElementId !== exceptId) (document.activeElement as HTMLElement | null)?.blur?.();
  };

  const pointerStart = (event: React.PointerEvent): PointerStart => ({ slideId: slide.id, startX: event.clientX, startY: event.clientY, dragging: false });

  const startMove = (event: React.PointerEvent, element: SlideElement) => {
    if (event.button !== 0) return;
    event.stopPropagation();
    blurEditor(element.id);
    stageRef.current?.focus({ preventScroll: true });
    const state = useEditorStore.getState();
    if (event.shiftKey || event.metaKey || event.ctrlKey) {
      state.toggleElementSelection(element.id);
      return;
    }
    let collapseTo: string | null = null;
    if (state.selectedElementIds.includes(element.id)) {
      const own = expandToGroups(slide, [element.id]);
      if (state.selectedElementIds.length > own.length) collapseTo = element.id;
    } else {
      state.selectElement(element.id);
    }
    const ids = new Set(useEditorStore.getState().selectedElementIds);
    const members = slide.elements.filter((e) => ids.has(e.id));
    const locked = members.some((e) => e.locked);
    if (!locked) state.beginGesture();
    interactionRef.current = {
      ...pointerStart(event),
      kind: "move",
      starts: new Map(members.map((e) => [e.id, rectOf(e)])),
      locked,
      warned: false,
      collapseTo,
    };
  };

  const startResize = (event: React.PointerEvent, element: SlideElement, handle: ResizeHandle) => {
    if (event.button !== 0) return;
    event.stopPropagation();
    stageRef.current?.focus({ preventScroll: true });
    useEditorStore.getState().beginGesture();
    interactionRef.current = { ...pointerStart(event), kind: "resize", elementId: element.id, handle, startRect: rectOf(element), keepAspect: element.type === "image" };
  };

  const startGroupResize = (event: React.PointerEvent, box: Rect, handle: ResizeHandle) => {
    if (event.button !== 0) return;
    event.stopPropagation();
    stageRef.current?.focus({ preventScroll: true });
    useEditorStore.getState().beginGesture();
    interactionRef.current = { ...pointerStart(event), kind: "group-resize", handle, box, starts: new Map(selected.map((e) => [e.id, rectOf(e)])) };
  };

  const startMarquee = (event: React.PointerEvent) => {
    if (event.button !== 0) return;
    const target = event.target as HTMLElement;
    if (target.closest("[data-element-id], [data-handle]")) return;
    blurEditor();
    stageRef.current?.focus({ preventScroll: true });
    const state = useEditorStore.getState();
    const additive = event.shiftKey || event.metaKey || event.ctrlKey;
    const base = additive ? state.selectedElementIds : [];
    if (!additive) state.selectElement(null);
    const stage = stageRef.current?.getBoundingClientRect();
    const stageLeft = stage?.left ?? 0;
    const stageTop = stage?.top ?? 0;
    interactionRef.current = {
      ...pointerStart(event),
      kind: "marquee",
      stageLeft,
      stageTop,
      originX: (event.clientX - stageLeft) / scale,
      originY: (event.clientY - stageTop) / scale,
      base,
    };
  };

  const onDoubleClick = (element: SlideElement) => {
    const state = useEditorStore.getState();
    if (element.type === "text") state.setEditing(element.id);
    else if (element.type === "image" && element.locked) toast.info("Unlock the image to crop it.");
    else if (element.type === "chart" || element.type === "table" || element.type === "image") {
      state.selectElement(element.id);
      onEditElement(element.id);
    }
  };

  const outline = (rect: Rect, key: string, testId: string, style: React.CSSProperties = {}, children?: React.ReactNode) => (
    <div
      key={key}
      data-testid={testId}
      style={{ position: "absolute", left: rect.x, top: rect.y, width: rect.width, height: rect.height, pointerEvents: "none", ...style }}
    >
      {children}
    </div>
  );

  return (
    <div ref={containerRef} className="absolute inset-0 flex items-center justify-center overflow-hidden" onPointerDown={startMarquee}>
      <div style={{ position: "relative", width: SLIDE_WIDTH * scale, height: SLIDE_HEIGHT * scale }}>
        {aiPending && (
          <div
            role="status"
            className="ai-pending-label pointer-events-none absolute left-1/2 -translate-x-1/2 rounded-full bg-indigo-600 px-3 py-1 text-xs font-medium text-white shadow"
            style={{ top: -28 }}
          >
            AI is editing…
          </div>
        )}
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
                  onPointerDown={editing ? undefined : (event) => startMove(event, element)}
                  onDoubleClick={() => onDoubleClick(element)}
                  style={{
                    position: "absolute",
                    left: element.x,
                    top: element.y,
                    width: element.width,
                    height: element.height,
                    cursor: editing ? "text" : element.locked ? "default" : "move",
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

          {aiPending && (
            <div
              data-testid="ai-pending"
              className="ai-pending"
              style={{ position: "absolute", inset: 0, outline: `${3 / scale}px dashed ${ACCENT}`, outlineOffset: 4 / scale, pointerEvents: "none" }}
            />
          )}
          {aiHighlight &&
            highlighted.map((element) => (
              // Keyed by the change token so the flash replays after every AI edit.
              <div
                key={`${aiHighlight.token}:${element.id}`}
                data-testid="ai-highlight"
                className="ai-flash"
                style={{
                  position: "absolute",
                  left: element.x,
                  top: element.y,
                  width: element.width,
                  height: element.height,
                  outline: `${3 / scale}px solid ${ACCENT}`,
                  pointerEvents: "none",
                }}
              />
            ))}
          {aiHighlight && slideHighlighted && (
            <div
              key={aiHighlight.token}
              data-testid="ai-highlight"
              className="ai-flash"
              style={{ position: "absolute", inset: 0, outline: `${3 / scale}px solid ${ACCENT}`, pointerEvents: "none" }}
            />
          )}

          {single &&
            outline(
              rectOf(single),
              single.id,
              "selection-box",
              { outline: `${2 / scale}px solid ${ACCENT}` },
              <>
                {!single.locked && editingElementId !== single.id && handlesFor(single).map((h) => <Handle key={h} handle={h} scale={scale} onPointerDown={(event) => startResize(event, single, h)} />)}
                {single.locked && <LockBadge scale={scale} />}
              </>,
            )}

          {bounds && (
            <>
              {selected.map((element) => outline(rectOf(element), element.id, "selection-outline", { outline: `${1 / scale}px solid ${ACCENT}` }))}
              {outline(
                bounds,
                "bounds",
                "selection-bounds",
                { outline: `${1.5 / scale}px dashed ${ACCENT}`, outlineOffset: 3 / scale },
                <>
                  {!anyLocked && CORNER_HANDLES.map((h) => <Handle key={h} handle={h} scale={scale} onPointerDown={(event) => startGroupResize(event, bounds, h)} />)}
                  {anyLocked && <LockBadge scale={scale} />}
                </>,
              )}
            </>
          )}

          {marquee &&
            outline(marquee, "marquee", "marquee", {
              background: "rgba(99, 102, 241, 0.08)",
              border: `${1 / scale}px solid ${ACCENT}`,
            })}
        </div>
      </div>
    </div>
  );
}
