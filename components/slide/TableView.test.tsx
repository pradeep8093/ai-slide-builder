import { describe, expect, it } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { createTableElement } from "@/lib/factory";
import type { TableElement } from "@/lib/schema";
import TableView from "./TableView";

const ROWS = [
  ["Name", "Score"],
  ["Ada", "98"],
  ["Linus", "87"],
];

function renderTable(overrides: Partial<Omit<TableElement, "type">> = {}) {
  render(<TableView element={createTableElement({ rows: ROWS, ...overrides })} />);
  const rows = screen.getAllByRole("row");
  const cellsOf = (row: number) => within(rows[row]).getAllByRole("cell");
  return { table: screen.getByRole("table"), rows, cellsOf };
}

describe("TableView", () => {
  it("renders every cell's text in row order", () => {
    const { table, rows, cellsOf } = renderTable();
    expect(table).toHaveAttribute("data-element-type", "table");
    expect(rows).toHaveLength(3);
    expect(rows.map((_, r) => cellsOf(r).map((c) => c.textContent))).toEqual(ROWS);
  });

  it("keeps empty cells and line breaks inside cells", () => {
    const { cellsOf } = renderTable({ rows: [["Two\nlines", ""], ["", "x"]] });
    expect(cellsOf(0)[0].textContent).toBe("Two\nlines");
    expect(cellsOf(0)[0]).toHaveStyle({ whiteSpace: "pre-wrap" });
    expect(cellsOf(0)[1]).toBeEmptyDOMElement();
    expect(cellsOf(1)).toHaveLength(2);
  });

  it("applies the table's font, size and text color", () => {
    const { table, cellsOf } = renderTable({ fontFamily: "Georgia", fontSize: 24, color: "#123456", headerRow: false });
    expect(table).toHaveStyle({ fontFamily: "Georgia", fontSize: "24px", color: "#123456", width: "100%", height: "100%", tableLayout: "fixed" });
    expect(cellsOf(1)[0]).toHaveStyle({ color: "#123456" });
  });

  it("scales cell padding with the font size", () => {
    const { cellsOf } = renderTable({ fontSize: 40 });
    expect(cellsOf(1)[0]).toHaveStyle({ padding: "10px 18px" });
  });

  describe("header row", () => {
    it("styles the first row as a bold, filled header", () => {
      const { cellsOf } = renderTable({ headerRow: true, headerFill: "#eef2ff" });
      for (const cell of cellsOf(0)) expect(cell).toHaveStyle({ fontWeight: "700", background: "#eef2ff" });
      for (const row of [1, 2]) {
        for (const cell of cellsOf(row)) {
          expect(cell).toHaveStyle({ fontWeight: "400" });
          expect(cell.style.background).toBe("");
        }
      }
    });

    it("uses white header text on a dark fill and keeps body text in the table color", () => {
      const { cellsOf } = renderTable({ headerRow: true, headerFill: "#1f2937", color: "#333333" });
      for (const cell of cellsOf(0)) expect(cell).toHaveStyle({ color: "#ffffff", background: "#1f2937" });
      for (const cell of cellsOf(1)) expect(cell).toHaveStyle({ color: "#333333" });
    });

    it("keeps the table color for header text on a light fill", () => {
      const { cellsOf } = renderTable({ headerRow: true, headerFill: "#eef2ff", color: "#333333" });
      for (const cell of cellsOf(0)) expect(cell).toHaveStyle({ color: "#333333" });
    });

    it("bolds the header without a fill when the header fill is off", () => {
      const { cellsOf } = renderTable({ headerRow: true, headerFill: null, color: "#333333" });
      for (const cell of cellsOf(0)) {
        expect(cell).toHaveStyle({ fontWeight: "700", color: "#333333" });
        expect(cell.style.background).toBe("");
      }
    });

    it("treats the first row as a normal row when the header is off, even with a dark fill set", () => {
      const { cellsOf } = renderTable({ headerRow: false, headerFill: "#1f2937", color: "#333333" });
      for (const cell of cellsOf(0)) {
        expect(cell).toHaveStyle({ fontWeight: "400", color: "#333333" });
        expect(cell.style.background).toBe("");
      }
    });
  });

  describe("borders", () => {
    it("draws cell borders in the border color", () => {
      const { cellsOf } = renderTable({ borderColor: "#d1d5db" });
      for (const row of [0, 1, 2]) for (const cell of cellsOf(row)) expect(cell).toHaveStyle({ border: "1.5px solid #d1d5db" });
    });

    it("draws no borders when the border color is off", () => {
      const { cellsOf } = renderTable({ borderColor: null });
      for (const row of [0, 1, 2]) {
        for (const cell of cellsOf(row)) {
          expect(cell.style.borderStyle).toBe("none");
          expect(cell).not.toHaveStyle({ border: "1.5px solid #d1d5db" });
        }
      }
    });
  });

  describe("row heights", () => {
    it.each([1, 3, 4, 7])("splits the height evenly between %i rows", (count) => {
      const rows = Array.from({ length: count }, (_, r) => [`r${r}`, "x"]);
      const { rows: rendered } = renderTable({ rows });
      expect(rendered).toHaveLength(count);
      const heights = rendered.map((row) => row.style.height);
      expect(new Set(heights).size).toBe(1);
      expect(parseFloat(heights[0])).toBeCloseTo(100 / count, 6);
      expect(heights[0].endsWith("%")).toBe(true);
    });

    it("keeps rows the same height regardless of how much text they hold", () => {
      const { rows } = renderTable({ rows: [["short"], ["a much longer cell\nwith\nseveral\nlines"]] });
      expect(rows[0].style.height).toBe(rows[1].style.height);
    });
  });
});
