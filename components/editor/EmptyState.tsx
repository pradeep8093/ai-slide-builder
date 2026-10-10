"use client";

import { LayoutTemplate, Plus, Sparkles } from "lucide-react";

interface EmptyStateProps {
  onAddSlide: () => void;
  onBrowseTemplates: () => void;
}

/** Shown in the preview area when the deck has no slides. */
export default function EmptyState({ onAddSlide, onBrowseTemplates }: EmptyStateProps) {
  return (
    <div className="absolute inset-0 flex items-center justify-center p-8">
      <div className="w-full max-w-md rounded-2xl border border-neutral-200 bg-white p-8 text-center shadow-sm">
        <h2 className="text-lg font-semibold text-neutral-900">Start your presentation</h2>
        <p className="mt-2 text-sm leading-6 text-neutral-500">Add a blank slide or start from a template.</p>
        <div className="mt-6 flex justify-center gap-3">
          <button
            type="button"
            onClick={onAddSlide}
            className="inline-flex h-10 items-center gap-2 rounded-lg bg-indigo-600 px-4 text-sm font-medium text-white hover:bg-indigo-700"
          >
            <Plus size={16} aria-hidden />
            Add slide
          </button>
          <button
            type="button"
            onClick={onBrowseTemplates}
            className="inline-flex h-10 items-center gap-2 rounded-lg border border-neutral-200 px-4 text-sm font-medium text-neutral-700 hover:bg-neutral-50"
          >
            <LayoutTemplate size={16} aria-hidden />
            Browse templates
          </button>
        </div>
        <p className="mt-6 flex items-center justify-center gap-1.5 text-xs text-neutral-400">
          <Sparkles size={13} aria-hidden />
          Or ask the AI assistant to draft slides for you.
        </p>
      </div>
    </div>
  );
}
