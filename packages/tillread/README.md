# tillread

Read CSV exports from any bank into clean, typed transactions.

Every bank exports CSV differently: semicolons or commas, `1.234,56` or `1,234.56`, day-first or month-first dates, debit and credit columns, `DR`/`CR` flags, account summaries above the header, Windows-1252 or UTF-16. Tillread works all of that out from the file itself, gives you ISO dates and integer cents, and tells you how it decided and what it skipped.

- **Zero dependencies**, about 6 kB minified and brotli'd (`parseAmount` alone is about 400 bytes)
- **ESM and CommonJS**, full TypeScript types, runs in browsers, Node 18+, Deno, Bun and workers
- **Tested against 16 bank layouts** (Chase, Bank of America, Wells Fargo, Capital One, Amex, Monzo, Revolut, Sparkasse, ING, Barclays, CommBank, Wise, Boursorama and edge cases), plus property-based tests
- **About 200,000 rows a second**

[Playground and docs](https://tillread.vercel.app) · [GitHub](https://github.com/shervs336/tillread)

## Install

```bash
npm i tillread
```

## Use

```ts
import { parse } from "tillread";

// Pass the bytes if you can: tillread handles the encoding. A string works too.
const bytes = new Uint8Array(await file.arrayBuffer());
const { transactions, skipped, detection } = parse(bytes);

transactions[0];
// {
//   date: "2026-01-02",            ISO, always
//   amount: -7802,                 integer minor units (cents); negative = money out
//   description: "Lidl sagt Danke",
//   currency: "EUR",               when the file has a currency column
//   balance: 245118,               when the file has a running balance
//   category: "Groceries",         when the file has one
//   line: 2,                       1-based line in the file
//   raw: ["DE44…", "02.01.26", …]  the original cells
// }

skipped;
// [{ line: 8, reason: "amount", message: "No amount", raw: [...] }]
// Rows with a date or an amount that couldn't be read. Nothing is dropped silently.

detection;
// {
//   delimiter: ";", headerRow: 0, headers: [...],
//   columns: { date: 1, description: 5, memo: 4, amount: 8, currency: 9 },
//   dateFormat: "DMY", decimal: ",", sign: "signed", order: "ascending",
//   confidence: 0.85,
//   notes: ["Delimiter: \";\".", "Dates: day first (some days are above 12).", ...],
//   warnings: []
// }
```

Show `detection` next to a preview when `confidence` is below about 0.7, and let the user correct it.

## Options

Override anything; the rest is still detected.

```ts
parse(bytes, {
  delimiter: ";",
  headerRow: 4,              // index among non-empty rows, or null for no header
  columns: { description: 5, memo: 4 },
  dateFormat: "DMY",         // "YMD" | "DMY" | "MDY"
  decimal: ",",              // "." | ","
  sign: "inverted",          // "signed" | "inverted" | "split" | "direction"
  minorUnits: 0,             // digits after the decimal point: 0 for JPY, 3 for KWD (default 2)
  maxRows: 50_000,           // default 100,000
});
```

| `sign` | Meaning |
|---|---|
| `signed` | One amount column; money out is negative. |
| `inverted` | One amount column; money out is positive (most card statements). |
| `split` | Separate debit and credit columns. |
| `direction` | One unsigned amount plus a column such as `DR`/`CR`, `Debit`/`Credit` or `Af`/`Bij`. |

## Helpers

```ts
import { detect, parseAmount, parseDate, detectDateFormat, toCSV, formatMinor, decode, tokenize } from "tillread";

detect(bytes);                       // just the Detection
parseAmount("1.234,56 €", ",");      // 123456
parseAmount("(12.50)");              // -1250
parseAmount("12.50 DR");             // -1250
parseAmount("1,200.00-");            // -120000
parseDate("03-Apr-26");              // "2026-04-03"
parseDate("3. März 2026");           // "2026-03-03"
parseDate("03/04/2026", "DMY");      // "2026-04-03"
detectDateFormat(["01/10/2026", "01/12/2026", "02/03/2026"]); // { format: "MDY", basis: "order", ... }
formatMinor(-123456);                // "-1234.56"
toCSV(transactions);                 // a clean CSV, with spreadsheet formulas defused
```

## How detection works

1. **Encoding:** UTF-8 (with or without a BOM), UTF-16 LE/BE (with or without a BOM), otherwise Windows-1252.
2. **Delimiter:** the one of `,` `;` tab `|` that splits the start of the file into the most rows of equal width.
3. **Header:** the row just before the first row holding both a date and an amount. Preambles are skipped. With no header, columns are identified from their contents alone.
4. **Columns:** header words in English, German, French, Spanish and Dutch, combined with what the cells hold (dates, amounts, three-letter currency codes, direction flags, long text).
5. **Dates:** decided once per file. A first number above 12 votes day-first; a second number above 12 votes month-first. If no number is above 12, the reading that keeps rows in date order wins, then the reading that covers the shorter period, then a hint (day-first for decimal-comma files).
6. **Signs:** debit/credit columns or a direction column if there are any. Otherwise, if there's a running balance, every row is checked against it, which also proves the row order. Otherwise rows that are clearly money in (payments, refunds, salary) show which sign means income.

## License

MIT
