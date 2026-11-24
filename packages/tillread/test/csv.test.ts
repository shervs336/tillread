import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { decode, detectDelimiter, stringify, tokenize } from "../src";

describe("tokenize", () => {
  it("handles quotes, doubled quotes and line breaks in cells", () => {
    const rows = tokenize('a,"b, c","say ""hi"""\r\n1,"two\nlines",3\n\n,x,');
    expect(rows.map((r) => r.cells)).toEqual([
      ["a", "b, c", 'say "hi"'],
      ["1", "two\nlines", "3"],
      ["", "x", ""],
    ]);
    expect(rows.map((r) => r.line)).toEqual([1, 2, 5]);
  });
  it("trims unquoted cells and ignores spaces after a closing quote", () => {
    expect(tokenize('  a ,"b"  , c')[0]!.cells).toEqual(["a", "b", "c"]);
  });
  it("handles a file without a final newline and old Mac line endings", () => {
    expect(tokenize("a,b\rc,d").map((r) => r.cells)).toEqual([
      ["a", "b"],
      ["c", "d"],
    ]);
  });

  it("round-trips any table through stringify", () => {
    const cell = fc.string({ unit: fc.constantFrom("a", "b", " ", ",", ";", '"', "\n", "\r\n", "é", "1", "\t", "|") });
    const table = fc
      .integer({ min: 1, max: 6 })
      .chain((w) => fc.array(fc.array(cell, { minLength: w, maxLength: w }), { minLength: 1, maxLength: 8 }));
    fc.assert(
      fc.property(table, fc.constantFrom(",", ";", "\t", "|"), (rows, d) => {
        const kept = rows.filter((r) => r.some((c) => c !== ""));
        const back = tokenize(stringify(rows, d), d).map((r) => r.cells);
        expect(back).toEqual(kept);
      }),
    );
  });
});

describe("detectDelimiter", () => {
  it.each([
    ["a,b,c\n1,2,3", ","],
    ["a;b;c\n1;-2,50;3", ";"],
    ["a\tb\tc\n1\t2\t3", "\t"],
    ["a|b|c\n1|2|3", "|"],
    ['"Date";"Amount"\n"01.02.26";"-1.234,56"\n"02.02.26";"12,00"', ";"],
  ])("%j → %j", (text, want) => {
    expect(detectDelimiter(text)).toBe(want);
  });
});

describe("decode", () => {
  const text = "Date,Description\n2026-01-01,Café Glück";
  it("reads UTF-8 with and without a BOM", () => {
    expect(decode(new TextEncoder().encode(text))).toBe(text);
    expect(decode(new Uint8Array([0xef, 0xbb, 0xbf, ...new TextEncoder().encode(text)]))).toBe(text);
    expect(decode("﻿" + text)).toBe(text);
  });
  it("reads UTF-16 with and without a BOM", () => {
    const le = Buffer.from(text, "utf16le");
    expect(decode(new Uint8Array([0xff, 0xfe, ...le]))).toBe(text);
    expect(decode(new Uint8Array(le))).toBe(text);
    const be = Buffer.from(le).swap16();
    expect(decode(new Uint8Array([0xfe, 0xff, ...be]))).toBe(text);
    expect(decode(new Uint8Array(be))).toBe(text);
  });
  it("falls back to Windows-1252 for invalid UTF-8", () => {
    expect(decode(new Uint8Array(Buffer.from(text, "latin1")))).toBe(text);
  });
  it("accepts an ArrayBuffer", () => {
    const u = new TextEncoder().encode(text);
    expect(decode(u.buffer.slice(u.byteOffset, u.byteOffset + u.byteLength))).toBe(text);
  });
});
