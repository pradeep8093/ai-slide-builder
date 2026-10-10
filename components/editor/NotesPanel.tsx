"use client";

import { useState } from "react";
import { ChevronDown, ChevronUp } from "lucide-react";
import { MAX_NOTES_LENGTH } from "@/lib/constants";
import { selectCurrentSlide, useEditorStore } from "@/lib/store/editorStore";

/** Speaker notes for the current slide, under the canvas. Shown below the slide when presenting. */
export default function NotesPanel() {
  const slide = useEditorStore(selectCurrentSlide);
  const [open, setOpen] = useState(true);
  if (!slide) return null;
  const remaining = MAX_NOTES_LENGTH - slide.notes.length;

  return (
    <section data-testid="notes-panel" className="shrink-0 border-t border-neutral-200 bg-white">
      <div className="flex h-9 items-center gap-2 px-4">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          className="inline-flex items-center gap-1 text-xs font-semibold uppercase tracking-wide text-neutral-500 hover:text-neutral-800"
        >
          {open ? <ChevronDown size={14} aria-hidden /> : <ChevronUp size={14} aria-hidden />}
          Speaker notes
        </button>
        {!open && slide.notes.trim() && <span className="truncate text-xs text-neutral-400">{slide.notes.trim().split("\n")[0]}</span>}
        {open && remaining < 500 && <span className="ml-auto text-xs tabular-nums text-neutral-400">{remaining} characters left</span>}
      </div>
      {open && (
        <textarea
          aria-label="Speaker notes"
          value={slide.notes}
          maxLength={MAX_NOTES_LENGTH}
          placeholder="Add notes for the presenter…"
          onChange={(event) => useEditorStore.getState().setSlideNotes(slide.id, event.target.value)}
          className="block h-24 w-full resize-none border-0 px-4 pb-3 text-sm leading-6 text-neutral-800 placeholder:text-neutral-400 focus:outline-none"
        />
      )}
    </section>
  );
}
