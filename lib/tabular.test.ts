import { describe, expect, it } from "vitest";
import { looksTabular, parseDelimited, parseNumber, rectangularize, toTsv } from "./tabular";

describe("parseDelimited", () => {
  it("splits tab-separated rows and cells", () => {
    expect(parseDelimited("a\tb\nc\td")).toEqual([
      ["a", "b"],
      ["c", "d"],
    ]);
  });

  it("handles quoted cells containing delimiters", () => {
    expect(parseDelimited('"a,b",c', ",")).toEqual([["a,b", "c"]]);
    expect(parseDelimited('"x\ty"\tz')).toEqual([["x\ty", "z"]]);
  });

  it("unescapes doubled quotes inside quoted cells", () => {
    expect(parseDelimited('"say ""hi""",x', ",")).toEqual([['say "hi"', "x"]]);
    expect(parseDelimited('""""\t1')).toEqual([['"', "1"]]);
  });

  it("keeps newlines inside quoted cells", () => {
    expect(parseDelimited('"line1\nline2"\tz\nnext\trow')).toEqual([
      ["line1\nline2", "z"],
      ["next", "row"],
    ]);
  });

  it("treats a quote in the middle of a cell literally", () => {
    expect(parseDelimited('5" disk,ok', ",")).toEqual([['5" disk', "ok"]]);
  });

  it("reads an unterminated quote to the end of the text", () => {
    expect(parseDelimited('"abc\tdef')).toEqual([["abc\tdef"]]);
  });

  it("normalizes CRLF and lone CR line endings", () => {
    expect(parseDelimited("a\tb\r\nc\td\r\n")).toEqual([
      ["a", "b"],
      ["c", "d"],
    ]);
    expect(parseDelimited("a\rb")).toEqual([["a"], ["b"]]);
    expect(parseDelimited('"x\r\ny"\t1')).toEqual([["x\ny", "1"]]);
  });

  it("drops trailing blank rows but keeps blank rows in the middle", () => {
    expect(parseDelimited("a\tb\n\n\t\n  \n")).toEqual([["a", "b"]]);
    expect(parseDelimited("a\n\nb")).toEqual([["a"], [""], ["b"]]);
  });

  it("keeps empty cells, including a trailing one", () => {
    expect(parseDelimited("a\t\tc")).toEqual([["a", "", "c"]]);
    expect(parseDelimited("a\t")).toEqual([["a", ""]]);
    expect(parseDelimited("\tb")).toEqual([["", "b"]]);
  });

  it("trims whitespace around cells", () => {
    expect(parseDelimited("  a \t b  \n c\td ")).toEqual([
      ["a", "b"],
      ["c", "d"],
    ]);
    expect(parseDelimited('" padded "\tx')).toEqual([["padded", "x"]]);
  });

  it("returns no rows for empty or blank text", () => {
    expect(parseDelimited("")).toEqual([]);
    expect(parseDelimited("\n\n")).toEqual([]);
    expect(parseDelimited(" \t \n")).toEqual([]);
  });

  it("detects the delimiter: tabs win, otherwise commas", () => {
    expect(parseDelimited("1,200\t3\n4\t5,5")).toEqual([
      ["1,200", "3"],
      ["4", "5,5"],
    ]);
    expect(parseDelimited("Region,Sales\nNorth,10")).toEqual([
      ["Region", "Sales"],
      ["North", "10"],
    ]);
    expect(parseDelimited("just one cell")).toEqual([["just one cell"]]);
  });

  it("uses an explicit delimiter when given", () => {
    expect(parseDelimited("a,b\tc", ",")).toEqual([["a", "b\tc"]]);
    expect(parseDelimited("a,b\nc", "\t")).toEqual([["a,b"], ["c"]]);
  });
});

describe("rectangularize", () => {
  it("pads short rows with empty cells", () => {
    expect(rectangularize([["a"], ["b", "c", "d"], []])).toEqual([
      ["a", "", ""],
      ["b", "c", "d"],
      ["", "", ""],
    ]);
  });

  it("leaves rectangular and empty input alone without mutating it", () => {
    const rows = [["a", "b"], ["c"]];
    const copy = structuredClone(rows);
    rectangularize(rows);
    expect(rows).toEqual(copy);
    expect(rectangularize([["x", "y"]])).toEqual([["x", "y"]]);
    expect(rectangularize([])).toEqual([]);
  });
});

describe("looksTabular", () => {
  it("is true for tab-separated text", () => {
    expect(looksTabular("a\tb")).toBe(true);
    expect(looksTabular("Name\tScore\nAnn\t3\n")).toBe(true);
    expect(looksTabular("  a\tb  ")).toBe(true);
  });

  it("is false for prose, comma-separated text and stray tabs at the edges", () => {
    expect(looksTabular("Hello, world")).toBe(false);
    expect(looksTabular("a,b\nc,d")).toBe(false);
    expect(looksTabular("")).toBe(false);
    expect(looksTabular("\t")).toBe(false);
    expect(looksTabular("\tindented line\n")).toBe(false);
  });
});

describe("toTsv", () => {
  it("joins cells with tabs and rows with newlines", () => {
    expect(toTsv([["a", "b"], ["c", "d"]])).toBe("a\tb\nc\td");
    expect(toTsv([])).toBe("");
  });

  it("quotes cells with tabs, newlines or quotes and doubles the quotes", () => {
    expect(toTsv([["x\ty", "two\nlines", 'say "hi"', "plain, with comma"]])).toBe('"x\ty"\t"two\nlines"\t"say ""hi"""\tplain, with comma');
  });

  it("round-trips through parseDelimited", () => {
    const rows = [
      ["Name", "Notes", "Quote"],
      ["Ann", "first\nsecond", 'she said "yes"'],
      ["", "tab\there", "1,200"],
      ['"', "", "end"],
    ];
    expect(parseDelimited(toTsv(rows))).toEqual(rows);
    // A single column has no tabs, so the delimiter must be given explicitly.
    const column = [["a,b"], ["c"]];
    expect(parseDelimited(toTsv(column), "\t")).toEqual(column);
  });
});

describe("parseNumber", () => {
  it.each([
    ["1,200", 1200],
    ["$45", 45],
    ["12%", 12],
    [" -3.5 ", -3.5],
    ["€1 000", 1000],
    ["£7", 7],
    ["¥3", 3],
    ["0", 0],
    ["1e3", 1000],
    ["-0.25", -0.25],
  ])("parses %j as %s", (raw, expected) => {
    expect(parseNumber(raw)).toBe(expected);
  });

  it.each(["", "   ", "abc", "12abc", "-", "$", "Infinity", "1.2.3", "NaN"])("returns null for %j", (raw) => {
    expect(parseNumber(raw)).toBeNull();
  });
});
