import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { detectDecimal, formatMinor, parseAmount } from "../src";

describe("parseAmount", () => {
  it.each([
    ["12.50", 1250],
    ["-12.50", -1250],
    ["12.50-", -1250],
    ["(12.50)", -1250],
    ["+12.50", 1250],
    ["−12.50", -1250],
    ["$1,234.56", 123456],
    ["-$1,234.56", -123456],
    ["$-1,234.56", -123456],
    ["USD 1,234.56", 123456],
    ["12.50 CR", 1250],
    ["12.50 DR", -1250],
    ["12.50DR", -1250],
    ["1'234.50", 123450],
    ["0.005", 1],
    ["0.004", 0],
    ["12", 1200],
    [".5", 50],
    ["1,000,000", 100_000_000],
  ])("%s → %i", (raw, want) => {
    expect(parseAmount(raw)).toBe(want);
  });

  it.each([
    ["1.234,56", 123456],
    ["-1.234,56", -123456],
    ["1 234,56 €", 123456],
    ["1 234,56", 123456],
    ["12,5", 1250],
    ["-0,99", -99],
  ])("decimal comma: %s → %i", (raw, want) => {
    expect(parseAmount(raw, ",")).toBe(want);
  });

  it.each(["", " ", "-", "abc", "12.3.4", "--12", "N/A"])("rejects %j", (raw) => {
    expect(parseAmount(raw)).toBeNull();
  });

  it("supports other minor units", () => {
    expect(parseAmount("1,234", ".", 0)).toBe(1234);
    expect(parseAmount("1.234", ".", 3)).toBe(1234);
  });

  it("never returns -0", () => {
    expect(Object.is(parseAmount("-0.00"), 0)).toBe(true);
  });

  it("round-trips any amount through formatMinor (dot and comma)", () => {
    fc.assert(
      fc.property(fc.integer({ min: -1e12, max: 1e12 }), (n) => {
        const s = formatMinor(n);
        expect(parseAmount(s)).toBe(n);
        expect(parseAmount(s.replace(".", ","), ",")).toBe(n);
      }),
    );
  });

  it("round-trips US and European thousands formatting", () => {
    fc.assert(
      fc.property(fc.integer({ min: -1e11, max: 1e11 }), (n) => {
        const opts = { minimumFractionDigits: 2, maximumFractionDigits: 2 };
        const us = (n < 0 ? "-" : "") + (Math.abs(n) / 100).toLocaleString("en-US", opts);
        const de = (n < 0 ? "-" : "") + (Math.abs(n) / 100).toLocaleString("de-DE", opts);
        expect(parseAmount(us)).toBe(n);
        expect(parseAmount(de, ",")).toBe(n);
      }),
    );
  });
});

describe("detectDecimal", () => {
  it("votes on the whole sample", () => {
    expect(detectDecimal(["-12,50", "1.234,56", "3,00"]).decimal).toBe(",");
    expect(detectDecimal(["-12.50", "1,234.56", "3.00"]).decimal).toBe(".");
    expect(detectDecimal(["1,234", "12"]).decimal).toBe(".");
  });
});

describe("formatMinor", () => {
  it("formats", () => {
    expect(formatMinor(-123456)).toBe("-1234.56");
    expect(formatMinor(5)).toBe("0.05");
    expect(formatMinor(1234, 0)).toBe("1234");
  });
});
