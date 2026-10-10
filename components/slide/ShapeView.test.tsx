import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import { SHAPE_KINDS } from "@/lib/constants";
import { createShapeElement } from "@/lib/factory";
import ShapeView, { arrowPoints } from "./ShapeView";

describe("ShapeView", () => {
  it.each(SHAPE_KINDS)("renders a %s", (kind) => {
    const { container } = render(<ShapeView element={createShapeElement(kind)} />);
    const svg = container.querySelector("svg")!;
    expect(svg.getAttribute("data-shape")).toBe(kind);
    expect(svg.children).toHaveLength(1);
  });

  it("paints fill and keeps the stroke inside the box", () => {
    const el = createShapeElement("rectangle", { width: 200, height: 100, fill: "#ff0000", stroke: "#000000", strokeWidth: 10 });
    const rect = render(<ShapeView element={el} />).container.querySelector("rect")!;
    expect(rect.getAttribute("fill")).toBe("#ff0000");
    expect(rect.getAttribute("stroke")).toBe("#000000");
    expect(rect.getAttribute("x")).toBe("5");
    expect(rect.getAttribute("width")).toBe("190");
  });

  it("draws no fill or border when they are turned off", () => {
    const el = createShapeElement("ellipse", { fill: null, stroke: "#000000", strokeWidth: 0 });
    const ellipse = render(<ShapeView element={el} />).container.querySelector("ellipse")!;
    expect(ellipse.getAttribute("fill")).toBe("none");
    expect(ellipse.getAttribute("stroke")).toBe("none");
  });

  it("rounds corners in proportion to the shorter side", () => {
    const el = createShapeElement("rounded-rectangle", { width: 600, height: 120 });
    expect(render(<ShapeView element={el} />).container.querySelector("rect")!.getAttribute("rx")).toBe("20");
  });

  it("draws lines through the vertical middle", () => {
    const el = createShapeElement("line", { width: 300, height: 40, stroke: "#123456", strokeWidth: 6 });
    const line = render(<ShapeView element={el} />).container.querySelector("line")!;
    expect(line.getAttribute("y1")).toBe("20");
    expect(line.getAttribute("x2")).toBe("300");
    expect(line.getAttribute("stroke")).toBe("#123456");
  });

  it("computes PowerPoint-style arrow geometry", () => {
    expect(arrowPoints(200, 100)).toBe("0,25 150,25 150,0 200,50 150,100 150,75 0,75");
  });
});
