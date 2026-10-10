import { describe, expect, it } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { createChartElement, createImageElement, createShapeElement, createTableElement, createTextElement } from "@/lib/factory";
import type { ImageCrop, ImageElement } from "@/lib/schema";
import ElementView, { cropImageStyle, textStyle } from "./ElementView";

const SRC = "data:image/png;base64,AAAA";

function picture(crop?: ImageCrop): ImageElement {
  const img = createImageElement(SRC, 400, 200, "Team photo");
  return crop ? { ...img, crop } : img;
}

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

  it("passes the slide background and interactivity to charts", () => {
    const { container, rerender } = render(<ElementView element={createChartElement("bar", { showValues: true })} background="#000000" />);
    expect(container.querySelector(".recharts-label-list text")).toHaveAttribute("fill", "#c3c2b7");
    expect(container.querySelector(".recharts-tooltip-wrapper")).toBeNull();
    rerender(<ElementView element={createChartElement("bar")} background="#ffffff" interactive />);
    expect(container.querySelector(".recharts-tooltip-wrapper")).toBeInTheDocument();
  });

  describe("tables", () => {
    it("renders a table with its cells", () => {
      const table = createTableElement({
        rows: [
          ["Region", "Sales"],
          ["North", "120"],
        ],
      });
      const { container } = render(<ElementView element={table} background="#ffffff" />);
      expect(container.querySelector('[data-element-type="table"]')).toBe(screen.getByRole("table"));
      const rows = screen.getAllByRole("row");
      expect(rows.map((row) => within(row).getAllByRole("cell").map((c) => c.textContent))).toEqual([
        ["Region", "Sales"],
        ["North", "120"],
      ]);
    });

    it("styles the header row from the table settings", () => {
      render(<ElementView element={createTableElement({ headerRow: true, headerFill: "#111827" })} background="#ffffff" />);
      const [header, body] = screen.getAllByRole("row");
      expect(within(header).getAllByRole("cell")[0]).toHaveStyle({ fontWeight: "700", color: "#ffffff", background: "#111827" });
      expect(within(body).getAllByRole("cell")[0]).toHaveStyle({ fontWeight: "400" });
    });
  });

  describe("images", () => {
    it("fills the box with the whole picture when it isn't cropped", () => {
      const { container } = render(<ElementView element={picture()} background="#ffffff" />);
      const img = screen.getByRole("img", { name: "Team photo" });
      expect(img).toHaveAttribute("src", SRC);
      expect(img).toHaveStyle({ width: "100%", height: "100%", objectFit: "fill" });
      expect(container.querySelector('[data-cropped="true"]')).toBeNull();
    });

    it("shows only the cropped region, scaled to fill the box", () => {
      const { container } = render(<ElementView element={picture({ x: 0.25, y: 0.5, width: 0.5, height: 0.25 })} background="#ffffff" />);
      const frame = container.querySelector('[data-cropped="true"]') as HTMLElement;
      expect(frame).toHaveStyle({ position: "relative", overflow: "hidden", width: "100%", height: "100%" });
      const img = within(frame).getByRole("img", { name: "Team photo" });
      expect(img).toHaveAttribute("src", SRC);
      expect(img).toHaveAttribute("draggable", "false");
      expect(img).toHaveStyle({ position: "absolute", width: "200%", height: "400%", left: "-50%", top: "-200%", maxWidth: "none" });
    });

    it("renders a full-size crop like the uncropped picture", () => {
      const { container } = render(<ElementView element={picture({ x: 0, y: 0, width: 1, height: 1 })} background="#ffffff" />);
      expect(container.querySelector('[data-cropped="true"]')).toBeInTheDocument();
      expect(screen.getByRole("img", { name: "Team photo" })).toHaveStyle({ width: "100%", height: "100%", left: "0%", top: "0%" });
    });
  });
});

describe("cropImageStyle", () => {
  it("leaves an uncropped picture at its natural position and size", () => {
    expect(cropImageStyle({ x: 0, y: 0, width: 1, height: 1 })).toMatchObject({ width: "100%", height: "100%", left: "0%", top: "0%" });
  });

  it("enlarges the picture so the crop fills the box", () => {
    const style = cropImageStyle({ x: 0, y: 0, width: 0.5, height: 0.25 });
    expect(style).toMatchObject({ width: "200%", height: "400%", left: "0%", top: "0%" });
  });

  it("shifts the picture so the crop's top-left corner sits at the box's corner", () => {
    // Right half, bottom quarter: the image is twice as wide and four times as tall as the box.
    const style = cropImageStyle({ x: 0.5, y: 0.75, width: 0.5, height: 0.25 });
    expect(style).toMatchObject({ width: "200%", height: "400%", left: "-100%", top: "-300%" });
  });

  it("matches the general formula for arbitrary crops", () => {
    const crop = { x: 0.1, y: 0.2, width: 0.3, height: 0.6 };
    const style = cropImageStyle(crop);
    const pct = (value: unknown) => {
      expect(String(value)).toMatch(/%$/);
      return parseFloat(String(value));
    };
    expect(pct(style.width)).toBeCloseTo(100 / 0.3, 6);
    expect(pct(style.height)).toBeCloseTo(100 / 0.6, 6);
    expect(pct(style.left)).toBeCloseTo((-0.1 / 0.3) * 100, 6);
    expect(pct(style.top)).toBeCloseTo((-0.2 / 0.6) * 100, 6);
  });

  it("positions the picture absolutely and lifts the max-width cap", () => {
    expect(cropImageStyle({ x: 0.2, y: 0.2, width: 0.6, height: 0.6 })).toMatchObject({ position: "absolute", display: "block", maxWidth: "none", userSelect: "none" });
  });
});
