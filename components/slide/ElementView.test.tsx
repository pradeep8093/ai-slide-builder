import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { createChartElement, createImageElement, createShapeElement, createTextElement } from "@/lib/factory";
import ElementView, { textStyle } from "./ElementView";

describe("ElementView", () => {
  it("renders text with its formatting and line breaks", () => {
    const el = createTextElement({ text: "Line 1\nLine 2", bold: true, italic: true, underline: true, align: "right", color: "#ff0000", fontSize: 30, fontFamily: "Georgia" });
    const { container } = render(<ElementView element={el} background="#ffffff" />);
    const node = container.querySelector('[data-element-type="text"]') as HTMLElement;
    expect(node.textContent).toBe("Line 1\nLine 2");
    expect(node).toHaveStyle({ fontWeight: "700", fontStyle: "italic", textDecoration: "underline", textAlign: "right", fontSize: "30px", whiteSpace: "pre-wrap" });
  });

  it("renders shapes, images and charts", () => {
    const { container, rerender } = render(<ElementView element={createShapeElement("triangle")} background="#ffffff" />);
    expect(container.querySelector('[data-shape="triangle"]')).toBeInTheDocument();
    rerender(<ElementView element={createImageElement("data:image/png;base64,AAAA", 10, 10, "Logo")} background="#ffffff" />);
    expect(screen.getByRole("img", { name: "Logo" })).toHaveAttribute("draggable", "false");
    rerender(<ElementView element={createChartElement("area")} background="#ffffff" />);
    expect(container.querySelector('[data-chart-type="area"]')).toBeInTheDocument();
  });

  it("uses normal weight and style when formatting is off", () => {
    expect(textStyle(createTextElement())).toMatchObject({ fontWeight: 400, fontStyle: "normal", textDecoration: "none" });
  });
});
