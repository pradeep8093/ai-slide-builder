import { memo } from "react";
import type { ImageCrop, SlideElement, TextElement } from "@/lib/schema";
import ChartView from "./ChartView";
import ShapeView from "./ShapeView";
import TableView from "./TableView";

export const TEXT_LINE_HEIGHT = 1.2;

/** Shared text styles so the static view and the in-place editor line up exactly. */
export function textStyle(element: TextElement): React.CSSProperties {
  return {
    fontFamily: element.fontFamily,
    fontSize: element.fontSize,
    lineHeight: TEXT_LINE_HEIGHT,
    color: element.color,
    fontWeight: element.bold ? 700 : 400,
    fontStyle: element.italic ? "italic" : "normal",
    textDecoration: element.underline ? "underline" : "none",
    textAlign: element.align,
    whiteSpace: "pre-wrap",
    overflowWrap: "break-word",
    wordBreak: "break-word",
    margin: 0,
    padding: 0,
  };
}

interface ElementViewProps {
  element: SlideElement;
  background: string;
  interactive?: boolean;
}

/** Visual content of one element, filling its (already positioned) box. */
function ElementView({ element, background, interactive = false }: ElementViewProps) {
  switch (element.type) {
    case "text":
      return (
        <div style={{ ...textStyle(element), width: "100%", minHeight: "100%" }} data-element-type="text">
          {element.text}
        </div>
      );
    case "shape":
      return <ShapeView element={element} />;
    case "image": {
      const crop = element.crop;
      if (!crop) {
        return (
          // eslint-disable-next-line @next/next/no-img-element -- data URLs from the user's device; next/image adds nothing here.
          <img
            src={element.src}
            alt={element.alt}
            draggable={false}
            style={{ display: "block", width: "100%", height: "100%", objectFit: "fill", userSelect: "none" }}
          />
        );
      }
      // The visible box shows only the cropped region, scaled to fill the element.
      return (
        <div style={{ position: "relative", width: "100%", height: "100%", overflow: "hidden" }} data-cropped="true">
          {/* eslint-disable-next-line @next/next/no-img-element -- see above */}
          <img
            src={element.src}
            alt={element.alt}
            draggable={false}
            style={cropImageStyle(crop)}
          />
        </div>
      );
    }
    case "chart":
      return <ChartView element={element} background={background} interactive={interactive} />;
    case "table":
      return <TableView element={element} />;
  }
}

/** Positions the full image so that only the crop rectangle fills the container. */
export function cropImageStyle(crop: ImageCrop): React.CSSProperties {
  return {
    position: "absolute",
    display: "block",
    maxWidth: "none",
    width: `${100 / crop.width}%`,
    height: `${100 / crop.height}%`,
    left: `${(-crop.x / crop.width) * 100}%`,
    top: `${(-crop.y / crop.height) * 100}%`,
    userSelect: "none",
  };
}

export default memo(ElementView);
