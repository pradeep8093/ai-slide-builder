/**
 * Parsing and formatting of spreadsheet-style text: tab-separated values (what Excel, Numbers and
 * Google Sheets put on the clipboard) and comma-separated values (CSV files), including quoted cells.
 */

function detectDelimiter(text: string): "\t" | "," {
  return text.includes("\t") ? "\t" : ",";
}

/** Splits delimited text into rows of cells. Handles "quoted" cells with delimiters, newlines and "" escapes. */
export function parseDelimited(text: string, delimiter: "\t" | "," = detectDelimiter(text)): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  const input = text.replace(/\r\n?/g, "\n");

  for (let i = 0; i < input.length; i += 1) {
    const ch = input[i];
    if (quoted) {
      if (ch === '"') {
        if (input[i + 1] === '"') {
          cell += '"';
          i += 1;
        } else {
          quoted = false;
        }
      } else {
        cell += ch;
      }
    } else if (ch === '"' && cell === "") {
      quoted = true;
    } else if (ch === delimiter) {
      row.push(cell);
      cell = "";
    } else if (ch === "\n") {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else {
      cell += ch;
    }
  }
  if (cell !== "" || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }
  // Drop trailing blank lines (spreadsheets usually end the clipboard text with a newline).
  while (rows.length > 0 && rows[rows.length - 1].every((c) => c.trim() === "")) rows.pop();
  return rows.map((r) => r.map((c) => c.trim()));
}

/** Pads rows with empty cells so every row has the same number of columns. */
export function rectangularize(rows: string[][]): string[][] {
  const width = Math.max(0, ...rows.map((r) => r.length));
  return rows.map((r) => [...r, ...Array.from({ length: width - r.length }, () => "")]);
}

/**
 * Whether pasted text is a block of spreadsheet cells. Excel, Numbers and Google Sheets copy cells
 * as tab-separated text; comma-separated text is only treated as data where the user explicitly
 * pastes data (so ordinary prose with commas never turns into a table).
 */
export function looksTabular(text: string): boolean {
  return text.trim().includes("\t");
}

function escapeTsvCell(cell: string): string {
  return /[\t\n"]/.test(cell) ? `"${cell.replace(/"/g, '""')}"` : cell;
}

/** Formats rows as tab-separated text that spreadsheets paste into separate cells. */
export function toTsv(rows: string[][]): string {
  return rows.map((r) => r.map(escapeTsvCell).join("\t")).join("\n");
}

/** Parses a number from a spreadsheet cell: "1,200", "$45", "12%", " -3.5 ". Returns null otherwise. */
export function parseNumber(raw: string): number | null {
  const cleaned = raw.trim().replace(/[\s,$€£¥%]/g, "");
  if (!cleaned) return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}
