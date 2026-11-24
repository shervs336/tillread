import { describe, expect, it } from "vitest";
import { detect, parse, toCSV } from "../src";

describe("parse", () => {
  it("returns minor units, ISO dates and line numbers", () => {
    const { transactions } = parse("Date,Description,Amount\n2026-01-02,Coffee,-4.50\n2026-01-03,Pay,2000\n");
    expect(transactions).toEqual([
      { date: "2026-01-02", amount: -450, description: "Coffee", line: 2, raw: ["2026-01-02", "Coffee", "-4.50"] },
      { date: "2026-01-03", amount: 200000, description: "Pay", line: 3, raw: ["2026-01-03", "Pay", "2000"] },
    ]);
  });

  it("explains skipped rows instead of dropping them", () => {
    const { skipped } = parse(
      "Date,Description,Amount\n2026-01-02,Coffee,-4.50\nPending,Taxi,-9.00\n2026-01-04,Note,\n2026-01-05,Zero,0.00\n",
    );
    expect(skipped.map((s) => [s.line, s.reason])).toEqual([
      [3, "date"],
      [4, "amount"],
      [5, "zero"],
    ]);
  });

  it("ignores footer lines with no date and no amount", () => {
    const { skipped, transactions } = parse("Date,Description,Amount\n2026-01-02,Coffee,-4.50\nExported by MyBank,,\n");
    expect(transactions).toHaveLength(1);
    expect(skipped).toHaveLength(0);
  });

  it("lets every detection be overridden", () => {
    const text = "When,What,Out,In\n01/02/2026,Tea,3.00,\n01/03/2026,Gift,,20.00\n";
    expect(parse(text).detection.sign).toBe("split");
    const forced = parse(text, { dateFormat: "DMY", columns: { description: 1, debit: 2, credit: 3 } });
    expect(forced.transactions.map((t) => [t.date, t.amount])).toEqual([
      ["2026-02-01", -300],
      ["2026-03-01", 2000],
    ]);
    expect(parse(text, { sign: "split", maxRows: 1 }).transactions).toHaveLength(1);
  });

  it("warns when every date is ambiguous", () => {
    const d = detect("Date,Description,Amount\n01/02/2026,A,-1\n01/02/2026,B,-2\n");
    expect(d.warnings.join(" ")).toMatch(/day-first or month-first/);
    expect(d.confidence).toBeLessThan(0.7);
  });

  it("warns when it has to guess that positive means money out", () => {
    const r = parse("Date,Description,Amount\n2026-01-02,A,1.00\n2026-01-03,B,2.00\n");
    expect(r.detection.sign).toBe("inverted");
    expect(r.detection.warnings.length).toBeGreaterThan(0);
    expect(parse("Date,Description,Amount\n2026-01-02,A,1.00\n", { sign: "signed" }).transactions[0]!.amount).toBe(100);
  });

  it("handles a file with only a header", () => {
    const r = parse("Date,Description,Amount\n");
    expect(r.transactions).toEqual([]);
    expect(r.detection.warnings).toContain("No data rows found.");
  });

  it("handles empty input", () => {
    expect(parse("").transactions).toEqual([]);
  });

  it("supports currencies without cents", () => {
    expect(parse("Date,Description,Amount\n2026-01-02,Ramen,-1200\n", { minorUnits: 0 }).transactions[0]!.amount).toBe(-1200);
  });

  it("is fast: 100,000 rows in well under a second and a half", () => {
    const rows = ["Date,Description,Amount,Balance"];
    for (let i = 0; i < 100_000; i++) {
      rows.push(`2026-01-${String((i % 28) + 1).padStart(2, "0")},Shop ${i},-${(i % 500) + 1}.25,${i}.00`);
    }
    const t = performance.now();
    const r = parse(rows.join("\n"));
    const ms = performance.now() - t;
    expect(r.transactions).toHaveLength(100_000);
    expect(ms).toBeLessThan(1500);
  });
});

describe("toCSV", () => {
  it("writes a clean file that parses back to the same transactions", () => {
    const { transactions } = parse('Date,Description,Amount,Category\n2026-01-02,"Shop, Inc",-4.50,Food\n2026-01-03,Pay,2000,\n');
    const out = toCSV(transactions);
    expect(out).toBe('Date,Description,Amount,Category\r\n2026-01-02,"Shop, Inc",-4.50,Food\r\n2026-01-03,Pay,2000.00,');
    const strip = (ts: typeof transactions) => ts.map(({ date, amount, description }) => ({ date, amount, description }));
    expect(strip(parse(out).transactions)).toEqual(strip(transactions));
  });

  it("defuses spreadsheet formulas in text", () => {
    const out = toCSV([{ date: "2026-01-02", amount: -100, description: '=HYPERLINK("http://x")', line: 2, raw: [] }]);
    expect(out).toContain(`"'=HYPERLINK(""http://x"")"`);
    expect(out).toContain(",-1.00");
  });
});
