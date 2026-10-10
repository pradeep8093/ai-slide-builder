import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { currentDeck, editor, seedDeck, slideWith } from "@/test/utils";
import { MAX_TABLE_CELL_LENGTH, MAX_TABLE_COLS, MAX_TABLE_ROWS, SLIDE_HEIGHT } from "@/lib/constants";
import { createTableElement } from "@/lib/factory";
import type { TableElement } from "@/lib/schema";
import TableEditor, { pasteIntoGrid } from "./TableEditor";

type User = ReturnType<typeof userEvent.setup>;

const TRUNCATED_NOTICE = `Tables can have up to ${MAX_TABLE_ROWS} rows and ${MAX_TABLE_COLS} columns; extra cells were left out.`;

function setup(table: TableElement = createTableElement()) {
  const deck = seedDeck([slideWith(table)]);
  const onClose = vi.fn();
  render(<TableEditor slideId={deck.slides[0].id} table={table} onClose={onClose} />);
  return { onClose, table };
}

const saved = () => currentDeck().slides[0].elements[0] as TableElement;
const cell = (row: number, col: number) => screen.getByRole("textbox", { name: `Row ${row}, column ${col}` });
const cellCount = () => screen.getAllByRole("textbox", { name: /^Row \d+, column \d+$/ }).length;
const rowCount = () => screen.getAllByRole("button", { name: /^Remove row \d+$/ }).length;
const columnCount = () => screen.getAllByRole("button", { name: /^Remove column \d+$/ }).length;

async function pasteInto(user: User, target: HTMLElement, text: string) {
  await user.click(target);
  await user.paste(text);
}

function grid(rows: number, cols: number, fill = (r: number, c: number) => `${r},${c}`) {
  return Array.from({ length: rows }, (_, r) => Array.from({ length: cols }, (_, c) => fill(r, c)));
}

describe("pasteIntoGrid", () => {
  it("writes the block starting at the given cell and keeps the other cells", () => {
    const result = pasteIntoGrid(grid(3, 3), 1, 1, [["a", "b"]]);
    expect(result).toEqual({
      rows: [
        ["0,0", "0,1", "0,2"],
        ["1,0", "a", "b"],
        ["2,0", "2,1", "2,2"],
      ],
      truncated: false,
    });
  });

  it("grows the grid with empty cells to fit the block", () => {
    const result = pasteIntoGrid(grid(2, 2), 1, 1, [
      ["a", "b", "c"],
      ["d", "e", "f"],
    ]);
    expect(result.truncated).toBe(false);
    expect(result.rows).toEqual([
      ["0,0", "0,1", "", ""],
      ["1,0", "a", "b", "c"],
      ["", "d", "e", "f"],
    ]);
  });

  it("does not modify the grid it was given", () => {
    const original = grid(2, 2);
    const copy = structuredClone(original);
    pasteIntoGrid(original, 0, 0, [["x", "y", "z"]]);
    expect(original).toEqual(copy);
  });

  it("fills an empty grid", () => {
    expect(pasteIntoGrid([], 0, 0, [["a", "b"], ["c"]])).toEqual({
      rows: [
        ["a", "b"],
        ["c", ""],
      ],
      truncated: false,
    });
  });

  it("keeps existing cells where a ragged block has no value", () => {
    const result = pasteIntoGrid(grid(2, 2), 0, 0, [["a", "b"], ["c"]]);
    expect(result.rows).toEqual([
      ["a", "b"],
      ["c", "1,1"],
    ]);
  });

  it("leaves the grid as it is for an empty block", () => {
    expect(pasteIntoGrid(grid(2, 2), 1, 1, [])).toEqual({ rows: grid(2, 2), truncated: false });
  });

  it("fills exactly up to the limits without truncating", () => {
    const result = pasteIntoGrid([[""]], 0, 0, grid(MAX_TABLE_ROWS, MAX_TABLE_COLS));
    expect(result.truncated).toBe(false);
    expect(result.rows).toHaveLength(MAX_TABLE_ROWS);
    expect(result.rows[0]).toHaveLength(MAX_TABLE_COLS);
  });

  it("stops at the row limit and reports the truncation", () => {
    const result = pasteIntoGrid(grid(2, 2), MAX_TABLE_ROWS - 3, 0, grid(5, 1, (r) => `r${r}`));
    expect(result.truncated).toBe(true);
    expect(result.rows).toHaveLength(MAX_TABLE_ROWS);
    expect(result.rows.map((row) => row[0]).slice(-3)).toEqual(["r0", "r1", "r2"]);
  });

  it("stops at the column limit and reports the truncation", () => {
    const block = [Array.from({ length: MAX_TABLE_COLS + 4 }, (_, c) => `c${c}`)];
    const result = pasteIntoGrid(grid(1, 1), 0, 2, block);
    expect(result.truncated).toBe(true);
    expect(result.rows[0]).toHaveLength(MAX_TABLE_COLS);
    expect(result.rows[0].slice(0, 3)).toEqual(["0,0", "", "c0"]);
    expect(result.rows[0][MAX_TABLE_COLS - 1]).toBe(`c${MAX_TABLE_COLS - 3}`);
  });

  it("cuts overly long cells and reports the truncation", () => {
    const long = "x".repeat(MAX_TABLE_CELL_LENGTH + 20);
    const result = pasteIntoGrid(grid(1, 2), 0, 0, [["ok", long]]);
    expect(result.truncated).toBe(true);
    expect(result.rows[0][0]).toBe("ok");
    expect(result.rows[0][1]).toHaveLength(MAX_TABLE_CELL_LENGTH);
  });

  it("accepts cells exactly at the length limit", () => {
    const exact = "x".repeat(MAX_TABLE_CELL_LENGTH);
    expect(pasteIntoGrid(grid(1, 1), 0, 0, [[exact]])).toEqual({ rows: [[exact]], truncated: false });
  });
});

describe("TableEditor", () => {
  it("shows the table's cells and focuses the first one", () => {
    setup(createTableElement({ rows: [["Name", "Score"], ["Ann", "9"]] }));
    expect(screen.getByRole("dialog", { name: "Edit table" })).toBeInTheDocument();
    expect(cell(1, 1)).toHaveFocus();
    expect(cell(1, 2)).toHaveValue("Score");
    expect(cell(2, 1)).toHaveValue("Ann");
    expect(cellCount()).toBe(4);
    expect(screen.getByText("Column 1")).toBeInTheDocument();
    expect(screen.getByText("Column 2")).toBeInTheDocument();
    expect(cell(1, 1)).toHaveAttribute("maxLength", String(MAX_TABLE_CELL_LENGTH));
  });

  it("edits cells and saves them as one undo step", async () => {
    const user = userEvent.setup();
    const { onClose } = setup();
    await user.type(cell(2, 1), "Alpha");
    await user.type(cell(3, 3), "Line 1{Enter}Line 2");
    await user.clear(cell(1, 2));
    await user.type(cell(1, 2), "Owner");
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(saved().rows).toEqual([
      ["Header 1", "Owner", "Header 3"],
      ["Alpha", "", ""],
      ["", "", "Line 1\nLine 2"],
    ]);
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(editor().past).toHaveLength(1);
  });

  it("saving without changes records nothing", async () => {
    const user = userEvent.setup();
    const { onClose, table } = setup();
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(onClose).toHaveBeenCalled();
    expect(saved()).toEqual(table);
    expect(editor().past).toHaveLength(0);
  });

  it("toggles the header row", async () => {
    const user = userEvent.setup();
    setup();
    const toggle = screen.getByRole("checkbox", { name: "First row is a header" });
    expect(toggle).toBeChecked();
    expect(cell(1, 1)).toHaveClass("font-semibold");
    expect(cell(2, 1)).not.toHaveClass("font-semibold");
    await user.click(toggle);
    expect(toggle).not.toBeChecked();
    expect(cell(1, 1)).not.toHaveClass("font-semibold");
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(saved().headerRow).toBe(false);
  });

  it("turns the header row on", async () => {
    const user = userEvent.setup();
    setup(createTableElement({ headerRow: false }));
    expect(screen.getByRole("checkbox", { name: "First row is a header" })).not.toBeChecked();
    await user.click(screen.getByRole("checkbox", { name: "First row is a header" }));
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(saved().headerRow).toBe(true);
  });

  it("adds rows and columns", async () => {
    const user = userEvent.setup();
    setup();
    await user.click(screen.getByRole("button", { name: "Add row" }));
    await user.click(screen.getByRole("button", { name: "Add column" }));
    expect(rowCount()).toBe(4);
    expect(columnCount()).toBe(4);
    expect(cell(4, 4)).toHaveValue("");
    await user.type(cell(4, 4), "corner");
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(saved().rows).toEqual([
      ["Header 1", "Header 2", "Header 3", ""],
      ["", "", "", ""],
      ["", "", "", ""],
      ["", "", "", "corner"],
    ]);
  });

  it("removes rows and columns", async () => {
    const user = userEvent.setup();
    setup(createTableElement({ rows: grid(3, 3) }));
    await user.click(screen.getByRole("button", { name: "Remove row 2" }));
    await user.click(screen.getByRole("button", { name: "Remove column 1" }));
    expect(rowCount()).toBe(2);
    expect(columnCount()).toBe(2);
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(saved().rows).toEqual([
      ["0,1", "0,2"],
      ["2,1", "2,2"],
    ]);
  });

  it("can't remove the last row or column", async () => {
    const user = userEvent.setup();
    setup(createTableElement({ rows: [["a", "b"]] }));
    expect(screen.getByRole("button", { name: "Remove row 1" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Remove column 1" })).toBeEnabled();
    await user.click(screen.getByRole("button", { name: "Remove column 2" }));
    expect(screen.getByRole("button", { name: "Remove column 1" })).toBeDisabled();
    expect(cellCount()).toBe(1);
  });

  it("can't add rows or columns beyond the limits", () => {
    setup(createTableElement({ rows: grid(MAX_TABLE_ROWS, MAX_TABLE_COLS) }));
    const addRow = screen.getByRole("button", { name: "Add row" });
    const addColumn = screen.getByRole("button", { name: "Add column" });
    expect(addRow).toBeDisabled();
    expect(addRow).toHaveAttribute("title", `Up to ${MAX_TABLE_ROWS} rows`);
    expect(addColumn).toBeDisabled();
    expect(addColumn).toHaveAttribute("title", `Up to ${MAX_TABLE_COLS} columns`);
  });

  it("stops adding at the limits", async () => {
    const user = userEvent.setup();
    setup(createTableElement({ rows: grid(MAX_TABLE_ROWS - 1, MAX_TABLE_COLS - 1) }));
    const addRow = screen.getByRole("button", { name: "Add row" });
    const addColumn = screen.getByRole("button", { name: "Add column" });
    expect(addRow).toBeEnabled();
    expect(addRow).not.toHaveAttribute("title");
    await user.click(addRow);
    await user.click(addColumn);
    expect(addRow).toBeDisabled();
    expect(addColumn).toBeDisabled();
    expect(rowCount()).toBe(MAX_TABLE_ROWS);
    expect(columnCount()).toBe(MAX_TABLE_COLS);
  });

  describe("pasting", () => {
    it("fills the grid from the cell that received tab-separated text", async () => {
      const user = userEvent.setup();
      setup();
      await pasteInto(user, cell(2, 2), "a\tb\tc\nd\te\tf\n");
      expect(cell(2, 2)).toHaveValue("a");
      expect(columnCount()).toBe(4);
      expect(rowCount()).toBe(3);
      expect(screen.queryByRole("status")).not.toBeInTheDocument();
      await user.click(screen.getByRole("button", { name: "Save" }));
      expect(saved().rows).toEqual([
        ["Header 1", "Header 2", "Header 3", ""],
        ["", "a", "b", "c"],
        ["", "d", "e", "f"],
      ]);
    });

    it("adds rows for a taller block", async () => {
      const user = userEvent.setup();
      setup();
      await pasteInto(user, cell(3, 1), "1\t2\n3\t4\n5\t6");
      expect(rowCount()).toBe(5);
      expect(cell(5, 2)).toHaveValue("6");
    });

    it("keeps the native paste for text that isn't tabular", async () => {
      const user = userEvent.setup();
      setup();
      await pasteInto(user, cell(2, 1), "Hello, world\nSecond line");
      expect(cell(2, 1)).toHaveValue("Hello, world\nSecond line");
      expect(cellCount()).toBe(9);
      await user.click(screen.getByRole("button", { name: "Save" }));
      expect(saved().rows[1][0]).toBe("Hello, world\nSecond line");
    });

    it("tells when cells beyond the limits were left out", async () => {
      const user = userEvent.setup();
      setup();
      const wide = Array.from({ length: MAX_TABLE_COLS + 2 }, (_, c) => `c${c}`).join("\t");
      await pasteInto(user, cell(1, 1), wide);
      expect(screen.getByRole("status")).toHaveTextContent(TRUNCATED_NOTICE);
      expect(columnCount()).toBe(MAX_TABLE_COLS);
      expect(cell(1, MAX_TABLE_COLS)).toHaveValue(`c${MAX_TABLE_COLS - 1}`);
    });

    it("tells when too many rows were pasted", async () => {
      const user = userEvent.setup();
      setup();
      const tall = Array.from({ length: MAX_TABLE_ROWS + 5 }, (_, r) => `r${r}\tx`).join("\n");
      await pasteInto(user, cell(1, 1), tall);
      expect(screen.getByRole("status")).toHaveTextContent(TRUNCATED_NOTICE);
      expect(rowCount()).toBe(MAX_TABLE_ROWS);
      expect(screen.getByRole("button", { name: "Add row" })).toBeDisabled();
    });

    it("tells when long cells were cut", async () => {
      const user = userEvent.setup();
      setup();
      await pasteInto(user, cell(2, 1), `${"y".repeat(MAX_TABLE_CELL_LENGTH + 10)}\tshort`);
      expect(screen.getByRole("status")).toHaveTextContent(TRUNCATED_NOTICE);
      expect((cell(2, 1) as HTMLTextAreaElement).value).toHaveLength(MAX_TABLE_CELL_LENGTH);
      expect(cell(2, 2)).toHaveValue("short");
    });

    it("clears the notice after a paste that fits, but not after a plain-text paste", async () => {
      const user = userEvent.setup();
      setup();
      const wide = Array.from({ length: MAX_TABLE_COLS + 1 }, (_, c) => `c${c}`).join("\t");
      await pasteInto(user, cell(1, 1), wide);
      expect(screen.getByRole("status")).toBeInTheDocument();
      await pasteInto(user, cell(2, 1), "just text");
      expect(screen.getByRole("status")).toBeInTheDocument();
      await pasteInto(user, cell(3, 1), "a\tb");
      expect(screen.queryByRole("status")).not.toBeInTheDocument();
    });
  });

  describe("saving the size", () => {
    it("keeps the row height when rows are added", async () => {
      const user = userEvent.setup();
      // 3 rows in 192px → 64px per row.
      setup(createTableElement({ height: 192 }));
      await user.click(screen.getByRole("button", { name: "Add row" }));
      await user.click(screen.getByRole("button", { name: "Save" }));
      expect(saved().height).toBe(256);
      expect(saved().rows).toHaveLength(4);
    });

    it("shrinks when rows are removed", async () => {
      const user = userEvent.setup();
      setup(createTableElement({ height: 192 }));
      await user.click(screen.getByRole("button", { name: "Remove row 3" }));
      await user.click(screen.getByRole("button", { name: "Remove row 2" }));
      await user.click(screen.getByRole("button", { name: "Save" }));
      expect(saved().height).toBe(64);
      expect(saved().rows).toEqual([["Header 1", "Header 2", "Header 3"]]);
    });

    it("grows with pasted rows but never beyond the slide height", async () => {
      const user = userEvent.setup();
      setup(createTableElement({ rows: [["a"], ["b"]], height: 400, y: 100 }));
      await pasteInto(user, cell(2, 1), "1\tx\n2\tx\n3\tx");
      await user.click(screen.getByRole("button", { name: "Save" }));
      expect(saved().rows).toHaveLength(4);
      expect(saved().height).toBe(SLIDE_HEIGHT);
    });

    it("keeps at least 24px", async () => {
      const user = userEvent.setup();
      setup(createTableElement({ rows: [["a"], ["b"]], height: 20 }));
      await user.click(screen.getByRole("button", { name: "Remove row 2" }));
      await user.click(screen.getByRole("button", { name: "Save" }));
      expect(saved().height).toBe(24);
    });

    it("updates the cells of a locked table without resizing it", async () => {
      const user = userEvent.setup();
      setup(createTableElement({ height: 192, locked: true }));
      await user.click(screen.getByRole("button", { name: "Add row" }));
      await user.type(cell(4, 1), "new");
      await user.click(screen.getByRole("button", { name: "Save" }));
      expect(saved().rows).toHaveLength(4);
      expect(saved().rows[3][0]).toBe("new");
      expect(saved().height).toBe(192);
    });
  });

  it("cancel leaves the store untouched", async () => {
    const user = userEvent.setup();
    const { onClose, table } = setup();
    await user.type(cell(2, 1), "draft");
    await user.click(screen.getByRole("checkbox", { name: "First row is a header" }));
    await user.click(screen.getByRole("button", { name: "Add row" }));
    await pasteInto(user, cell(1, 1), "x\ty\tz\tw");
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(saved()).toEqual(table);
    expect(editor().past).toHaveLength(0);
  });

  it("closing with Escape or the close button leaves the store untouched", async () => {
    const user = userEvent.setup();
    const { onClose, table } = setup();
    await user.type(cell(2, 1), "draft");
    await user.keyboard("{Escape}");
    await user.click(screen.getByRole("button", { name: "Close" }));
    expect(onClose).toHaveBeenCalledTimes(2);
    expect(saved()).toEqual(table);
  });
});
