import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { createShapeElement, createSlide, createTextElement } from "@/lib/factory";
import FitSlide from "./FitSlide";
import ScaledSlide from "./ScaledSlide";
import SlideRenderer from "./SlideRenderer";

const slide = {
  ...createSlide("#abcdef"),
  elements: [createShapeElement("rectangle", { x: 10, y: 20, width: 30, height: 40 }), createTextElement({ text: "On top" })],
};

describe("SlideRenderer", () => {
  it("renders the background and positions elements in order", () => {
    const { container } = render(<SlideRenderer slide={slide} />);
    const root = container.firstElementChild as HTMLElement;
    expect(root).toHaveStyle({ width: "1280px", height: "720px", background: "#abcdef" });
    const boxes = root.children;
    expect(boxes).toHaveLength(2);
    expect(boxes[0]).toHaveStyle({ left: "10px", top: "20px", width: "30px", height: "40px" });
    expect(boxes[1]).toHaveTextContent("On top");
  });
});

describe("ScaledSlide", () => {
  it("scales the slide to the requested width keeping 16:9", () => {
    const { container } = render(<ScaledSlide slide={slide} width={320} />);
    const outer = container.firstElementChild as HTMLElement;
    expect(outer).toHaveStyle({ width: "320px", height: "180px" });
    expect(outer.firstElementChild).toHaveStyle({ transform: "scale(0.25)" });
  });
});

describe("FitSlide", () => {
  it("falls back to a default width before it can be measured", () => {
    const { container } = render(<FitSlide slide={slide} fallbackWidth={256} />);
    expect(container.querySelector('[style*="width: 256px"]')).toBeInTheDocument();
    expect(screen.getByText("On top")).toBeInTheDocument();
  });
});
