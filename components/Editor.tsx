"use client";

import { useEffect, useState } from "react";
import { ArrowLeft, RefreshCw, X } from "lucide-react";
import { createDeckRecord, duplicateDeckRecord, deleteDeckRecord, StorageFullError } from "@/lib/persistence";
import { useEditorStore } from "@/lib/store/editorStore";
import { toast } from "@/lib/store/toastStore";
import ChatPanel from "./chat/ChatPanel";
import Canvas from "./editor/Canvas";
import ChartDataEditor from "./editor/ChartDataEditor";
import CropEditor from "./editor/CropEditor";
import EmptyState from "./editor/EmptyState";
import Header from "./editor/Header";
import LoadingScreen from "./editor/LoadingScreen";
import NotesPanel from "./editor/NotesPanel";
import PresentMode from "./editor/PresentMode";
import SlideSidebar from "./editor/SlideSidebar";
import TableEditor from "./editor/TableEditor";
import TemplateGallery from "./editor/TemplateGallery";
import Toolbar from "./editor/Toolbar";
import { useClipboard } from "./hooks/useClipboard";
import { useDeckSession } from "./hooks/useDeckSession";
import { useEditorShortcuts } from "./hooks/useEditorShortcuts";
import type { Route } from "./hooks/useHashRoute";
import Modal from "./ui/Modal";

/** How long the highlight on AI-changed elements stays (the flash animation is a bit shorter). */
export const AI_HIGHLIGHT_MS = 3000;

const UNTITLED = "Untitled presentation";

interface EditorProps {
  deckId: string;
  onNavigate: (route: Route) => void;
}

function Problem({ title, message, onBack }: { title: string; message: string; onBack: () => void }) {
  return (
    <div className="flex h-screen items-center justify-center bg-neutral-100 p-6">
      <div className="max-w-md rounded-2xl border border-neutral-200 bg-white p-8 text-center">
        <h1 className="text-lg font-semibold text-neutral-900">{title}</h1>
        <p className="mt-2 text-sm leading-6 text-neutral-600">{message}</p>
        <button
          type="button"
          onClick={onBack}
          className="mt-6 inline-flex h-10 items-center gap-2 rounded-lg bg-indigo-600 px-4 text-sm font-medium text-white hover:bg-indigo-700"
        >
          <ArrowLeft size={16} aria-hidden />
          All presentations
        </button>
      </div>
    </div>
  );
}

/** The whole slide editor for one presentation: header, slide list, toolbar + canvas + notes, and the AI chat. */
export default function Editor({ deckId, onNavigate }: EditorProps) {
  const goHome = () => onNavigate({ view: "dashboard" });
  const session = useDeckSession(deckId, {
    onDeletedElsewhere: () => {
      toast.info("This presentation was deleted in another tab.");
      onNavigate({ view: "dashboard" });
    },
  });
  const slides = useEditorStore((s) => s.deck.slides);
  const selectedSlideId = useEditorStore((s) => s.selectedSlideId);
  const aiHighlightToken = useEditorStore((s) => s.aiHighlight?.token ?? null);
  const [templatesOpen, setTemplatesOpen] = useState(false);
  const [editorElementId, setEditorElementId] = useState<string | null>(null);
  const [presenting, setPresenting] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [busy, setBusy] = useState(false);

  const currentSlide = slides.find((s) => s.id === selectedSlideId) ?? null;
  // Null when the element is gone (deleted, undone, or changed by the AI) — its editor then closes.
  const editing = currentSlide?.elements.find((e) => e.id === editorElementId) ?? null;
  const ready = session.status === "ready";
  const elementEditorOpen = editing?.type === "chart" || editing?.type === "table" || editing?.type === "image";
  const dialogOpen = templatesOpen || elementEditorOpen || presenting || confirmDelete;
  useEditorShortcuts(ready && !dialogOpen);
  useClipboard(ready && !dialogOpen);

  // The highlight on what the AI just changed fades by itself.
  useEffect(() => {
    if (!aiHighlightToken) return;
    const timer = setTimeout(() => {
      if (useEditorStore.getState().aiHighlight?.token === aiHighlightToken) useEditorStore.getState().clearAiHighlight();
    }, AI_HIGHLIGHT_MS);
    return () => clearTimeout(timer);
  }, [aiHighlightToken]);

  if (session.status === "loading") return <LoadingScreen />;
  if (session.status === "missing") {
    return <Problem title="Presentation not found" message="It may have been deleted, or it was saved in a different browser." onBack={goHome} />;
  }
  if (session.status === "corrupt") {
    return (
      <Problem
        title="This presentation can't be opened"
        message="Its saved data is damaged. A backup copy was kept in this browser's storage. Your other presentations are not affected."
        onBack={goHome}
      />
    );
  }

  const run = async (action: () => Promise<void>, failure: string) => {
    if (busy) return;
    setBusy(true);
    try {
      await action();
    } catch (error) {
      console.error(error);
      toast.error(error instanceof StorageFullError ? error.message : failure);
    } finally {
      setBusy(false);
    }
  };

  const newDeck = () =>
    run(async () => {
      await session.flush();
      const deck = await createDeckRecord();
      session.post({ type: "decks-changed" });
      onNavigate({ view: "deck", deckId: deck.id });
    }, "A new presentation couldn't be created.");

  const duplicateDeck = () =>
    run(async () => {
      await session.flush();
      const copy = await duplicateDeckRecord(useEditorStore.getState().deck);
      session.post({ type: "decks-changed" });
      toast.success(`Opened “${copy.title}”.`);
      onNavigate({ view: "deck", deckId: copy.id });
    }, "The presentation couldn't be duplicated.");

  const deleteDeck = () =>
    run(async () => {
      const title = useEditorStore.getState().deck.title.trim() || UNTITLED;
      session.discard();
      await deleteDeckRecord(deckId);
      session.post({ type: "deck-deleted", deckId });
      session.post({ type: "decks-changed" });
      setConfirmDelete(false);
      toast.success(`Deleted “${title}”.`);
      goHome();
    }, "The presentation couldn't be deleted.");

  const startIndex = Math.max(0, slides.findIndex((s) => s.id === selectedSlideId));
  const closeElementEditor = () => setEditorElementId(null);

  return (
    <div className="flex h-screen min-w-[1024px] flex-col bg-neutral-100 text-neutral-900">
      <Header
        onOpenTemplates={() => setTemplatesOpen(true)}
        onPresent={() => slides.length > 0 && setPresenting(true)}
        onHome={() => void session.flush().finally(goHome)}
        onNewDeck={() => void newDeck()}
        onDuplicateDeck={() => void duplicateDeck()}
        onDeleteDeck={() => setConfirmDelete(true)}
      />

      {session.externalChange && (
        <div role="alert" className="flex shrink-0 items-center gap-3 border-b border-amber-200 bg-amber-50 px-4 py-2 text-sm text-amber-900">
          This presentation was changed in another tab. Reload to see the latest version, or keep editing here to overwrite it.
          <button type="button" onClick={() => void session.reload()} className="ml-auto inline-flex items-center gap-1 rounded-md bg-amber-100 px-2.5 py-1 font-medium hover:bg-amber-200">
            <RefreshCw size={14} aria-hidden />
            Reload
          </button>
          <button type="button" onClick={session.dismissExternalChange} aria-label="Dismiss warning" className="rounded p-1 hover:bg-amber-100">
            <X size={14} aria-hidden />
          </button>
        </div>
      )}

      <div className="flex min-h-0 flex-1">
        <SlideSidebar />
        <main className="flex min-w-0 flex-1 flex-col" aria-label="Slide editor">
          <Toolbar onEditElement={setEditorElementId} />
          <div className="relative min-h-0 flex-1">
            {currentSlide ? (
              <Canvas onEditElement={setEditorElementId} />
            ) : (
              <EmptyState onAddSlide={() => useEditorStore.getState().addSlide()} onBrowseTemplates={() => setTemplatesOpen(true)} />
            )}
          </div>
          <NotesPanel />
        </main>
        <ChatPanel />
      </div>

      {templatesOpen && <TemplateGallery onClose={() => setTemplatesOpen(false)} />}
      {currentSlide && editing?.type === "chart" && <ChartDataEditor key={editing.id} slideId={currentSlide.id} chart={editing} onClose={closeElementEditor} />}
      {currentSlide && editing?.type === "table" && <TableEditor key={editing.id} slideId={currentSlide.id} table={editing} onClose={closeElementEditor} />}
      {currentSlide && editing?.type === "image" && <CropEditor key={editing.id} slideId={currentSlide.id} image={editing} onClose={closeElementEditor} />}
      {presenting && (
        <PresentMode
          slides={slides}
          startIndex={startIndex}
          onExit={(lastIndex) => {
            setPresenting(false);
            const slide = useEditorStore.getState().deck.slides[lastIndex];
            if (slide) useEditorStore.getState().selectSlide(slide.id);
          }}
        />
      )}
      {confirmDelete && (
        <Modal
          title="Delete presentation?"
          width={440}
          onClose={() => setConfirmDelete(false)}
          footer={
            <>
              <button type="button" onClick={() => setConfirmDelete(false)} className="h-9 rounded-md border border-neutral-200 px-4 text-sm font-medium text-neutral-700 hover:bg-neutral-50">
                Cancel
              </button>
              <button
                type="button"
                data-autofocus
                disabled={busy}
                onClick={() => void deleteDeck()}
                className="h-9 rounded-md bg-red-600 px-4 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50"
              >
                Delete
              </button>
            </>
          }
        >
          <p className="text-sm leading-6 text-neutral-600">
            “{useEditorStore.getState().deck.title.trim() || UNTITLED}” and its AI chat history will be permanently deleted from this browser. This can&apos;t be undone.
          </p>
        </Modal>
      )}
    </div>
  );
}
