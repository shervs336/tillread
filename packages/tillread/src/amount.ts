import type { DecimalSeparator } from "./types.ts";

// Currency symbols, ISO codes and the spaces banks put inside numbers (regular, no-break, thin).
const NOISE = /[\p{Sc}\s   ']|\b[A-Z]{3}\b/gu;
const PLAIN = /^(-?)(\d{1,13})(?:\.(\d{1,2}))?$/;
const MINUS =/[−‒–]/g;

/**
 * Reads one amount into integer minor units (cents by default), without floating-point error.
 *
 * Understands `-12.50`, `12.50-`, `(12.50)`, `+12.50`, `12.50 CR`, `12.50 DR`, `$1,234.56`,
 * `1.234,56 €`, `1 234,56`, `1'234.50` and `−12.50` (Unicode minus). Returns `null` for
 * anything else, including empty cells and a lone `-`.
 */
export function parseAmount(raw: string | undefined, decimal: DecimalSeparator = ".", minorUnits = 2): number | null {
  if (raw == null) return null;
  let s = raw.trim();
  if (!s) return null;
  // Fast path for the most common shape: -1234.56
  if (decimal === "." && minorUnits === 2) {
    const f = PLAIN.exec(s);
    if (f) {
      const n = Number(f[2]!) * 100 + (f[3] ? Number(f[3].padEnd(2, "0")) : 0);
      return f[1] && n !== 0 ? -n : n;
    }
  }
  s = s.replace(MINUS, "-");

  let negative = false;
  const suffix = s.match(/\s*(cr|dr)\.?$/i);
  if (suffix) {
    negative = suffix[1]!.toLowerCase() === "dr";
    s = s.slice(0, suffix.index);
  }
  s = s.replace(NOISE, "");
  if (/^\(.*\)$/.test(s)) {
    negative = !negative;
    s = s.slice(1, -1);
  }
  if (s.startsWith("-")) {
    negative = !negative;
    s = s.slice(1);
  } else if (s.endsWith("-")) {
    negative = !negative;
    s = s.slice(0, -1);
  } else if (s.startsWith("+")) s = s.slice(1);
  s = s.replace(NOISE, "");

  if (decimal === ",") s = s.replace(/\./g, "").replace(",", ".");
  else s = s.replace(/,/g, "");
  const m = s.match(/^(\d*)(?:\.(\d+))?$/);
  if (!m || (!m[1] && !m[2])) return null;

  // Integer arithmetic on the digit strings, so 0.1 + 0.2 problems can't happen.
  const digits = (m[1] || "0") + (m[2] ?? "").slice(0, minorUnits).padEnd(minorUnits, "0");
  if (digits.replace(/^0+/, "").length > 15) return null; // beyond exact double precision
  let n = Number(digits);
  const frac = m[2] ?? "";
  if (frac.length > minorUnits && frac.charCodeAt(minorUnits) >= 53) n += 1; // round half away from zero ("5" is 53)
  return negative && n !== 0 ? -n : n;
}

/**
 * Guesses the decimal separator from a sample of amounts. `1.234,56` and `-12,50` vote for a
 * comma; `1,234.56` and `-12.50` vote for a dot; `1,234` on its own doesn't vote.
 */
export function detectDecimal(values: readonly string[]): { decimal: DecimalSeparator; votes: number } {
  let comma = 0;
  let dot = 0;
  for (const v of values) {
    const s = v.replace(NOISE, "").replace(/[()+-]|CR|DR/gi, "");
    if (/,\d{1,2}$/.test(s) || /\.\d{3},\d+$/.test(s)) comma++;
    else if (/\.\d{1,2}$/.test(s) || /,\d{3}\.\d+$/.test(s)) dot++;
  }
  return comma > dot ? { decimal: ",", votes: comma - dot } : { decimal: ".", votes: dot - comma };
}

/** Formats minor units back into a plain decimal string: `-123456` → `"-1234.56"`. */
export function formatMinor(amount: number, minorUnits = 2): string {
  const sign = amount < 0 ? "-" : "";
  const digits = String(Math.abs(amount)).padStart(minorUnits + 1, "0");
  return minorUnits === 0 ? sign + digits : `${sign}${digits.slice(0, -minorUnits)}.${digits.slice(-minorUnits)}`;
}
