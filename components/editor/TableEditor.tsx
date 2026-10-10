"use client";

import { useState } from "react";
import { Plus, X } from "lucide-react";
import { MAX_TABLE_CELL_LENGTH, MAX_TABLE_COLS, MAX_TABLE_ROWS, SLIDE_HEIGHT } from "@/lib/constants";
import type { TableElement } from "@/lib/schema";
import { useEditorStore } from "@/lib/store/editorStore";
import { looksTabular, parseDelimited } from "@/lib/tabular";
import Modal from "../ui/Modal";

interface TableEditorProps {
  slideId: string;
  table: TableElement;
  onClose: () => void;
}

/**
 * Writes pasted cells into the grid starting at (row, col), adding rows and columns as needed
 * (within the table limits). Returns the new grid and whether anything had to be left out.
 */
export function pasteIntoGrid(grid: string[][], row: number, col: number, block: string[][]): { rows: string[][]; truncated: boolean } {
  const blockWidth = Math.max(0, ...block.map((r) => r.length));
  const neededRows = Math.min(MAX_TABLE_ROWS, Math.max(grid.length, row + block.length));
  const neededCols = Math.min(MAX_TABLE_COLS, Math.max(grid[0]?.length ?? 0, col + blockWidth));
  const rows = Array.from({ length: neededRows }, (_, r) => Array.from({ length: neededCols }, (_, c) => grid[r]?.[c] ?? ""));
  let truncated = row + block.length > MAX_TABLE_ROWS || col + blockWidth > MAX_TABLE_COLS;
  block.forEach((cells, r) => {
    cells.forEach((cell, c) => {
      const tr = row + r;
      const tc = col + c;
      if (tr >= neededRows || tc >= neededCols) return;
      if (cell.length > MAX_TABLE_CELL_LENGTH) truncated = true;
      rows[tr][tc] = cell.slice(0, MAX_TABLE_CELL_LENGTH);
    });
  });
  return { rows, truncated };
}

const cellClass =
  "block min-h-8 w-full resize-none rounded-md border border-neutral-200 px-2 py-1 text-sm leading-5 focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/20";
const smallButton =
  "inline-flex h-8 items-center gap-1 rounded-md border border-neutral-200 px-3 text-sm text-neutral-700 hover:bg-neutral-50 disabled:cursor-not-allowed disabled:opacity-40";
const removeButton = "rounded p-1 text-neutral-400 hover:bg-neutral-100 hover:text-neutral-700 disabled:invisible";

/** Modal grid for editing a table's cells, rows and columns. Pasting spreadsheet cells fills the grid. */
export default function TableEditor({ slideId, table, onClose }: TableEditorProps) {
  const [rows, setRows] = useState<string[][]>(table.rows.map((r) => [...r]));
  const [headerRow, setHeaderRow] = useState(table.headerRow);
  const [notice, setNotice] = useState<string | null>(null);
  const cols = rows[0]?.length ?? 0;

  const setCell = (r: number, c: number, value: string) => setRows((all) => all.map((row, ri) => (ri === r ? row.map((cell, ci) => (ci === c ? value : cell)) : row)));
  const addRow = () => setRows((all) => [...all, Array.from({ length: cols }, () => "")]);
  const addColumn = () => setRows((all) => all.map((row) => [...row, ""]));
  const removeRow = (r: number) => setRows((all) => all.filter((_, i) => i !== r));
  const removeColumn = (c: number) => setRows((all) => all.map((row) => row.filter((_, i) => i !== c)));

  const save = () => {
    const { updateElement } = useEditorStore.getState();
    // Keep the row height roughly the same when rows are added or removed.
    const rowHeight = table.height / Math.max(1, table.rows.length);
    const height = Math.min(SLIDE_HEIGHT, Math.max(rowHeight * rows.length, 24));
    updateElement(slideId, table.id, { rows, headerRow, height });
    onClose();
  };

  const onPaste = (event: React.ClipboardEvent<HTMLTextAreaElement>, r: number, c: number) => {
    const text = event.clipboardData.getData("text/plain");
    if (!looksTabular(text)) return;
    event.preventDefault();
    const result = pasteIntoGrid(rows, r, c, parseDelimited(text, "\t"));
    setRows(result.rows);
    setNotice(result.truncated ? `Tables can have up to ${MAX_TABLE_ROWS} rows and ${MAX_TABLE_COLS} columns; extra cells were left out.` : null);
  };

  return (
    <Modal
      title="Edit table"
      onClose={onClose}
      width={Math.min(1000, 200 + cols * 170)}
      footer={
        <>
          <button type="button" onClick={onClose} className="h-9 rounded-md border border-neutral-200 px-4 text-sm font-medium text-neutral-700 hover:bg-neutral-50">
            Cancel
          </button>
          <button type="button" onClick={save} className="h-9 rounded-md bg-indigo-600 px-4 text-sm font-medium text-white hover:bg-indigo-700">
            Save
          </button>
        </>
      }
    >
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <label className="inline-flex items-center gap-2 text-sm text-neutral-700">
          <input type="checkbox" checked={headerRow} onChange={(e) => setHeaderRow(e.target.checked)} className="h-4 w-4 accent-indigo-600" />
          First row is a header
        </label>
        <p className="text-xs text-neutral-500">Tip: paste cells copied from Excel, Numbers or Google Sheets into any cell to fill the table from there.</p>
      </div>

      {notice && (
        <p role="status" className="mt-3 rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-800">
          {notice}
        </p>
      )}

      <div className="mt-4 overflow-x-auto">
        <table className="w-full border-separate border-spacing-1">
          <thead>
            <tr>
              {Array.from({ length: cols }, (_, c) => (
                <th key={c} className="min-w-32 text-left">
                  <div className="flex items-center justify-between text-xs font-medium text-neutral-500">
                    <span>Column {c + 1}</span>
                    <button type="button" aria-label={`Remove column ${c + 1}`} disabled={cols === 1} onClick={() => removeColumn(c)} className={removeButton}>
                      <X size={14} aria-hidden />
                    </button>
                  </div>
                </th>
              ))}
              <th className="w-8" />
            </tr>
          </thead>
          <tbody>
            {rows.map((row, r) => (
              <tr key={r}>
                {row.map((cell, c) => (
                  <td key={c} className="align-top">
                    <textarea
                      rows={1}
                      aria-label={`Row ${r + 1}, column ${c + 1}`}
                      value={cell}
                      maxLength={MAX_TABLE_CELL_LENGTH}
                      data-autofocus={r === 0 && c === 0 ? true : undefined}
                      onChange={(e) => setCell(r, c, e.target.value)}
                      onPaste={(e) => onPaste(e, r, c)}
                      className={`${cellClass} ${headerRow && r === 0 ? "bg-neutral-50 font-semibold" : ""}`}
                    />
                  </td>
                ))}
                <td className="align-top">
                  <button type="button" aria-label={`Remove row ${r + 1}`} disabled={rows.length === 1} onClick={() => removeRow(r)} className={removeButton}>
                    <X size={14} aria-hidden />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="mt-3 flex gap-2">
        <button type="button" onClick={addRow} disabled={rows.length >= MAX_TABLE_ROWS} title={rows.length >= MAX_TABLE_ROWS ? `Up to ${MAX_TABLE_ROWS} rows` : undefined} className={smallButton}>
          <Plus size={14} aria-hidden />
          Add row
        </button>
        <button type="button" onClick={addColumn} disabled={cols >= MAX_TABLE_COLS} title={cols >= MAX_TABLE_COLS ? `Up to ${MAX_TABLE_COLS} columns` : undefined} className={smallButton}>
          <Plus size={14} aria-hidden />
          Add column
        </button>
      </div>
    </Modal>
  );
}
