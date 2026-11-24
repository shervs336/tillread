import { detectDecimal, parseAmount } from "./amount.ts";
import { detectDelimiter, tokenize, type Row } from "./csv.ts";
import { dateShape, detectDateFormat, parseDate } from "./date.ts";
import { decode } from "./decode.ts";
import type { ColumnMap, DateFormat, DecimalSeparator, Detection, Input, ParseOptions, SignConvention } from "./types.ts";

/** Header words per field, in English, German, French, Spanish and Dutch. Earlier patterns rank higher. */
const HEADERS = {
  date: [
    /^(transaction |trans\.? |booking |txn )?date$|^datum$|^fecha$|^date (de l')?op(eration|\.)?$|^dateop$|^buchungstag$|^buchungsdatum$/,
    /^(completed|started|posted|posting|booked) date$|^date posted$|^fecha (de )?operaci[oó]n$/,
    /date|datum|fecha|buchung|tag$/,
  ],
  amount: [
    /^(amount|betrag|importe|montant|bedrag|value|sum|net amount)( \(\w{3}\))?$/,
    /^amount|amount$|betrag|importe|montant|bedrag/,
  ],
  debit: [/^(debit|debits|withdrawals?|money out|paid out|out|spent|charges?|soll|ausgang|cargo|d[eé]bit|uitgaven?|af)( amount)?( \(\w{3}\))?$/, /debit|withdraw|money out|paid out/],
  credit: [/^(credit|credits|deposits?|money in|paid in|in|received|haben|eingang|abono|cr[eé]dit|inkomsten|bij)( amount)?( \(\w{3}\))?$/, /credit|deposit|money in|paid in/],
  direction: [/^(type|direction|cr\/dr|dr\/cr|debit\/credit|credit\/debit|af bij|af\/bij|soll\/haben|d\/c|c\/d|sens)$/, /type|direction/],
  balance: [/^(running )?(balance|bal\.?|saldo|solde|kontostand)|balance$|running bal/],
  currency: [/^(currency|ccy|cur|w[aä]e?hrung|moneda|devise|valuta)$/],
  category: [/^(category|kategorie|categor[ií]a|cat[eé]gorie|categorie)$/, /category/],
  reference: [/^(reference|ref\.?|check( or slip)? ?#?|cheque( number)?|check number|transaction id|id|referenz|r[eé]f[eé]rence|kenmerk)$/, /reference|transaction id/],
  description: [
    /^(description|details|transaction description|payee|merchant|narrative|name|beschreibung|concepto|libell[eé]|label|omschrijving|naam \/ omschrijving|particulars|transaction details|partner name|beguenstigter\/zahlungspflichtiger|empf[aä]nger|payee name)$/,
    /description|payee|merchant|narrative|details|omschrijving|libell|concepto|beschreib|naam|name|memo/,
  ],
  memo: [/^(memo|notes?|mededelingen|payment reference|verwendungszweck|comment|remarks|reference text)$/, /memo|note|mededeling/],
} satisfies Record<string, RegExp[]>;

type Field = keyof typeof HEADERS;

// Values that say which way money moved: true = money out.
const DIRECTIONS: Record<string, boolean> = {
  dr: true, debit: true, d: true, out: true, af: true, withdrawal: true, soll: true, "money out": true, debito: true, "débit": true,
  cr: false, credit: false, c: false, in: false, bij: false, deposit: false, haben: false, "money in": false, credito: false, "crédit": false,
};
const directionOf = (v: string): boolean | undefined => DIRECTIONS[v.trim().toLowerCase()];

const INCOME_WORDS = /\b(payment|thank you|autopay|refund|salary|payroll|deposit|interest paid|cashback|reversal|return|gehalt|lohn|salaire|virement re[cç]u|nómina)\b/i;

const norm = (h: string) => h.trim().toLowerCase().replace(/\s+/g, " ");

interface Stats {
  header: string;
  dateRate: number;
  amountRate: number;
  fill: number;
  avgLen: number;
  distinct: number;
  negRate: number;
  directionRate: number;
  currencyRate: number;
  wordRate: number;
}

function columnStats(rows: Row[], c: number, header: string, decimal: DecimalSeparator): Stats {
  let filled = 0, dates = 0, amounts = 0, len = 0, neg = 0, dir = 0, cur = 0, words = 0;
  const seen = new Set<string>();
  for (const r of rows) {
    const v = r.cells[c] ?? "";
    if (!v) continue;
    filled++;
    len += v.length;
    seen.add(v);
    if (dateShape(v)) dates++;
    const a = /\d/.test(v) && !/[a-z]{4,}/i.test(v) ? parseAmount(v, decimal) : null;
    if (a != null && !dateShape(v)) {
      amounts++;
      if (a < 0) neg++;
    }
    if (directionOf(v) !== undefined) dir++;
    if (/^[A-Z]{3}$/.test(v)) cur++;
    if (/[\p{L}]{3,}/u.test(v)) words++;
  }
  const f = filled || 1;
  return {
    header,
    dateRate: dates / f,
    amountRate: amounts / f,
    fill: filled / (rows.length || 1),
    avgLen: len / f,
    distinct: seen.size / f,
    negRate: neg / f,
    directionRate: dir / f,
    currencyRate: cur / f,
    wordRate: words / f,
  };
}

/** How strongly a header names a field: 3 for the best pattern, then 2, then 1; 0 for no match. */
function headerScore(field: Field, header: string): number {
  const pats = HEADERS[field];
  for (let i = 0; i < pats.length; i++) if (pats[i]!.test(header)) return 3 - Math.min(i, 2);
  return 0;
}

function findHeaderRow(rows: Row[], width: number): number | null {
  const limit = Math.min(rows.length, 40);
  for (let i = 0; i < limit; i++) {
    const cells = rows[i]!.cells;
    if (cells.length < Math.max(2, width - 2)) continue;
    const isData = cells.some((c) => dateShape(c)) && cells.some((c) => /\d/.test(c) && parseAmount(c, ".") != null && !dateShape(c));
    if (isData) {
      // First data row. The header is the row just before it, if that row reads like one.
      for (let h = i - 1; h >= 0 && h >= i - 3; h--) {
        const hc = rows[h]!.cells.filter(Boolean);
        if (hc.length >= 2 && hc.every((c) => !dateShape(c) && parseAmount(c, ".") == null)) return h;
      }
      return null;
    }
  }
  // No row looked like data. Fall back to the first full-width row with known header words.
  for (let i = 0; i < limit; i++) {
    const hs = rows[i]!.cells.map(norm);
    if (rows[i]!.cells.length >= width && hs.some((h) => headerScore("date", h) > 0)) return i;
  }
  return null;
}

/** Inspects a bank CSV and works out its layout. {@link parse} calls this for you. */
export function detect(input: Input, options: ParseOptions = {}): Detection {
  return analyze(decode(input), options).detection;
}

/** @internal Detection plus the rows it was based on, so parse doesn't tokenize twice. */
export function analyze(text: string, options: ParseOptions = {}): { detection: Detection; rows: Row[]; dataStart: number } {
  const notes: string[] = [];
  const warnings: string[] = [];

  const delimiter = options.delimiter ?? detectDelimiter(text);
  const rows = tokenize(text, delimiter);
  notes.push(`Delimiter: ${delimiter === "\t" ? "tab" : `"${delimiter}"`}.`);

  const widths = new Map<number, number>();
  for (const r of rows.slice(0, 200)) widths.set(r.cells.length, (widths.get(r.cells.length) ?? 0) + 1);
  let width = 0;
  let wc = 0;
  for (const [w, c] of widths) if (w > 1 && (c > wc || (c === wc && w > width))) [width, wc] = [w, c];

  const headerRow = options.headerRow !== undefined ? options.headerRow : findHeaderRow(rows, width);
  const dataStart = headerRow == null ? 0 : headerRow + 1;
  const headerCells = headerRow == null ? [] : rows[headerRow]!.cells;
  const ncols = Math.max(width, headerCells.length);
  const headers = Array.from({ length: ncols }, (_, i) => headerCells[i]?.trim() || `Column ${i + 1}`);
  if (headerRow == null) notes.push("No header row; columns were identified from their contents.");
  else if (headerRow > 0) notes.push(`Skipped ${headerRow} line${headerRow === 1 ? "" : "s"} before the header.`);

  const sample = rows.slice(dataStart, dataStart + 400).filter((r) => r.cells.length >= Math.max(2, width - 2));

  // Decimal separator, from every numeric-looking cell that isn't a date.
  let decimal: DecimalSeparator;
  if (options.decimal) decimal = options.decimal;
  else {
    const values = sample.flatMap((r) => r.cells.filter((c) => /\d/.test(c) && !dateShape(c) && c.length < 24));
    decimal = detectDecimal(values).decimal;
    notes.push(`Decimal separator: "${decimal}".`);
  }

  const stats = headers.map((h, c) => columnStats(sample, c, headerRow == null ? "" : norm(h), decimal));
  const columns = pickColumns(stats, options.columns ?? {}, sample, decimal);

  // Dates
  const dateValues = sample.map((r) => r.cells[columns.date] ?? "");
  let dateFormat: DateFormat;
  let dateCertainty = 1;
  if (options.dateFormat) dateFormat = options.dateFormat;
  else {
    const g = detectDateFormat(dateValues, decimal === "," ? "DMY" : "MDY");
    dateFormat = g.format;
    dateCertainty = g.certainty;
    const label = { YMD: "year first", DMY: "day first", MDY: "month first" }[g.format];
    const why = {
      unambiguous: "",
      votes: " (some days are above 12)",
      order: " (the only reading that keeps rows in date order)",
      span: " (the reading that covers the shorter period)",
      hint: "",
    }[g.basis];
    notes.push(`Dates: ${label}${why}.`);
    if (g.basis === "hint") {
      warnings.push(`Every date could be read day-first or month-first; assumed ${label}. Pass dateFormat to be sure.`);
    }
  }
  const dates = dateValues.map((v) => parseDate(v, dateFormat));

  // Sign convention
  const amountOf = (r: Row, c: number | undefined) => (c == null ? null : parseAmount(r.cells[c], decimal));
  let sign: SignConvention;
  let signCertainty = 1;
  let order: Detection["order"] = "unknown";

  const balanceCheck = (signed: (r: Row) => number | null) => {
    if (columns.balance == null) return null;
    const pairs: { a: number | null; b: number | null }[] = sample.map((r) => ({ a: signed(r), b: amountOf(r, columns.balance) }));
    let asc = 0;
    let desc = 0;
    let ascInv = 0;
    let descInv = 0;
    let n = 0;
    for (let i = 1; i < pairs.length; i++) {
      const p = pairs[i - 1]!;
      const q = pairs[i]!;
      if (p.a == null || q.a == null || p.b == null || q.b == null) continue;
      n++;
      if (q.b - p.b === q.a) asc++;
      if (q.b - p.b === -q.a) ascInv++;
      if (p.b - q.b === p.a) desc++;
      if (p.b - q.b === -p.a) descInv++;
    }
    if (n < 2) return null;
    const best = Math.max(asc, desc, ascInv, descInv);
    if (best / n < 0.6) return null;
    return {
      inverted: best === ascInv || best === descInv ? best > Math.max(asc, desc) : false,
      order: (best === asc || best === ascInv ? "ascending" : "descending") as Detection["order"],
      rate: best / n,
    };
  };

  if (options.sign) sign = options.sign;
  else if (columns.debit != null && columns.credit != null) {
    sign = "split";
    notes.push(`Money out from "${headers[columns.debit]}", money in from "${headers[columns.credit]}".`);
  } else if (columns.amount != null && columns.direction != null) {
    sign = "direction";
    notes.push(`Direction from "${headers[columns.direction]}".`);
  } else {
    const raw = (r: Row) => amountOf(r, columns.amount);
    const bal = balanceCheck(raw);
    if (bal) {
      sign = bal.inverted ? "inverted" : "signed";
      order = bal.order;
      notes.push(`Signs checked against the running balance (${Math.round(bal.rate * 100)}% of rows match).`);
    } else {
      // Rows that are clearly money in (payments, refunds, salary) show which sign means income.
      let incomeNeg = 0;
      let incomePos = 0;
      let neg = 0;
      let n = 0;
      sample.forEach((r) => {
        const a = raw(r);
        if (a == null || a === 0) return;
        n++;
        if (a < 0) neg++;
        const text = `${r.cells[columns.description] ?? ""} ${columns.memo != null ? r.cells[columns.memo] ?? "" : ""}`;
        if (INCOME_WORDS.test(text)) {
          if (a < 0) incomeNeg++;
          else incomePos++;
        }
      });
      if (incomeNeg + incomePos >= 1 && incomeNeg !== incomePos && neg > 0 && neg < n) {
        sign = incomeNeg > incomePos ? "inverted" : "signed";
        signCertainty = 0.85;
        notes.push(
          sign === "inverted"
            ? "Payments and refunds are negative here, so positive amounts are money out (typical for card statements)."
            : "Amounts are signed: negative is money out.",
        );
      } else if (n > 0 && neg === 0) {
        sign = "inverted";
        signCertainty = 0.55;
        warnings.push("Every amount is positive, so they were read as money out. Pass sign: \"signed\" if they're income.");
      } else {
        sign = "signed";
        signCertainty = neg > 0 ? 0.85 : 0.5;
        notes.push("Amounts are signed: negative is money out.");
      }
    }
  }

  if (order === "unknown") {
    const ds = dates.filter((d): d is string => d != null);
    let up = 0;
    let down = 0;
    for (let i = 1; i < ds.length; i++) {
      if (ds[i]! > ds[i - 1]!) up++;
      else if (ds[i]! < ds[i - 1]!) down++;
    }
    if (up + down > 0 && (up === 0 || down === 0 || Math.max(up, down) / (up + down) > 0.9)) {
      order = up >= down ? "ascending" : "descending";
    }
  }

  // Up to one row in ten without a date (totals, pending rows) is normal.
  const dateRate = Math.min(1, dates.filter(Boolean).length / (dates.length || 1) / 0.9);
  const columnCertainty = columns.description === columns.date ? 0.3 : 1;
  const confidence = Math.round(Math.min(1, dateRate * dateCertainty * signCertainty * columnCertainty) * 100) / 100;
  if (sample.length === 0) warnings.push("No data rows found.");

  return {
    detection: { delimiter, headerRow, headers, columns, dateFormat, decimal, sign, order, confidence, notes, warnings },
    rows,
    dataStart,
  };
}

function pickColumns(stats: Stats[], forced: Partial<ColumnMap>, sample: Row[], decimal: DecimalSeparator): ColumnMap {
  const used = new Set<number>(Object.values(forced).filter((v): v is number => typeof v === "number"));
  const take = (field: Field, score: (s: Stats, c: number) => number, min = 0.5): number | undefined => {
    if (field in forced) return forced[field as keyof ColumnMap];
    let best: number | undefined;
    let bestScore = min;
    stats.forEach((s, c) => {
      if (used.has(c)) return;
      const v = score(s, c);
      if (v > bestScore) [best, bestScore] = [c, v];
    });
    if (best != null) used.add(best);
    return best;
  };
  const h = (field: Field) => (s: Stats) => headerScore(field, s.header);

  const date = take("date", (s) => (s.dateRate > 0.6 ? s.dateRate * 2 + h("date")(s) : 0)) ?? 0;
  used.add(date);
  // Other date-like columns (posting date, value date) shouldn't be picked as anything else.
  stats.forEach((s, c) => {
    if (s.dateRate > 0.8 && s.amountRate < 0.5) used.add(c);
  });

  const balance = take("balance", (s) => (s.amountRate > 0.6 ? h("balance")(s) : 0));
  const currency = take("currency", (s) => (s.currencyRate > 0.8 ? 1 + h("currency")(s) : h("currency")(s) && s.currencyRate > 0.3 ? 1 : 0));

  // Amount: prefer an "Amount" header; else debit/credit; else content.
  let amount = take("amount", (s) => (s.amountRate > 0.6 && !/local|original|fee|foreign/.test(s.header) ? h("amount")(s) : 0));
  let debit: number | undefined;
  let credit: number | undefined;
  if (amount == null) {
    debit = take("debit", (s) => (s.amountRate > 0.6 || s.fill < 0.9 ? h("debit")(s) : 0));
    credit = take("credit", (s) => (s.amountRate > 0.6 || s.fill < 0.9 ? h("credit")(s) : 0));
    if ((debit == null) !== (credit == null)) {
      // Only one side found: treat it as a plain amount column.
      amount = debit ?? credit;
      debit = credit = undefined;
    }
  }
  if (amount == null && debit == null) {
    // No headers to go on. Numeric columns, left to right.
    const numeric = stats
      .map((s, c) => ({ s, c }))
      .filter(({ s, c }) => !used.has(c) && s.amountRate > 0.9 && s.wordRate < 0.1);
    // Two half-filled columns that never overlap are debit and credit.
    const sparse = numeric.filter(({ s }) => s.fill < 0.9);
    if (sparse.length >= 2 && complementary(sample, sparse[0]!.c, sparse[1]!.c)) {
      [debit, credit] = [sparse[0]!.c, sparse[1]!.c];
      used.add(debit);
      used.add(credit);
    } else if (numeric.length >= 1) {
      // With two full columns, the one whose steps match the other is the balance.
      const full = numeric.filter(({ s }) => s.fill >= 0.9).map(({ c }) => c);
      amount = full[0] ?? numeric[0]!.c;
      if (full.length >= 2 && forced.balance === undefined) {
        const [a, b] = pickAmountAndBalance(sample, full[0]!, full[1]!, decimal);
        amount = a;
        if (balance == null) {
          used.add(b);
          forced = { ...forced, balance: b };
        }
      }
      used.add(amount);
    }
  }
  const balanceCol = balance ?? forced.balance;

  const direction =
    amount != null
      ? take("direction", (s) => (s.directionRate > 0.8 ? 1 + h("direction")(s) : 0))
      : undefined;

  const category = take("category", (s) => (s.wordRate > 0.3 ? h("category")(s) : 0));
  const description =
    take("description", (s) => (s.wordRate > 0.2 && s.amountRate < 0.5 ? h("description")(s) * 2 + Math.min(s.avgLen, 40) / 40 + s.distinct : 0)) ??
    take("description", (s) => (s.wordRate > 0.3 ? Math.min(s.avgLen, 60) / 30 + s.distinct : 0), 0) ??
    date;
  const memo = take("memo", (s) => (s.wordRate > 0.2 && s.fill > 0.2 ? h("memo")(s) : 0));
  const reference = take("reference", (s) => (s.fill > 0.2 ? h("reference")(s) : 0));

  const out: ColumnMap = { date, description };
  const add = <K extends keyof ColumnMap>(k: K, v: ColumnMap[K] | undefined) => {
    if (v != null) out[k] = v;
  };
  add("memo", memo);
  add("amount", amount);
  add("debit", debit);
  add("credit", credit);
  add("direction", direction);
  add("balance", balanceCol);
  add("currency", currency);
  add("category", category);
  add("reference", reference);
  return { ...out, ...stripUndefined(forced) };
}

function complementary(rows: Row[], a: number, b: number) {
  let both = 0;
  let either = 0;
  for (const r of rows) {
    const x = !!r.cells[a];
    const y = !!r.cells[b];
    if (x && y) both++;
    if (x || y) either++;
  }
  return either > 0 && both / either < 0.05;
}

/** Of two full numeric columns, the balance is the one that changes by the other's value each row. */
function pickAmountAndBalance(rows: Row[], c1: number, c2: number, decimal: DecimalSeparator): [number, number] {
  const fits = (amount: number, balance: number) => {
    let hits = 0;
    for (let i = 1; i < rows.length; i++) {
      const a0 = parseAmount(rows[i - 1]!.cells[amount], decimal);
      const a1 = parseAmount(rows[i]!.cells[amount], decimal);
      const b0 = parseAmount(rows[i - 1]!.cells[balance], decimal);
      const b1 = parseAmount(rows[i]!.cells[balance], decimal);
      if (a0 == null || a1 == null || b0 == null || b1 == null) continue;
      const d = b1 - b0;
      if (Math.abs(d) === Math.abs(a1) || Math.abs(d) === Math.abs(a0)) hits++;
    }
    return hits;
  };
  return fits(c2, c1) > fits(c1, c2) ? [c2, c1] : [c1, c2];
}

const stripUndefined = (o: Partial<ColumnMap>) =>
  Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as Partial<ColumnMap>;

export { directionOf };
