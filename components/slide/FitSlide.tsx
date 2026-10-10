"use client";

import { useRef } from "react";
import type { Slide } from "@/lib/schema";
import { useElementSize } from "../hooks/useElementSize";
import ScaledSlide from "./ScaledSlide";

/** Renders a slide scaled to the full width of its container. */
export default function FitSlide({ slide, fallbackWidth = 280 }: { slide: Slide; fallbackWidth?: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const { width } = useElementSize(ref);
  return (
    <div ref={ref} className="w-full">
      <ScaledSlide slide={slide} width={width > 0 ? width : fallbackWidth} />
    </div>
  );
}
