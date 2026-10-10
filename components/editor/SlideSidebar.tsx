"use client";

import { useEffect } from "react";
import { closestCenter, DndContext, PointerSensor, useSensor, useSensors, type DragEndEvent } from "@dnd-kit/core";
import { SortableContext, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { ArrowDown, ArrowUp, Copy, MoreHorizontal, Plus, Trash2 } from "lucide-react";
import type { Slide } from "@/lib/schema";
import { useEditorStore } from "@/lib/store/editorStore";
import ScaledSlide from "../slide/ScaledSlide";
import MenuButton from "../ui/MenuButton";

export const THUMBNAIL_WIDTH = 168;

/** Escapes a value for use inside a double-quoted attribute selector. */
function attr(value: string) {
  return value.replace(/["\\]/g, "\\$&");
}

/** Focuses a slide's thumbnail; `deferred` waits a frame for the list to re-render (after deletes). */
function focusThumbnail(slideId: string | null, deferred = false) {
  if (!slideId) return;
  const focus = () => document.querySelector<HTMLButtonElement>(`[data-slide-thumb="${attr(slideId)}"]`)?.focus();
  if (deferred) requestAnimationFrame(focus);
  else focus();
}

interface ThumbnailProps {
  slide: Slide;
  index: number;
  count: number;
  selected: boolean;
}

function SlideThumbnail({ slide, index, count, selected }: ThumbnailProps) {
  const { listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: slide.id });
  const { selectSlide, duplicateSlide, deleteSlide, moveSlide } = useEditorStore.getState();
  const number = index + 1;

  const onKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>) => {
    const slides = useEditorStore.getState().deck.slides;
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const target = slides[index + (event.key === "ArrowDown" ? 1 : -1)];
      if (target) {
        selectSlide(target.id);
        focusThumbnail(target.id);
      }
    } else if (event.key === "Delete" || event.key === "Backspace") {
      event.preventDefault();
      deleteSlide(slide.id);
      focusThumbnail(useEditorStore.getState().selectedSlideId, true);
    }
  };

  return (
    <li
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition, zIndex: isDragging ? 10 : undefined }}
      className={`group relative flex gap-2 ${isDragging ? "opacity-80" : ""}`}
    >
      <span className={`w-5 pt-1 text-right text-xs tabular-nums ${selected ? "font-semibold text-indigo-600" : "text-neutral-400"}`} aria-hidden>
        {number}
      </span>
      <div className="relative min-w-0 flex-1">
        <button
          type="button"
          {...listeners}
          data-slide-thumb={slide.id}
          aria-label={`Slide ${number} of ${count}`}
          aria-current={selected ? "true" : undefined}
          onClick={() => selectSlide(slide.id)}
          onKeyDown={onKeyDown}
          className={`block w-full overflow-hidden rounded-md border-2 bg-white outline-none transition-colors focus-visible:ring-2 focus-visible:ring-indigo-500/40 ${
            selected ? "border-indigo-500" : "border-neutral-200 hover:border-neutral-300"
          }`}
        >
          <ScaledSlide slide={slide} width={THUMBNAIL_WIDTH} />
        </button>
        <div className="absolute right-1 top-1 opacity-0 transition-opacity focus-within:opacity-100 group-hover:opacity-100">
          <MenuButton
            label={`Slide ${number} actions`}
            className="flex h-6 w-6 items-center justify-center rounded bg-white/95 text-neutral-600 shadow-sm ring-1 ring-black/5 hover:text-neutral-900"
            items={[
              { id: "duplicate", label: "Duplicate", icon: <Copy size={14} />, onSelect: () => duplicateSlide(slide.id) },
              { id: "up", label: "Move up", icon: <ArrowUp size={14} />, disabled: index === 0, onSelect: () => moveSlide(slide.id, index - 1) },
              { id: "down", label: "Move down", icon: <ArrowDown size={14} />, disabled: index === count - 1, onSelect: () => moveSlide(slide.id, index + 1) },
              { id: "delete", label: "Delete", icon: <Trash2 size={14} />, danger: true, onSelect: () => deleteSlide(slide.id) },
            ]}
          >
            <MoreHorizontal size={14} aria-hidden />
          </MenuButton>
        </div>
      </div>
    </li>
  );
}

/** Moves the dragged slide to the position of the slide it was dropped on. */
export function applyDragEnd(
  slides: Slide[],
  { active, over }: Pick<DragEndEvent, "active" | "over">,
  moveSlide: (slideId: string, toIndex: number) => void,
) {
  if (!over || active.id === over.id) return;
  const to = slides.findIndex((s) => s.id === over.id);
  if (to !== -1) moveSlide(String(active.id), to);
}

export default function SlideSidebar() {
  const slides = useEditorStore((s) => s.deck.slides);
  const selectedSlideId = useEditorStore((s) => s.selectedSlideId);
  const { addSlide, moveSlide } = useEditorStore.getState();
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));

  useEffect(() => {
    if (!selectedSlideId) return;
    const node = document.querySelector<HTMLElement>(`[data-slide-thumb="${attr(selectedSlideId)}"]`);
    node?.scrollIntoView?.({ block: "nearest" });
  }, [selectedSlideId]);

  const onDragEnd = (event: DragEndEvent) => applyDragEnd(slides, event, moveSlide);

  return (
    <aside aria-label="Slides" className="flex w-56 shrink-0 flex-col border-r border-neutral-200 bg-white">
      <div className="flex h-10 shrink-0 items-center justify-between px-4 text-xs font-semibold uppercase tracking-wide text-neutral-500">
        <span>Slides</span>
        <span className="tabular-nums">{slides.length}</span>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-3">
        {slides.length === 0 ? (
          <p className="px-2 py-6 text-center text-sm text-neutral-400">No slides yet</p>
        ) : (
          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
            <SortableContext items={slides.map((s) => s.id)} strategy={verticalListSortingStrategy}>
              <ol className="space-y-3 pt-1">
                {slides.map((slide, index) => (
                  <SlideThumbnail key={slide.id} slide={slide} index={index} count={slides.length} selected={slide.id === selectedSlideId} />
                ))}
              </ol>
            </SortableContext>
          </DndContext>
        )}
      </div>
      <div className="shrink-0 border-t border-neutral-200 p-3">
        <button
          type="button"
          onClick={() => addSlide()}
          className="flex h-9 w-full items-center justify-center gap-1.5 rounded-md border border-dashed border-neutral-300 text-sm font-medium text-neutral-600 hover:border-indigo-400 hover:bg-indigo-50 hover:text-indigo-700"
        >
          <Plus size={16} aria-hidden />
          New slide
        </button>
      </div>
    </aside>
  );
}
