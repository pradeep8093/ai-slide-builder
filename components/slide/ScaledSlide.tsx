import { SLIDE_HEIGHT, SLIDE_WIDTH } from "@/lib/constants";
import type { Slide } from "@/lib/schema";
import SlideRenderer from "./SlideRenderer";

interface ScaledSlideProps {
  slide: Slide;
  /** Rendered width in CSS px; height follows the 16:9 ratio. */
  width: number;
  interactive?: boolean;
}

/** A slide shrunk (or grown) to a given width with a CSS transform, e.g. for thumbnails. */
export default function ScaledSlide({ slide, width, interactive = false }: ScaledSlideProps) {
  const scale = width / SLIDE_WIDTH;
  return (
    <div style={{ width, height: SLIDE_HEIGHT * scale, overflow: "hidden", position: "relative" }}>
      <div style={{ transform: `scale(${scale})`, transformOrigin: "top left", width: SLIDE_WIDTH, height: SLIDE_HEIGHT }}>
        <SlideRenderer slide={slide} interactive={interactive} />
      </div>
    </div>
  );
}
