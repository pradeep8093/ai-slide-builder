import { memo } from "react";
import { SLIDE_HEIGHT, SLIDE_WIDTH } from "@/lib/constants";
import type { Slide } from "@/lib/schema";
import ElementView from "./ElementView";

interface SlideRendererProps {
  slide: Slide;
  interactive?: boolean;
  className?: string;
}

/** Read-only rendering of a slide at its native 1280×720 size (used by thumbnails, present mode and export). */
function SlideRenderer({ slide, interactive = false, className }: SlideRendererProps) {
  return (
    <div
      className={className}
      data-slide-id={slide.id}
      style={{
        position: "relative",
        width: SLIDE_WIDTH,
        height: SLIDE_HEIGHT,
        background: slide.background,
        overflow: "hidden",
      }}
    >
      {slide.elements.map((element) => (
        <div
          key={element.id}
          style={{ position: "absolute", left: element.x, top: element.y, width: element.width, height: element.height }}
        >
          <ElementView element={element} background={slide.background} interactive={interactive} />
        </div>
      ))}
    </div>
  );
}

export default memo(SlideRenderer);
