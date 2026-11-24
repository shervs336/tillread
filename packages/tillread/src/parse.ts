import { parseAmount } from "./amount.ts";
import { parseDate } from "./date.ts";
import { decode } from "./decode.ts";
import { analyze, directionOf } from "./detect.ts";
import type { Input, ParseOptions, ParseResult, SkippedRow, Transaction } from "./types.ts";

/**
 * Reads a bank CSV export into transactions.
 *
 * ```ts
 * import { parse } from "tillread";
 * const { transactions, skipped, detection } = parse(await file.text());
 * ```
 *
 * Amounts are integers in minor units (cents), negative for money out. Rows that look like data
 * but can't be read (totals, pending rows, typos) are returned in `skipped` with a reason, never
 * silently dropped.
 */
export function parse(input: Input, options: ParseOptions = {}): ParseResult {
  const text = decode(input);
  const { detection, rows, dataStart } = analyze(text, options);
  const { columns: col, decimal, dateFormat, sign } = detection;
  const minor = options.minorUnits ?? 2;
  const max = options.maxRows ?? 100_000;

  const transactions: Transaction[] = [];
  const skipped: SkippedRow[] = [];
  const cell = (cells: string[], c: number | undefined) => (c == null ? "" : (cells[c] ?? "").trim());
  const money = (cells: string[], c: number | undefined) => (c == null ? null : parseAmount(cells[c], decimal, minor));

  for (let i = dataStart; i < rows.length && transactions.length < max; i++) {
    const { cells, line } = rows[i]!;
    const rawDate = cell(cells, col.date);
    const date = parseDate(rawDate, dateFormat);
    if (!date) {
      // A line without a readable date and without an amount is a note or footer. One with an amount
      // (a totals row, a pending payment, a typo) is reported so nothing disappears silently.
      const hasMoney = [col.amount, col.debit, col.credit].some((c) => money(cells, c) != null);
      if (hasMoney) {
        skipped.push({ line, reason: "date", message: rawDate ? `Unreadable date "${clip(rawDate)}"` : "No date", raw: cells });
      }
      continue;
    }

    let amount: number | null;
    if (sign === "split") {
      const out = money(cells, col.debit);
      const inn = money(cells, col.credit);
      amount = out == null && inn == null ? null : Math.abs(inn ?? 0) - Math.abs(out ?? 0);
    } else {
      const a = money(cells, col.amount);
      if (a == null) amount = null;
      else if (sign === "inverted") amount = -a;
      else if (sign === "direction") {
        const isOut = directionOf(cell(cells, col.direction));
        amount = isOut === undefined ? a : isOut ? -Math.abs(a) : Math.abs(a);
      } else amount = a;
    }
    if (amount == null) {
      skipped.push({ line, reason: "amount", message: "No amount", raw: cells });
      continue;
    }
    if (amount === 0) {
      skipped.push({ line, reason: "zero", message: "Amount is zero", raw: cells });
      continue;
    }
    amount = amount === 0 ? 0 : amount; // no -0

    const t: Transaction = {
      date,
      amount,
      description: clean(cell(cells, col.description)) || clean(cell(cells, col.memo)) || "(no description)",
      line,
      raw: cells,
    };
    const memo = clean(cell(cells, col.memo));
    if (memo && memo !== t.description) t.memo = memo;
    const balance = money(cells, col.balance);
    if (balance != null) t.balance = balance;
    const currency = cell(cells, col.currency).toUpperCase();
    if (/^[A-Z]{3}$/.test(currency)) t.currency = currency;
    const category = clean(cell(cells, col.category));
    if (category) t.category = category;
    const reference = clean(cell(cells, col.reference));
    if (reference) t.reference = reference;
    transactions.push(t);
  }

  return { transactions, skipped, detection };
}

const clean = (s: string) => s.replace(/\s+/g, " ").trim();
const clip = (s: string) => (s.length > 24 ? `${s.slice(0, 24)}…` : s);
