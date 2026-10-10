"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ChevronLeft, ChevronRight, X } from "lucide-react";
import { SLIDE_HEIGHT, SLIDE_WIDTH } from "@/lib/constants";
import type { Slide } from "@/lib/schema";
import { useElementSize } from "../hooks/useElementSize";
import SlideRenderer from "../slide/SlideRenderer";

interface PresentModeProps {
  slides: Slide[];
  startIndex: number;
  onExit: (lastIndex: number) => void;
}

export const CONTROLS_HIDE_MS = 2500;

/** Full-screen slideshow. Index === slides.length is the "end of presentation" screen. */
export default function PresentMode({ slides, startIndex, onExit }: PresentModeProps) {
  const [index, setIndex] = useState(() => Math.min(Math.max(startIndex, 0), Math.max(slides.length - 1, 0)));
  const [controlsVisible, setControlsVisible] = useState(true);
  const rootRef = useRef<HTMLDivElement>(null);
  const size = useElementSize(rootRef);
  const indexRef = useRef(index);
  const onExitRef = useRef(onExit);
  useEffect(() => {
    indexRef.current = index;
    onExitRef.current = onExit;
  });

  const total = slides.length;
  const atEnd = index >= total;

  const next = () => {
    if (indexRef.current >= total) onExitRef.current(total - 1);
    else setIndex((i) => Math.min(i + 1, total));
  };
  const previous = () => setIndex((i) => Math.max(i - 1, 0));
  const exit = () => onExitRef.current(Math.min(indexRef.current, total - 1));

  // Enter browser full screen when supported; leaving full screen (e.g. via Esc) ends the show.
  useEffect(() => {
    const node = rootRef.current;
    let entered = false;
    if (node?.requestFullscreen && !document.fullscreenElement) {
      node
        .requestFullscreen()
        .then(() => {
          entered = true;
        })
        .catch(() => undefined);
    }
    const onFullscreenChange = () => {
      if (entered && !document.fullscreenElement) onExitRef.current(Math.min(indexRef.current, total - 1));
    };
    document.addEventListener("fullscreenchange", onFullscreenChange);
    return () => {
      document.removeEventListener("fullscreenchange", onFullscreenChange);
      if (document.fullscreenElement && document.exitFullscreen) document.exitFullscreen().catch(() => undefined);
    };
  }, [total]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      switch (event.key) {
        case "ArrowRight":
        case "ArrowDown":
        case "PageDown":
        case " ":
        case "Enter":
          event.preventDefault();
          next();
          break;
        case "ArrowLeft":
        case "ArrowUp":
        case "PageUp":
        case "Backspace":
          event.preventDefault();
          previous();
          break;
        case "Home":
          event.preventDefault();
          setIndex(0);
          break;
        case "End":
          event.preventDefault();
          setIndex(total - 1);
          break;
        case "Escape":
          event.preventDefault();
          exit();
          break;
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
    // next/previous/exit read refs, so binding once per slide count is enough.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [total]);

  useEffect(() => {
    if (!controlsVisible) return;
    const timer = setTimeout(() => setControlsVisible(false), CONTROLS_HIDE_MS);
    return () => clearTimeout(timer);
  }, [controlsVisible, index]);

  const scale = size.width > 0 && size.height > 0 ? Math.min(size.width / SLIDE_WIDTH, size.height / SLIDE_HEIGHT) : 0.5;
  const slide = slides[index];

  return createPortal(
    <div
      ref={rootRef}
      role="dialog"
      aria-modal="true"
      aria-label="Presentation"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black"
      style={{ cursor: controlsVisible ? "default" : "none" }}
      onMouseMove={() => setControlsVisible(true)}
      onClick={next}
    >
      {atEnd || !slide ? (
        <p className="text-sm text-neutral-400">End of presentation. Click or press → to exit.</p>
      ) : (
        <div style={{ width: SLIDE_WIDTH * scale, height: SLIDE_HEIGHT * scale }} aria-label={`Slide ${index + 1} of ${total}`} role="group">
          <div style={{ transform: `scale(${scale})`, transformOrigin: "top left", width: SLIDE_WIDTH, height: SLIDE_HEIGHT }}>
            <SlideRenderer slide={slide} interactive />
          </div>
        </div>
      )}

      <div
        className={`absolute bottom-4 right-4 flex items-center gap-1 rounded-lg bg-neutral-900/80 p-1 text-white transition-opacity ${controlsVisible ? "opacity-100" : "pointer-events-none opacity-0"}`}
        onClick={(event) => event.stopPropagation()}
      >
        <button type="button" onClick={previous} disabled={index === 0} aria-label="Previous slide" className="rounded p-1.5 hover:bg-white/10 disabled:opacity-30">
          <ChevronLeft size={18} aria-hidden />
        </button>
        <span className="min-w-14 text-center text-xs tabular-nums" data-testid="present-counter">
          {atEnd ? "End" : `${index + 1} / ${total}`}
        </span>
        <button type="button" onClick={next} aria-label="Next slide" className="rounded p-1.5 hover:bg-white/10">
          <ChevronRight size={18} aria-hidden />
        </button>
        <button type="button" onClick={exit} aria-label="Exit presentation" className="ml-1 rounded p-1.5 hover:bg-white/10">
          <X size={18} aria-hidden />
        </button>
      </div>
    </div>,
    document.body,
  );
}
