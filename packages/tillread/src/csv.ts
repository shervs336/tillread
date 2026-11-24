/** A non-empty row and the 1-based line it starts on. */
export interface Row {
  cells: string[];
  line: number;
}

const DELIMITERS = [",", ";", "\t", "|"] as const;

/**
 * RFC 4180 tokenizer (one pass, slices instead of per-character string building): quoted fields, doubled quotes, delimiters and line breaks inside quotes,
 * CRLF / LF / CR line endings. Unquoted cells are trimmed; empty rows are dropped.
 */
export function tokenize(text: string, delimiter = ","): Row[] {
  const rows: Row[] = [];
  const n = text.length;
  const D = delimiter.charCodeAt(0);
  let cells: string[] = [];
  let line = 1;
  let rowLine = 1;
  let i = 0;

  // Index of the next delimiter or line break at or after k.
  const stop = (k: number) => {
    while (k < n) {
      const c = text.charCodeAt(k);
      if (c === D || c === 10 || c === 13) break;
      k++;
    }
    return k;
  };

  for (;;) {
    let j = i;
    while (j < n && (text.charCodeAt(j) === 32 || (text.charCodeAt(j) === 9 && D !== 9))) j++;
    let end: number;
    if (j < n && text.charCodeAt(j) === 34) {
      // Quoted cell: copy up to the closing quote, unescaping doubled quotes.
      let value = "";
      let from = j + 1;
      let k = from;
      for (;;) {
        const q = text.indexOf('"', k);
        if (q === -1) {
          value += text.slice(from);
          k = n;
          break;
        }
        if (text.charCodeAt(q + 1) === 34) {
          value += text.slice(from, q + 1);
          k = from = q + 2;
          continue;
        }
        value += text.slice(from, q);
        k = q + 1;
        break;
      }
      for (let p = 0; p < value.length; p++) {
        const c = value.charCodeAt(p);
        if (c === 10 || (c === 13 && value.charCodeAt(p + 1) !== 10)) line++;
      }
      cells.push(value);
      end = stop(k); // anything between the closing quote and the delimiter is ignored
    } else {
      end = stop(i);
      cells.push(text.slice(i, end).trim());
    }

    if (end < n && text.charCodeAt(end) === D) {
      i = end + 1;
      continue;
    }
    if (cells.some((c) => c !== "")) rows.push({ cells, line: rowLine });
    if (end >= n) break;
    cells = [];
    i = end + 1;
    if (text.charCodeAt(end) === 13 && text.charCodeAt(i) === 10) i++;
    line++;
    rowLine = line;
  }
  return rows;
}

/**
 * Picks the delimiter that splits the start of the file into the most rows of the same width.
 * A decimal comma (`-12,50`) can't fool it: splitting on it gives ragged rows.
 */
export function detectDelimiter(text: string): string {
  const sample = text.slice(0, 16 * 1024);
  let best: string = ",";
  let bestScore = -1;
  for (const d of DELIMITERS) {
    const rows = tokenize(sample, d).slice(0, 60);
    const counts = new Map<number, number>();
    for (const r of rows) if (r.cells.length > 1) counts.set(r.cells.length, (counts.get(r.cells.length) ?? 0) + 1);
    let width = 0;
    let n = 0;
    for (const [w, c] of counts) if (c > n || (c === n && w > width)) [width, n] = [w, c];
    // Rows of the modal width dominate; wider rows break ties.
    const score = n * 100 + width;
    if (score > bestScore) [best, bestScore] = [d, score];
  }
  return best;
}

/** Writes rows as CSV, quoting only cells that need it. */
export function stringify(rows: readonly (readonly string[])[], delimiter = ","): string {
  const needs = new RegExp(`["\\r\\n${delimiter === "\t" ? "\\t" : escape(delimiter)}]|^\\s|\\s$`);
  return rows
    .map((r) => r.map((c) => (needs.test(c) || c === "" && r.length === 1 ? `"${c.replace(/"/g, '""')}"` : c)).join(delimiter))
    .join("\r\n");
}

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
