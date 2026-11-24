import { formatMinor } from "./amount.ts";
import { stringify } from "./csv.ts";
import type { Transaction } from "./types.ts";

export interface ToCsvOptions {
  /** Digits after the decimal point. Default 2. */
  minorUnits?: number;
  delimiter?: string;
}

/**
 * Writes transactions as a clean CSV: `Date,Description,Amount,…`.
 *
 * Text cells starting with `=`, `+`, `-`, `@`, tab or carriage return get a leading apostrophe,
 * so a merchant name like `=HYPERLINK(…)` can't run as a formula when the file is opened in a
 * spreadsheet (CSV injection).
 */
export function toCSV(transactions: readonly Transaction[], options: ToCsvOptions = {}): string {
  const minor = options.minorUnits ?? 2;
  const has = (k: keyof Transaction) => transactions.some((t) => t[k] != null);
  const extra = (["memo", "category", "currency", "balance", "reference"] as const).filter(has);
  const header = ["Date", "Description", "Amount", ...extra.map((k) => k[0]!.toUpperCase() + k.slice(1))];
  const rows = transactions.map((t) => [
    t.date,
    safe(t.description),
    formatMinor(t.amount, minor),
    ...extra.map((k) => {
      const v = t[k];
      if (v == null) return "";
      return k === "balance" ? formatMinor(v as number, minor) : safe(String(v));
    }),
  ]);
  return stringify([header, ...rows], options.delimiter ?? ",");
}

const safe = (s: string) => (/^[=+\-@\t\r]/.test(s) ? `'${s}` : s);
