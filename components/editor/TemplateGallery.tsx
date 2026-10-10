"use client";

import { useMemo, useState } from "react";
import { getTemplates, type Template } from "@/lib/templates";
import { useEditorStore } from "@/lib/store/editorStore";
import { toast } from "@/lib/store/toastStore";
import FitSlide from "../slide/FitSlide";
import Modal from "../ui/Modal";

interface TemplateGalleryProps {
  onClose: () => void;
}

export default function TemplateGallery({ onClose }: TemplateGalleryProps) {
  const templates = useMemo(() => getTemplates(), []);
  const slideCount = useEditorStore((s) => s.deck.slides.length);
  const [pending, setPending] = useState<Template | null>(null);

  const apply = (template: Template) => {
    useEditorStore.getState().applyTemplate(template);
    toast.success(`Applied the “${template.name}” template.`);
    onClose();
  };

  const choose = (template: Template) => {
    if (slideCount > 0) setPending(template);
    else apply(template);
  };

  if (pending) {
    return (
      <Modal
        title="Replace your slides?"
        onClose={() => setPending(null)}
        width={460}
        footer={
          <>
            <button type="button" onClick={() => setPending(null)} className="h-9 rounded-md border border-neutral-200 px-4 text-sm font-medium text-neutral-700 hover:bg-neutral-50">
              Cancel
            </button>
            <button type="button" data-autofocus onClick={() => apply(pending)} className="h-9 rounded-md bg-indigo-600 px-4 text-sm font-medium text-white hover:bg-indigo-700">
              Replace slides
            </button>
          </>
        }
      >
        <p className="text-sm leading-6 text-neutral-600">
          The “{pending.name}” template will replace your {slideCount === 1 ? "slide" : `${slideCount} slides`} and the presentation title. You can undo this.
        </p>
      </Modal>
    );
  }

  return (
    <Modal title="Templates" onClose={onClose} width={680}>
      <ul className="grid grid-cols-2 gap-4" aria-label="Templates">
        {templates.map((template) => (
          <li key={template.id}>
            <button
              type="button"
              onClick={() => choose(template)}
              className="group w-full rounded-xl border border-neutral-200 p-2 text-left hover:border-indigo-400 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500/40"
              aria-label={`${template.name} template, ${template.slides.length} slides`}
            >
              <div className="overflow-hidden rounded-lg border border-neutral-100">
                <FitSlide slide={template.slides[0]} />
              </div>
              <div className="px-1 pb-1 pt-2.5">
                <div className="flex items-baseline justify-between gap-2">
                  <span className="text-sm font-semibold text-neutral-900">{template.name}</span>
                  <span className="text-xs text-neutral-400">{template.slides.length} slides</span>
                </div>
                <p className="mt-0.5 text-xs leading-5 text-neutral-500">{template.description}</p>
              </div>
            </button>
          </li>
        ))}
      </ul>
    </Modal>
  );
}
