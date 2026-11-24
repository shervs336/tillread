import type { DateFormat } from "./types.ts";

// Month-name prefixes in English, German, French, Spanish and Dutch (accents removed).
// Four-letter keys win over three-letter ones, which keeps "juin" and "juil" apart.
const MONTHS: Record<string, number> = {
  jan: 1, ene: 1, janv: 1,
  feb: 2, fev: 2, fevr: 2,
  mar: 3, mrz: 3, mrt: 3, maa: 3, mars: 3,
  apr: 4, avr: 4, abr: 4,
  may: 5, mai: 5, mei: 5,
  jun: 6, juin: 6,
  jul: 7, juil: 7,
  aug: 8, ago: 8, aou: 8,
  sep: 9, sept: 9,
  oct: 10, okt: 10,
  nov: 11,
  dec: 12, dez: 12, dic: 12,
};

const monthOf = (word: string): number | undefined => {
  const w = word.normalize("NFD").replace(/[̀-ͯ.]/g, "").toLowerCase();
  if (w.length < 3) return undefined;
  return MONTHS[w.slice(0, 4)] ?? MONTHS[w.slice(0, 3)];
};

const fullYear = (y: number, digits: number) => (digits === 2 ? (y < 70 ? 2000 + y : 1900 + y) : y);

const iso = (y: number, m: number, d: number): string | null => {
  if (m < 1 || m > 12 || d < 1 || d > 31 || y < 1900 || y > 2200) return null;
  const t = new Date(Date.UTC(y, m - 1, d));
  if (t.getUTCMonth() !== m - 1) return null; // 31 April, 29 February in a common year
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
};

const YMD = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})(?:$|[T\s])/;
const COMPACT = /^(\d{4})(\d{2})(\d{2})$/;
const NUMERIC = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4}|\d{2})(?:$|[T\s,])/;
const DAY_MONTH = /^(\d{1,2})(?:st|nd|rd|th)?[\s.-]+([\p{L}.]{3,})[\s.,-]+(\d{4}|\d{2})(?:$|[T\s,])/u;
const MONTH_DAY = /^([\p{L}.]{3,})[\s.-]+(\d{1,2})(?:st|nd|rd|th)?,?[\s.-]+(\d{4}|\d{2})(?:$|[T\s,])/u;

/** Which kind of date a cell holds, without deciding day-month order. */
export function dateShape(raw: string): "ymd" | "numeric" | "named" | null {
  const s = raw.trim();
  if (YMD.test(s) || COMPACT.test(s)) return "ymd";
  if (NUMERIC.test(s)) return "numeric";
  const a = s.match(DAY_MONTH);
  if (a && monthOf(a[2]!)) return "named";
  const b = s.match(MONTH_DAY);
  if (b && monthOf(b[1]!)) return "named";
  return null;
}

/**
 * Reads one date into `YYYY-MM-DD`. `format` only matters for numeric dates like `03/04/2026`;
 * `2026-04-03`, `20260403`, `3 Apr 2026`, `Apr 3, 2026` and `03-Apr-26` are read the same way
 * whatever it is. A trailing time is ignored. Returns `null` for anything that isn't a real date.
 */
export function parseDate(raw: string | undefined, format: DateFormat = "YMD"): string | null {
  const s = raw?.trim();
  if (!s) return null;
  let m = s.match(YMD) ?? s.match(COMPACT);
  if (m) return iso(+m[1]!, +m[2]!, +m[3]!);
  m = s.match(NUMERIC);
  if (m) {
    const y = fullYear(+m[3]!, m[3]!.length);
    if (format === "MDY") return iso(y, +m[1]!, +m[2]!);
    if (format === "DMY") return iso(y, +m[2]!, +m[1]!);
    return null; // YMD files don't use two-digit-first numeric dates
  }
  m = s.match(DAY_MONTH);
  if (m) {
    const month = monthOf(m[2]!);
    if (month) return iso(fullYear(+m[3]!, m[3]!.length), month, +m[1]!);
  }
  m = s.match(MONTH_DAY);
  if (m) {
    const month = monthOf(m[1]!);
    if (month) return iso(fullYear(+m[3]!, m[3]!.length), month, +m[2]!);
  }
  return null;
}

export interface DateFormatGuess {
  format: DateFormat;
  /** How it was decided. */
  basis: "unambiguous" | "votes" | "order" | "span" | "hint";
  /** 0–1 */
  certainty: number;
}

/**
 * Decides day-first or month-first once per file, so one row can't flip the rest.
 * 1. A first number above 12 votes day-first; a second number above 12 votes month-first.
 * 2. If nothing votes (every day is 12 or under), pick the reading that keeps the rows in date
 *    order, since statements are sorted.
 * 3. Then the reading that covers the shorter period.
 * 4. Otherwise fall back to `hint` (callers pass DMY for decimal-comma files).
 */
export function detectDateFormat(values: readonly string[], hint: DateFormat = "MDY"): DateFormatGuess {
  let dayFirst = 0;
  let monthFirst = 0;
  let numeric = 0;
  for (const v of values) {
    const m = v.trim().match(NUMERIC);
    if (!m) continue;
    numeric++;
    const a = +m[1]!;
    const b = +m[2]!;
    if (a > 12 && a <= 31 && b <= 12) dayFirst++;
    else if (b > 12 && b <= 31 && a <= 12) monthFirst++;
  }
  if (numeric === 0) return { format: "YMD", basis: "unambiguous", certainty: 1 };
  if (dayFirst !== monthFirst) {
    const format = dayFirst > monthFirst ? "DMY" : "MDY";
    const certainty = Math.max(dayFirst, monthFirst) / (dayFirst + monthFirst);
    return { format, basis: "votes", certainty };
  }

  const read = (f: DateFormat) => values.map((v) => parseDate(v, f)).filter((d): d is string => d != null);
  const dmy = read("DMY");
  const mdy = read("MDY");
  const sortedness = (ds: string[]) => {
    if (ds.length < 3) return 0;
    let up = 0;
    let down = 0;
    for (let i = 1; i < ds.length; i++) {
      if (ds[i]! >= ds[i - 1]!) up++;
      if (ds[i]! <= ds[i - 1]!) down++;
    }
    return Math.max(up, down) / (ds.length - 1);
  };
  const sd = sortedness(dmy);
  const sm = sortedness(mdy);
  if (Math.abs(sd - sm) > 0.05) return { format: sd > sm ? "DMY" : "MDY", basis: "order", certainty: 0.9 };

  const span = (ds: string[]) => {
    if (ds.length < 2) return Infinity;
    const sorted = [...ds].sort();
    return Date.parse(sorted[sorted.length - 1]!) - Date.parse(sorted[0]!);
  };
  const pd = span(dmy);
  const pm = span(mdy);
  if (pd !== pm && Math.max(pd, pm) > 1.5 * Math.min(pd, pm)) {
    // Days versus months apart is near-certain; a smaller gap less so.
    const ratio = Math.max(pd, pm) / Math.max(1, Math.min(pd, pm));
    return { format: pd < pm ? "DMY" : "MDY", basis: "span", certainty: ratio > 10 ? 0.9 : 0.7 };
  }
  return { format: hint, basis: "hint", certainty: 0.5 };
}
