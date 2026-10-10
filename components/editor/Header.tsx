"use client";

import { useState } from "react";
import { ChevronDown, Copy, Download, FileCode2, FileText, LayoutGrid, LayoutTemplate, MoreHorizontal, Play, Plus, Presentation, Redo2, Trash2, Undo2 } from "lucide-react";
import { MAX_TITLE_LENGTH } from "@/lib/constants";
import { downloadBlob, exportHtml } from "@/lib/export/html";
import { exportPdf } from "@/lib/export/pdf";
import { exportPptx } from "@/lib/export/pptx";
import { shortcutLabel } from "@/lib/platform";
import { useEditorStore, type SaveStatus } from "@/lib/store/editorStore";
import { toast } from "@/lib/store/toastStore";
import MenuButton from "../ui/MenuButton";
import { captureSlideImage, captureSlideMarkup } from "../export/captureSlide";

interface HeaderProps {
  onOpenTemplates: () => void;
  onPresent: () => void;
  /** Back to the list of presentations. */
  onHome: () => void;
  onNewDeck: () => void;
  onDuplicateDeck: () => void;
  onDeleteDeck: () => void;
}

type ExportKind = "pdf" | "pptx" | "html";
const EXPORT_LABELS: Record<ExportKind, string> = { pdf: "Exporting PDF…", pptx: "Exporting PowerPoint…", html: "Exporting web page…" };

const SAVE_LABELS: Record<SaveStatus, string> = {
  idle: "",
  saving: "Saving…",
  saved: "Saved",
  error: "Not saved",
  unavailable: "Can't save in this browser",
};

const buttonClass =
  "inline-flex h-8 items-center gap-1.5 rounded-md px-2.5 text-sm font-medium text-neutral-700 hover:bg-neutral-100 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent";
const iconButtonClass =
  "inline-flex h-8 w-8 items-center justify-center rounded-md text-neutral-700 hover:bg-neutral-100 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent";

export default function Header({ onOpenTemplates, onPresent, onHome, onNewDeck, onDuplicateDeck, onDeleteDeck }: HeaderProps) {
  const title = useEditorStore((s) => s.deck.title);
  const slideCount = useEditorStore((s) => s.deck.slides.length);
  const canUndo = useEditorStore((s) => s.past.length > 0 || (s.gestureBase !== null && s.gestureBase !== s.deck));
  const canRedo = useEditorStore((s) => s.future.length > 0);
  const saveStatus = useEditorStore((s) => s.saveStatus);
  const { setTitle, undo, redo } = useEditorStore.getState();
  const [exporting, setExporting] = useState<string | null>(null);

  const runExport = async (kind: ExportKind) => {
    const deck = useEditorStore.getState().deck;
    if (deck.slides.length === 0 || exporting) return;
    setExporting(EXPORT_LABELS[kind]);
    try {
      const fileName =
        kind === "pdf"
          ? await exportPdf(deck, {
              captureSlide: captureSlideImage,
              onProgress: (done, total) => setExporting(`Exporting PDF ${Math.min(done + 1, total)}/${total}…`),
            })
          : kind === "pptx"
            ? await exportPptx(deck)
            : await exportHtml(deck, { renderSlide: captureSlideMarkup, download: downloadBlob });
      toast.success(`Exported ${fileName}`);
    } catch (error) {
      console.error(error);
      toast.error(`Export failed: ${error instanceof Error ? error.message : "unknown error"}`);
    } finally {
      setExporting(null);
    }
  };

  return (
    <header className="flex h-14 shrink-0 items-center gap-2 border-b border-neutral-200 bg-white px-4">
      <button
        type="button"
        onClick={onHome}
        aria-label="All presentations"
        title="All presentations"
        className="flex h-8 w-8 items-center justify-center rounded-lg bg-indigo-600 text-white hover:bg-indigo-700"
      >
        <LayoutGrid size={17} aria-hidden />
      </button>
      <input
        type="text"
        aria-label="Presentation title"
        placeholder="Untitled presentation"
        value={title}
        maxLength={MAX_TITLE_LENGTH}
        onChange={(event) => setTitle(event.target.value)}
        onBlur={(event) => {
          const trimmed = event.target.value.trim();
          if (trimmed !== event.target.value) setTitle(trimmed);
        }}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === "Escape") event.currentTarget.blur();
        }}
        className="h-9 w-80 min-w-0 rounded-md border border-transparent px-2 text-[15px] font-medium text-neutral-900 placeholder:text-neutral-400 hover:border-neutral-200 focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
      />
      <span
        className={`text-xs ${saveStatus === "error" || saveStatus === "unavailable" ? "text-red-600" : "text-neutral-400"}`}
        role="status"
        aria-live="polite"
        data-testid="save-status"
      >
        {SAVE_LABELS[saveStatus]}
      </span>
      <MenuButton
        label="Presentation actions"
        className={iconButtonClass}
        items={[
          { id: "new", label: "New presentation", icon: <Plus size={15} />, onSelect: onNewDeck },
          { id: "duplicate", label: "Duplicate presentation", icon: <Copy size={15} />, onSelect: onDuplicateDeck },
          { id: "delete", label: "Delete presentation", icon: <Trash2 size={15} />, danger: true, onSelect: onDeleteDeck },
        ]}
      >
        <MoreHorizontal size={18} aria-hidden />
      </MenuButton>

      <div className="ml-auto flex items-center gap-1">
        <button type="button" className={iconButtonClass} onClick={undo} disabled={!canUndo} aria-label="Undo" title={`Undo (${shortcutLabel("Z")})`}>
          <Undo2 size={18} aria-hidden />
        </button>
        <button
          type="button"
          className={iconButtonClass}
          onClick={redo}
          disabled={!canRedo}
          aria-label="Redo"
          title={`Redo (${shortcutLabel("Z", { shift: true })})`}
        >
          <Redo2 size={18} aria-hidden />
        </button>
        <div className="mx-1.5 h-6 w-px bg-neutral-200" aria-hidden />
        <button type="button" className={buttonClass} onClick={onOpenTemplates}>
          <LayoutTemplate size={16} aria-hidden />
          Templates
        </button>
        <MenuButton
          label="Export"
          title={slideCount === 0 ? "Add a slide to export" : "Export"}
          disabled={slideCount === 0 || exporting !== null}
          align="end"
          className={buttonClass}
          items={[
            { id: "pdf", label: "PDF document (.pdf)", icon: <FileText size={15} />, onSelect: () => void runExport("pdf") },
            { id: "pptx", label: "PowerPoint (.pptx)", icon: <Presentation size={15} />, onSelect: () => void runExport("pptx") },
            { id: "html", label: "Web page (.html)", icon: <FileCode2 size={15} />, onSelect: () => void runExport("html") },
          ]}
        >
          <Download size={16} aria-hidden />
          {exporting ?? "Export"}
          {!exporting && <ChevronDown size={14} aria-hidden />}
        </MenuButton>
        <button
          type="button"
          onClick={onPresent}
          disabled={slideCount === 0}
          title={slideCount === 0 ? "Add a slide to present" : "Present from the current slide"}
          className="ml-1 inline-flex h-8 items-center gap-1.5 rounded-md bg-indigo-600 px-3 text-sm font-medium text-white hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-40"
        >
          <Play size={15} aria-hidden />
          Present
        </button>
      </div>
    </header>
  );
}
