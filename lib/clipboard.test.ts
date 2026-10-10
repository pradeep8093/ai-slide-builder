import { describe, expect, it } from "vitest";
import {
  chartToGrid,
  elementPlainText,
  plainTextForElements,
  plainTextForSlides,
  tableFromText,
  textElementFromText,
} from "./clipboard";
import { MAX_TABLE_CELL_LENGTH, MAX_TABLE_COLS, MAX_TABLE_ROWS, MAX_TEXT_LENGTH, SLIDE_HEIGHT, SLIDE_WIDTH } from "./constants";
import {
  createChartElement,
  createImageElement,
  createShapeElement,
  createSlide,
  createTableElement,
  createTextElement,
} from "./factory";
import { tableElementSchema, textElementSchema } from "./schema";

/** n rows × m columns of tab-separated cells named r{row}c{col}. */
function grid(rows: number, cols: number): string {
  return Array.from({ length: rows }, (_, r) => Array.from({ length: cols }, (_, c) => `r${r}c${c}`).join("\t")).join("\n");
}

describe("chartToGrid", () => {
  it("puts series names in the header row and one row per category", () => {
    const chart = createChartElement("bar", {
      categories: ["Q1", "Q2"],
      series: [
        { name: "North", values: [1, 2] },
        { name: "South", values: [3.5, -4] },
      ],
    });
    expect(chartToGrid(chart)).toEqual([
      ["", "North", "South"],
      ["Q1", "1", "3.5"],
      ["Q2", "2", "-4"],
    ]);
  });

  it("leaves missing values empty", () => {
    expect(chartToGrid({ categories: ["a", "b"], series: [{ name: "s", values: [7] }] })).toEqual([
      ["", "s"],
      ["a", "7"],
      ["b", ""],
    ]);
  });
});

describe("elementPlainText", () => {
  it("returns the text of text boxes", () => {
    expect(elementPlainText(createTextElement({ text: "Hello\nworld" }))).toBe("Hello\nworld");
  });

  it("returns tables as tab-separated text, quoting special cells", () => {
    const table = createTableElement({ rows: [["Name", "Note"], ["Ann", 'said "hi"\nlater']] });
    expect(elementPlainText(table)).toBe('Name\tNote\nAnn\t"said ""hi""\nlater"');
  });

  it("returns chart data as a tab-separated grid", () => {
    const chart = createChartElement("line", { categories: ["Jan", "Feb"], series: [{ name: "Visits", values: [10, 20] }] });
    expect(elementPlainText(chart)).toBe("\tVisits\nJan\t10\nFeb\t20");
  });

  it("returns nothing for shapes and images", () => {
    expect(elementPlainText(createShapeElement("rectangle"))).toBe("");
    expect(elementPlainText(createImageElement("data:image/png;base64,AAAA", 10, 10, "Logo"))).toBe("");
  });
});

describe("plainTextForElements / plainTextForSlides", () => {
  it("joins the text of elements with blank lines, skipping elements without text", () => {
    const elements = [
      createTextElement({ text: "Title" }),
      createShapeElement("ellipse"),
      createTextElement({ text: "   " }),
      createTableElement({ rows: [["a", "b"]] }),
      createImageElement("data:image/png;base64,AAAA", 10, 10),
    ];
    expect(plainTextForElements(elements)).toBe("Title\n\na\tb");
    expect(plainTextForElements([])).toBe("");
    expect(plainTextForElements([createShapeElement("line")])).toBe("");
  });

  it("joins slides with blank lines, skipping slides without text", () => {
    const slides = [
      { ...createSlide(), elements: [createTextElement({ text: "One" }), createTextElement({ text: "Uno" })] },
      { ...createSlide(), elements: [createShapeElement("rectangle")] },
      createSlide(),
      { ...createSlide(), elements: [createTextElement({ text: "Two" })] },
    ];
    expect(plainTextForSlides(slides)).toBe("One\n\nUno\n\nTwo");
    expect(plainTextForSlides([])).toBe("");
  });
});

describe("tableFromText", () => {
  it("builds a centered, valid table from spreadsheet text", () => {
    const result = tableFromText("Name\tScore\nAnn\t3\n");
    expect(result).not.toBeNull();
    const { element, truncated } = result!;
    expect(truncated).toBe(false);
    expect(element.rows).toEqual([
      ["Name", "Score"],
      ["Ann", "3"],
    ]);
    expect(element).toMatchObject({ type: "table", headerRow: true, fontSize: 20, width: 360, height: 96 });
    expect(element.x).toBe((SLIDE_WIDTH - 360) / 2);
    expect(element.y).toBe((SLIDE_HEIGHT - 96) / 2);
    expect(tableElementSchema.safeParse(element).success).toBe(true);
  });

  it("also reads comma-separated text and pads ragged rows", () => {
    const { element } = tableFromText("a,b,c\n1\n2,3")!;
    expect(element.rows).toEqual([
      ["a", "b", "c"],
      ["1", "", ""],
      ["2", "3", ""],
    ]);
    expect(element.width).toBe(540);
  });

  it("sizes the font and height to the number of rows", () => {
    const eight = tableFromText(grid(8, 2))!.element;
    expect(eight).toMatchObject({ fontSize: 20, height: 8 * 44 });
    const ten = tableFromText(grid(10, 3))!.element;
    expect(ten).toMatchObject({ fontSize: 16, height: 10 * 35, width: 540 });
    expect(ten.y).toBe((SLIDE_HEIGHT - 350) / 2);
    const thirteen = tableFromText(grid(13, 2))!.element;
    expect(thirteen).toMatchObject({ fontSize: 14, height: 13 * 31 });
    const full = tableFromText(grid(MAX_TABLE_ROWS, 2))!.element;
    expect(full).toMatchObject({ fontSize: 14, height: SLIDE_HEIGHT - 80, y: 40 });
  });

  it("caps the width at the slide width minus a margin", () => {
    const { element } = tableFromText(grid(2, 8))!;
    expect(element).toMatchObject({ width: SLIDE_WIDTH - 80, x: 40 });
  });

  it("cuts rows, columns and long cells to the limits and says so", () => {
    const tall = tableFromText(grid(MAX_TABLE_ROWS + 5, 2))!;
    expect(tall.truncated).toBe(true);
    expect(tall.element.rows).toHaveLength(MAX_TABLE_ROWS);

    const wide = tableFromText(grid(2, MAX_TABLE_COLS + 2))!;
    expect(wide.truncated).toBe(true);
    expect(wide.element.rows[0]).toHaveLength(MAX_TABLE_COLS);
    expect(wide.element.rows[0].at(-1)).toBe(`r0c${MAX_TABLE_COLS - 1}`);

    const long = tableFromText(`${"x".repeat(MAX_TABLE_CELL_LENGTH + 1)}\tb`)!;
    expect(long.truncated).toBe(true);
    expect(long.element.rows[0][0]).toHaveLength(MAX_TABLE_CELL_LENGTH);
    expect(tableElementSchema.safeParse(long.element).success).toBe(true);
  });

  it("is not truncated exactly at the limits", () => {
    const result = tableFromText(grid(MAX_TABLE_ROWS, MAX_TABLE_COLS))!;
    expect(result.truncated).toBe(false);
    expect(result.element.rows).toHaveLength(MAX_TABLE_ROWS);
    expect(result.element.rows[0]).toHaveLength(MAX_TABLE_COLS);
    expect(tableFromText(`${"x".repeat(MAX_TABLE_CELL_LENGTH)}\tb`)!.truncated).toBe(false);
  });

  it("returns null when there is nothing to show", () => {
    expect(tableFromText("")).toBeNull();
    expect(tableFromText("\t\n\t\n")).toBeNull();
    expect(tableFromText('""\t""')).toBeNull();
    // Content beyond the column limit is cut away, leaving only empty cells.
    expect(tableFromText(`${"\t".repeat(MAX_TABLE_COLS)}x`)).toBeNull();
    // ...and the same for content below the row limit.
    expect(tableFromText(`${"\t\n".repeat(MAX_TABLE_ROWS)}x\ty`)).toBeNull();
  });
});

describe("textElementFromText", () => {
  it("creates a centered 24px text box at least 48px tall", () => {
    const el = textElementFromText("Hello");
    expect(el).toMatchObject({ type: "text", text: "Hello", fontSize: 24, width: 720, height: 48 });
    expect(el.x).toBe((SLIDE_WIDTH - 720) / 2);
    expect(el.y).toBe((SLIDE_HEIGHT - 48) / 2);
    expect(textElementSchema.safeParse(el).success).toBe(true);
    expect(textElementFromText("").height).toBe(48);
  });

  it("normalizes CRLF and CR line breaks and grows with the number of lines", () => {
    const el = textElementFromText("a\r\nb\rc");
    expect(el.text).toBe("a\nb\nc");
    expect(el.height).toBe(Math.ceil(3 * 24 * 1.2) + 8);
    expect(el.y).toBe(Math.round((SLIDE_HEIGHT - el.height) / 2));
  });

  it("counts long lines as wrapped lines (about 45 characters each)", () => {
    expect(textElementFromText("x".repeat(45)).height).toBe(48);
    expect(textElementFromText("x".repeat(90)).height).toBe(Math.ceil(2 * 24 * 1.2) + 8);
    expect(textElementFromText("x".repeat(91)).height).toBe(Math.ceil(3 * 24 * 1.2) + 8);
  });

  it("caps the text length and the box height", () => {
    const el = textElementFromText("y".repeat(MAX_TEXT_LENGTH + 100));
    expect(el.text).toHaveLength(MAX_TEXT_LENGTH);
    expect(el.height).toBe(SLIDE_HEIGHT - 80);
    expect(el.y).toBe(40);
    expect(textElementSchema.safeParse(el).success).toBe(true);
  });
});
