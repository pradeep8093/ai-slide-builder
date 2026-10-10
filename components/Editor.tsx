"use client";

import { useState } from "react";
import { RefreshCw, X } from "lucide-react";
import { useEditorStore } from "@/lib/store/editorStore";
import ChatPanel from "./chat/ChatPanel";
import Canvas from "./editor/Canvas";
import ChartDataEditor from "./editor/ChartDataEditor";
import EmptyState from "./editor/EmptyState";
import Header from "./editor/Header";
import LoadingScreen from "./editor/LoadingScreen";
import PresentMode from "./editor/PresentMode";
import SlideSidebar from "./editor/SlideSidebar";
import TemplateGallery from "./editor/TemplateGallery";
import Toolbar from "./editor/Toolbar";
import { useEditorShortcuts } from "./hooks/useEditorShortcuts";
import { usePersistence } from "./hooks/usePersistence";
import Toasts from "./ui/Toasts";

/** The whole slide editor: header, slide list, toolbar + canvas, and the AI chat. */
export default function Editor() {
  const hydrated = useEditorStore((s) => s.hydrated);
  const slides = useEditorStore((s) => s.deck.slides);
  const selectedSlideId = useEditorStore((s) => s.selectedSlideId);
  const { externalChange, reload, dismissExternalChange } = usePersistence();
  const [templatesOpen, setTemplatesOpen] = useState(false);
  const [chartEditorId, setChartEditorId] = useState<string | null>(null);
  const [presenting, setPresenting] = useState(false);

  useEditorShortcuts(hydrated && !templatesOpen && chartEditorId === null && !presenting);

  if (!hydrated) return <LoadingScreen />;

  const currentSlide = slides.find((s) => s.id === selectedSlideId) ?? null;
  const chart = currentSlide?.elements.find((e) => e.id === chartEditorId && e.type === "chart");
  const startIndex = Math.max(0, slides.findIndex((s) => s.id === selectedSlideId));

  return (
    <div className="flex h-screen min-w-[1024px] flex-col bg-neutral-100 text-neutral-900">
      <Header onOpenTemplates={() => setTemplatesOpen(true)} onPresent={() => slides.length > 0 && setPresenting(true)} />

      {externalChange && (
        <div role="alert" className="flex shrink-0 items-center gap-3 border-b border-amber-200 bg-amber-50 px-4 py-2 text-sm text-amber-900">
          This presentation was changed in another tab. Reload to see the latest version, or keep editing here to overwrite it.
          <button type="button" onClick={() => void reload()} className="ml-auto inline-flex items-center gap-1 rounded-md bg-amber-100 px-2.5 py-1 font-medium hover:bg-amber-200">
            <RefreshCw size={14} aria-hidden />
            Reload
          </button>
          <button type="button" onClick={dismissExternalChange} aria-label="Dismiss warning" className="rounded p-1 hover:bg-amber-100">
            <X size={14} aria-hidden />
          </button>
        </div>
      )}

      <div className="flex min-h-0 flex-1">
        <SlideSidebar />
        <main className="flex min-w-0 flex-1 flex-col" aria-label="Slide editor">
          <Toolbar onEditChartData={setChartEditorId} />
          <div className="relative min-h-0 flex-1">
            {currentSlide ? (
              <Canvas onEditChartData={setChartEditorId} />
            ) : (
              <EmptyState onAddSlide={() => useEditorStore.getState().addSlide()} onBrowseTemplates={() => setTemplatesOpen(true)} />
            )}
          </div>
        </main>
        <ChatPanel />
      </div>

      {templatesOpen && <TemplateGallery onClose={() => setTemplatesOpen(false)} />}
      {chart && chart.type === "chart" && currentSlide && (
        <ChartDataEditor key={chart.id} slideId={currentSlide.id} chart={chart} onClose={() => setChartEditorId(null)} />
      )}
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
      <Toasts />
    </div>
  );
}
