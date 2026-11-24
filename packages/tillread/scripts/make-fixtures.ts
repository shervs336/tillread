/**
 * Writes test/fixtures/*.csv and their *.expected.json.
 *
 * Each fixture copies the column layout, date style, number style, sign convention, preamble and
 * encoding of a real bank's export. The transactions are invented (seeded, so the files are
 * stable), and the expected file holds the transactions the CSV was written from, so tests check
 * tillread against the truth rather than against its own output.
 *
 * Run: node scripts/make-fixtures.ts
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const OUT = join(dirname(fileURLToPath(import.meta.url)), "..", "test", "fixtures");

interface Truth {
  date: string;
  amount: number;
  description: string;
  balance?: number;
  currency?: string;
  category?: string;
}
interface Fixture {
  name: string;
  bank: string;
  region: string;
  note: string;
  truth: Truth[];
  skipped: number;
  detection: Record<string, unknown>;
  content: string | Buffer;
}

// ---------- helpers ----------
function rng(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const pad = (n: number) => String(n).padStart(2, "0");
const parts = (iso: string) => iso.split("-").map(Number) as [number, number, number];
const addDays = (iso: string, d: number) => new Date(Date.parse(iso) + d * 86_400_000).toISOString().slice(0, 10);
const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

const mdy = (iso: string) => { const [y, m, d] = parts(iso); return `${pad(m)}/${pad(d)}/${y}`; };
const dmy = (iso: string, sep = "/") => { const [y, m, d] = parts(iso); return `${pad(d)}${sep}${pad(m)}${sep}${y}`; };
const dmyShort = (iso: string) => { const [y, m, d] = parts(iso); return `${pad(d)}.${pad(m)}.${String(y).slice(2)}`; };
const compact = (iso: string) => iso.replace(/-/g, "");

/** -123456 → "-1234.56" */
const plain = (n: number) => (n < 0 ? "-" : "") + (Math.abs(n) / 100).toFixed(2);
/** -123456 → "-1,234.56" */
const us = (n: number) => (n < 0 ? "-" : "") + (Math.abs(n) / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
/** -123456 → "-1.234,56" */
const eu = (n: number) => {
  const [w, f] = (Math.abs(n) / 100).toFixed(2).split(".");
  return (n < 0 ? "-" : "") + w!.replace(/\B(?=(\d{3})+(?!\d))/g, ".") + "," + f;
};
const q = (s: string) => `"${s.replace(/"/g, '""')}"`;

interface Spec {
  seed: number;
  start: string;
  days: number;
  count: number;
  merchants: [string, string?][]; // [description, category]
  incomes: string[];
  opening: number;
  maxDay?: number; // keep every day-of-month at or below this (ambiguous dates)
}

/** Ascending transactions with a running balance. */
function make(spec: Spec): Truth[] {
  const r = rng(spec.seed);
  const out: Truth[] = [];
  let date = spec.start;
  let balance = spec.opening;
  for (let i = 0; i < spec.count; i++) {
    const step = Math.floor(r() * (spec.days / spec.count) * 2);
    let next = addDays(date, step);
    if (spec.maxDay) {
      while (parts(next)[2] > spec.maxDay) next = addDays(next, 1);
    }
    date = next;
    const income = i % 6 === 2;
    const amount = income ? 150_000 + Math.floor(r() * 150_000) : -(300 + Math.floor(r() * 12_000));
    const [description, category] = income
      ? [spec.incomes[Math.floor(r() * spec.incomes.length)]!, "Income"]
      : spec.merchants[Math.floor(r() * spec.merchants.length)]!;
    balance += amount;
    const t: Truth = { date, amount, description, balance };
    if (category) t.category = category;
    out.push(t);
  }
  return out;
}

const US: [string, string][] = [
  ["BLUE BOTTLE COFFEE", "Dining"], ["TRADER JOE'S #552", "Groceries"], ["SHELL OIL 57444", "Gas"],
  ["NETFLIX.COM", "Entertainment"], ["UBER *TRIP", "Travel"], ["AMAZON MKTPL*2K4", "Shopping"],
  ["CVS/PHARMACY #01234", "Health"], ["WHOLE FOODS MKT #10", "Groceries"], ["CHIPOTLE 2291", "Dining"],
  ["COMCAST XFINITY", "Bills"], ["TARGET 00012345", "Shopping"], ["SPOTIFY USA", "Entertainment"],
];
const UK: [string, string][] = [
  ["TESCO STORES 2041", "Groceries"], ["PRET A MANGER", "Eating out"], ["TFL TRAVEL CH", "Transport"],
  ["SAINSBURYS S/MKT", "Groceries"], ["DELIVEROO", "Eating out"], ["BOOTS 1123", "Shopping"],
  ["COSTA COFFEE", "Eating out"], ["AMAZON.CO.UK", "Shopping"], ["THAMES WATER", "Bills"],
];
const DE: [string][] = [
  ["REWE Markt GmbH"], ["DB Vertrieb GmbH"], ["Lidl sagt Danke"], ["dm-drogerie markt"],
  ["Stadtwerke München"], ["Bäckerei Kühn"], ["Spotify AB"], ["Café Glück"],
];
const NL: [string][] = [["Albert Heijn 1403"], ["NS Groep IZ"], ["Jumbo Utrecht"], ["Bol.com"], ["Vattenfall"], ["HEMA Amsterdam"]];
const FR: [string, string][] = [
  ["CARREFOUR MARKET", "Alimentation"], ["SNCF", "Transports"], ["MONOPRIX", "Alimentation"],
  ["FNAC", "Loisirs"], ["EDF", "Logement"], ["BOULANGERIE PAUL", "Alimentation"],
];
const AU: [string][] = [["WOOLWORTHS 1234 SYDNEY"], ["COLES 0456 BONDI"], ["OPAL TRAVEL"], ["BWS LIQUOR"], ["JB HI FI"]];

const fixtures: Fixture[] = [];
const csv = (rows: string[][], d = ",") => rows.map((r) => r.join(d)).join("\r\n") + "\r\n";

// 1. Chase checking: newest first, trailing comma, Details DEBIT/CREDIT, signed amounts.
{
  const truth = make({ seed: 1, start: "2026-01-02", days: 40, count: 18, merchants: US, incomes: ["PAYROLL ACME CORP PPD"], opening: 250_000 }).reverse();
  const rows = [["Details", "Posting Date", "Description", "Amount", "Type", "Balance", "Check or Slip #"]];
  for (const t of truth) {
    rows.push([t.amount < 0 ? "DEBIT" : "CREDIT", mdy(t.date), q(t.description), plain(t.amount), t.amount < 0 ? "DEBIT_CARD" : "ACH_CREDIT", plain(t.balance!), "", ""]);
  }
  fixtures.push({
    name: "chase-checking", bank: "Chase (checking)", region: "US",
    note: "Newest first, a trailing comma on every row, DEBIT/CREDIT in its own column.",
    truth: truth.map(({ category, ...t }) => t), skipped: 0,
    detection: { delimiter: ",", dateFormat: "MDY", decimal: ".", order: "descending", headerRow: 0 },
    content: csv(rows),
  });
}

// 2. Bank of America: a summary block before the header, quoted thousands, an opening-balance row.
{
  const truth = make({ seed: 2, start: "2026-01-02", days: 30, count: 16, merchants: US, incomes: ["ACME CORP DES:PAYROLL"], opening: 250_000 });
  const credits = truth.filter((t) => t.amount > 0).reduce((s, t) => s + t.amount, 0);
  const debits = truth.filter((t) => t.amount < 0).reduce((s, t) => s + t.amount, 0);
  const lines = [
    "Description,,Summary Amt.",
    `Beginning balance as of 01/01/2026,,${q(us(250_000))}`,
    `Total credits,,${q(us(credits))}`,
    `Total debits,,${q(us(debits))}`,
    `Ending balance as of 01/31/2026,,${q(us(truth.at(-1)!.balance!))}`,
    "",
    "Date,Description,Amount,Running Bal.",
    `01/01/2026,Beginning balance as of 01/01/2026,,${q(us(250_000))}`,
    ...truth.map((t) => [mdy(t.date), q(t.description), q(us(t.amount)), q(us(t.balance!))].join(",")),
  ];
  fixtures.push({
    name: "bofa-checking", bank: "Bank of America (checking)", region: "US",
    note: "Five summary lines before the header, then an opening-balance row with no amount.",
    truth: truth.map(({ category, ...t }) => t), skipped: 1,
    detection: { delimiter: ",", dateFormat: "MDY", decimal: ".", headerRow: 5, sign: "signed", order: "ascending" },
    content: lines.join("\n") + "\n",
  });
}

// 3. Wells Fargo: no header at all.
{
  const truth = make({ seed: 3, start: "2026-02-01", days: 28, count: 14, merchants: US, incomes: ["ACME CORP PAYROLL"], opening: 180_000 }).reverse();
  const rows = truth.map((t) => [q(mdy(t.date)), q(plain(t.amount)), q("*"), q(""), q(`PURCHASE AUTHORIZED ON ${mdy(t.date).slice(0, 5)} ${t.description}`)]);
  fixtures.push({
    name: "wells-fargo", bank: "Wells Fargo", region: "US",
    note: "No header row; every cell quoted. Columns are found from their contents.",
    truth: truth.map((t) => ({ date: t.date, amount: t.amount, description: `PURCHASE AUTHORIZED ON ${mdy(t.date).slice(0, 5)} ${t.description}` })),
    skipped: 0,
    detection: { delimiter: ",", dateFormat: "MDY", decimal: ".", headerRow: null, sign: "signed" },
    content: csv(rows),
  });
}

// 4. Capital One card: ISO dates, separate Debit and Credit columns, a card-number column.
{
  const truth = make({ seed: 4, start: "2026-01-03", days: 30, count: 15, merchants: US, incomes: ["CAPITAL ONE MOBILE PYMT"], opening: 0 });
  const rows = [["Transaction Date", "Posted Date", "Card No.", "Description", "Category", "Debit", "Credit"]];
  for (const t of truth) {
    rows.push([t.date, addDays(t.date, 1), "4821", t.description, t.category === "Income" ? "Payment/Credit" : t.category!, t.amount < 0 ? plain(-t.amount) : "", t.amount > 0 ? plain(t.amount) : ""]);
  }
  fixtures.push({
    name: "capital-one-card", bank: "Capital One (credit card)", region: "US",
    note: "ISO dates, a posting date next to the transaction date, separate Debit and Credit columns.",
    truth: truth.map((t) => ({ date: t.date, amount: t.amount, description: t.description, category: t.category === "Income" ? "Payment/Credit" : t.category! })),
    skipped: 0,
    detection: { delimiter: ",", dateFormat: "YMD", decimal: ".", sign: "split", headerRow: 0 },
    content: csv(rows),
  });
}

// 5. American Express: charges are positive, payments negative.
{
  const truth = make({ seed: 5, start: "2026-03-01", days: 30, count: 15, merchants: US, incomes: ["AUTOPAY PAYMENT - THANK YOU"], opening: 0 });
  const rows = [["Date", "Description", "Amount"], ...truth.map((t) => [mdy(t.date), t.description, plain(-t.amount)])];
  fixtures.push({
    name: "amex", bank: "American Express", region: "US",
    note: "Charges are positive and payments negative, the opposite of a bank account.",
    truth: truth.map((t) => ({ date: t.date, amount: t.amount, description: t.description })), skipped: 0,
    detection: { delimiter: ",", dateFormat: "MDY", decimal: ".", sign: "inverted" },
    content: csv(rows),
  });
}

// 6. Monzo: 18 columns, day-first dates, Amount plus Money Out / Money In.
{
  const truth = make({ seed: 6, start: "2026-01-04", days: 30, count: 16, merchants: UK, incomes: ["SALARY ACME LTD"], opening: 120_000 });
  const rows = [["Transaction ID", "Date", "Time", "Type", "Name", "Emoji", "Category", "Amount", "Currency", "Local amount", "Local currency", "Notes and #tags", "Address", "Receipt", "Description", "Category split", "Money Out", "Money In"]];
  truth.forEach((t, i) => {
    const name = t.description.split(" ").slice(0, 2).join(" ");
    rows.push([`tx_0000A${1000 + i}`, dmy(t.date), `${pad(8 + (i % 12))}:${pad((i * 7) % 60)}:00`, t.amount < 0 ? "Card payment" : "Faster payment", name, "", t.category === "Income" ? "Income" : t.category!, plain(t.amount), "GBP", plain(t.amount), "GBP", "", "", "", `${t.description} LONDON GBR`, "", t.amount < 0 ? plain(t.amount) : "", t.amount > 0 ? plain(t.amount) : ""]);
  });
  fixtures.push({
    name: "monzo", bank: "Monzo", region: "UK",
    note: "Eighteen columns, including Local amount and Money Out / Money In next to Amount.",
    truth: truth.map((t) => ({ date: t.date, amount: t.amount, description: `${t.description} LONDON GBR`, currency: "GBP", category: t.category === "Income" ? "Income" : t.category! })),
    skipped: 0,
    detection: { delimiter: ",", dateFormat: "DMY", decimal: ".", sign: "signed" },
    content: csv(rows),
  });
}

// 7. Revolut: timestamps, a Fee column, a running Balance.
{
  const truth = make({ seed: 7, start: "2026-02-02", days: 30, count: 16, merchants: UK, incomes: ["Top-Up by *1234"], opening: 50_000 });
  const rows = [["Type", "Product", "Started Date", "Completed Date", "Description", "Amount", "Fee", "Currency", "State", "Balance"]];
  truth.forEach((t, i) => {
    rows.push([t.amount < 0 ? "CARD_PAYMENT" : "TOPUP", "Current", `${t.date} ${pad(9 + (i % 10))}:14:0${i % 10}`, `${addDays(t.date, i % 2)} 10:02:11`, t.description, plain(t.amount), "0.00", "GBP", "COMPLETED", plain(t.balance!)]);
  });
  fixtures.push({
    name: "revolut", bank: "Revolut", region: "UK / EU",
    note: "Date-time stamps, a Fee column that isn't the amount, and a running balance that confirms the signs.",
    truth: truth.map(({ category, ...t }) => ({ ...t, currency: "GBP" })), skipped: 0,
    detection: { delimiter: ",", dateFormat: "YMD", decimal: ".", sign: "signed", order: "ascending" },
    content: csv(rows),
  });
}

// 8. Sparkasse (Germany): semicolons, decimal commas, DD.MM.YY, Windows-1252 encoding.
{
  const truth = make({ seed: 8, start: "2026-01-02", days: 30, count: 15, merchants: DE, incomes: ["ACME GmbH"], opening: 300_000 });
  const rows = [["Auftragskonto", "Buchungstag", "Valutadatum", "Buchungstext", "Verwendungszweck", "Beguenstigter/Zahlungspflichtiger", "Kontonummer/IBAN", "BIC (SWIFT-Code)", "Betrag", "Waehrung", "Info"].map(q)];
  truth.forEach((t, i) => {
    const income = t.amount > 0;
    rows.push([
      "DE44500105175407324931", dmyShort(t.date), dmyShort(addDays(t.date, i % 2)), income ? "GUTSCHR. UEBERWEISUNG" : "KARTENZAHLUNG",
      income ? "Gehalt Januar 2026" : `${dmy(t.date, ".")} Karte 1 Kartenzahlung`, t.description, "DE89370400440532013000", "COBADEFFXXX", eu(t.amount), "EUR", "Umsatz gebucht",
    ].map(q));
  });
  fixtures.push({
    name: "sparkasse", bank: "Sparkasse", region: "Germany",
    note: "Semicolons, 1.234,56 amounts, DD.MM.YY dates, every cell quoted, and Windows-1252 encoding (ä, ü).",
    truth: truth.map((t) => ({ date: t.date, amount: t.amount, description: t.description, currency: "EUR" })), skipped: 0,
    detection: { delimiter: ";", dateFormat: "DMY", decimal: ",", sign: "signed" },
    content: Buffer.from(csv(rows, ";"), "latin1"),
  });
}

// 9. ING (Netherlands): YYYYMMDD, unsigned amounts with an Af/Bij column.
{
  const truth = make({ seed: 9, start: "2026-01-02", days: 30, count: 15, merchants: NL, incomes: ["ACME BV SALARIS"], opening: 200_000 }).reverse();
  const rows = [["Datum", "Naam / Omschrijving", "Rekening", "Tegenrekening", "Code", "Af Bij", "Bedrag (EUR)", "Mutatiesoort", "Mededelingen"].map(q)];
  for (const t of truth) {
    rows.push([compact(t.date), t.description, "NL20INGB0001234567", t.amount > 0 ? "NL91ABNA0417164300" : "", t.amount > 0 ? "OV" : "BA", t.amount < 0 ? "Af" : "Bij", eu(Math.abs(t.amount)), t.amount > 0 ? "Overschrijving" : "Betaalautomaat", t.amount > 0 ? "Salaris januari" : `Pasvolgnr: 001 ${dmy(t.date, "-")}`].map(q));
  }
  fixtures.push({
    name: "ing-nl", bank: "ING", region: "Netherlands",
    note: "YYYYMMDD dates, unsigned amounts, and the direction in an Af/Bij (out/in) column.",
    truth: truth.map((t) => ({ date: t.date, amount: t.amount, description: t.description })), skipped: 0,
    detection: { delimiter: ";", dateFormat: "YMD", decimal: ",", sign: "direction", order: "descending" },
    content: csv(rows, ";"),
  });
}

// 10. Barclays (UK): no description column, the text is in Memo; an account column that looks like a date.
{
  const truth = make({ seed: 10, start: "2026-01-02", days: 30, count: 15, merchants: UK, incomes: ["ACME LTD SALARY"], opening: 150_000 });
  const rows = [["Number", "Date", "Account", "Amount", "Subcategory", "Memo"]];
  for (const t of truth) {
    const [, m, d] = parts(t.date);
    rows.push(["", dmy(t.date), "20-32-06 13152170", plain(t.amount), t.amount > 0 ? "DIRECTDEP" : "PAYMENT", `${t.description}    ON ${pad(d)} ${MON[m - 1]!.toUpperCase()} BCC`]);
  }
  fixtures.push({
    name: "barclays-uk", bank: "Barclays", region: "UK",
    note: "The merchant is in Memo with padded spaces, and the sort-code column (20-32-06) looks like a date.",
    truth: truth.map((t) => {
      const [, m, d] = parts(t.date);
      return { date: t.date, amount: t.amount, description: `${t.description} ON ${pad(d)} ${MON[m - 1]!.toUpperCase()} BCC` };
    }),
    skipped: 0,
    detection: { delimiter: ",", dateFormat: "DMY", decimal: ".", sign: "signed" },
    content: csv(rows),
  });
}

// 11. CommBank (Australia): no header, amount and balance both signed with + and -.
{
  const truth = make({ seed: 11, start: "2026-01-02", days: 30, count: 16, merchants: AU, incomes: ["SALARY ACME PTY LTD"], opening: 240_000 });
  const sgn = (n: number) => (n >= 0 ? "+" : "") + plain(n);
  const rows = truth.map((t) => [dmy(t.date), q(sgn(t.amount)), q(t.description), q(sgn(t.balance!))]);
  fixtures.push({
    name: "commbank-au", bank: "Commonwealth Bank", region: "Australia",
    note: "No header and two signed number columns; the one that changes by the other each row is the balance.",
    truth: truth.map(({ category, ...t }) => t), skipped: 0,
    detection: { delimiter: ",", dateFormat: "DMY", decimal: ".", headerRow: null, sign: "signed", order: "ascending" },
    content: csv(rows),
  });
}

// 12. Wise: 19 columns, DD-MM-YYYY, currency per row.
{
  const truth = make({ seed: 12, start: "2026-02-01", days: 28, count: 14, merchants: NL, incomes: ["Received money from ACME BV"], opening: 90_000 }).reverse();
  const head = ["TransferWise ID", "Date", "Amount", "Currency", "Description", "Payment Reference", "Running Balance", "Exchange From", "Exchange To", "Exchange Rate", "Payer Name", "Payee Name", "Payee Account Number", "Merchant", "Card Last Four Digits", "Card Holder Full Name", "Attachment", "Note", "Total fees"];
  const desc = (t: Truth) => (t.amount > 0 ? t.description : `Card transaction of ${plain(-t.amount)} EUR issued by ${t.description} AMSTERDAM`);
  const rows = [head];
  truth.forEach((t, i) => {
    rows.push([`CARD-${4_000_000 + i}`, dmy(t.date, "-"), plain(t.amount), "EUR", q(desc(t)), "", plain(t.balance!), "", "", "", t.amount > 0 ? "ACME BV" : "", "", "", t.amount < 0 ? t.description : "", t.amount < 0 ? "1234" : "", "Alex Doe", "", "", "0.00"]);
  });
  fixtures.push({
    name: "wise", bank: "Wise", region: "International",
    note: "Nineteen columns, DD-MM-YYYY dates, and Merchant, Payee Name and Description all competing to be the description.",
    truth: truth.map((t) => ({ date: t.date, amount: t.amount, description: desc(t), balance: t.balance!, currency: "EUR" })), skipped: 0,
    detection: { delimiter: ",", dateFormat: "DMY", decimal: ".", sign: "signed", order: "descending" },
    content: csv(rows),
  });
}

// 13. Boursorama (France): semicolons, ISO dates, decimal commas, a balance column that never changes.
{
  const truth = make({ seed: 13, start: "2026-01-02", days: 30, count: 14, merchants: FR, incomes: ["VIR SALAIRE ACME SAS"], opening: 210_000 }).reverse();
  const rows = [["dateOp", "dateVal", "label", "category", "categoryParent", "supplierFound", "amount", "comment", "accountNum", "accountLabel", "accountbalance"]];
  for (const t of truth) {
    rows.push([t.date, t.date, q(t.description), q(t.category === "Income" ? "Salaires" : t.category!), q("Vie quotidienne"), q(t.description.toLowerCase()), eu(t.amount), "", "00040123456", q("Compte courant"), eu(truth[0]!.balance!)]);
  }
  fixtures.push({
    name: "boursorama-fr", bank: "Boursorama", region: "France",
    note: "Semicolons, ISO dates and decimal commas; the balance column repeats today's balance, so it can't be used to check signs.",
    truth: truth.map((t) => ({ date: t.date, amount: t.amount, description: t.description, category: t.category === "Income" ? "Salaires" : t.category! })),
    skipped: 0,
    detection: { delimiter: ";", dateFormat: "YMD", decimal: ",", sign: "signed" },
    content: csv(rows, ";"),
  });
}

// 14. Ambiguous US dates: every day is 12 or under, so only the row order tells month-first.
{
  const truth = make({ seed: 14, start: "2026-01-02", days: 80, count: 14, merchants: US, incomes: ["ACME PAYROLL"], opening: 100_000, maxDay: 12 });
  const rows = [["Date", "Description", "Amount"], ...truth.map((t) => [mdy(t.date), t.description, plain(t.amount)])];
  fixtures.push({
    name: "ambiguous-mdy", bank: "Ambiguous dates (month first)", region: "Edge case",
    note: "Every day is 12 or under, so 02/03 could be either; only the row order settles it.",
    truth: truth.map((t) => ({ date: t.date, amount: t.amount, description: t.description })), skipped: 0,
    detection: { dateFormat: "MDY" },
    content: csv(rows),
  });
}

// 15. Ambiguous day-first dates.
{
  const truth = make({ seed: 15, start: "2026-03-01", days: 80, count: 14, merchants: UK, incomes: ["ACME LTD"], opening: 100_000, maxDay: 12 });
  const rows = [["Date", "Description", "Amount"], ...truth.map((t) => [dmy(t.date), t.description, plain(t.amount)])];
  fixtures.push({
    name: "ambiguous-dmy", bank: "Ambiguous dates (day first)", region: "Edge case",
    note: "The same puzzle the other way round: day-first dates that never go above 12.",
    truth: truth.map((t) => ({ date: t.date, amount: t.amount, description: t.description })), skipped: 0,
    detection: { dateFormat: "DMY" },
    content: csv(rows),
  });
}

// 16. Messy export: quotes, embedded commas and line breaks, parentheses, a totals row, UTF-16 from Excel.
{
  const truth: Truth[] = [
    { date: "2026-04-01", amount: -1250, description: 'Joe\'s "Famous" Pizza, Brooklyn' },
    { date: "2026-04-02", amount: -899, description: "Corner Shop Line one Line two" },
    { date: "2026-04-03", amount: 250000, description: "Payroll" },
    { date: "2026-04-04", amount: -4510, description: "Café Nero" },
    { date: "2026-04-05", amount: -120000, description: "Rent - April" },
    { date: "2026-04-06", amount: 1550, description: "Refund: Café Nero" },
  ];
  const rows = [
    ["Date", "Description", "Amount"],
    ["04/01/2026", q(truth[0]!.description), "(12.50)"],
    ["04/02/2026", '"Corner Shop\nLine one\r\nLine two"', "-8.99"],
    ["04/03/2026", "Payroll", "2,500.00"].map((c, i) => (i === 2 ? q(c) : c)),
    ["04/04/2026", "Café Nero", "−45.10"],
    ["04/05/2026", "Rent - April", "1,200.00-"].map((c, i) => (i === 2 ? q(c) : c)),
    ["04/06/2026", "Refund: Café Nero", "+15.50"],
    ["Total", "", q("1,153.41")],
  ];
  const text = "﻿" + rows.map((r) => r.join("\t")).join("\r\n") + "\r\n";
  fixtures.push({
    name: "messy-utf16", bank: "Messy spreadsheet export", region: "Edge case",
    note: "UTF-16 from Excel, tab-separated, quotes and line breaks inside cells, (12.50), 1,200.00-, a Unicode minus and a totals row.",
    truth, skipped: 1,
    detection: { delimiter: "\t", dateFormat: "MDY", decimal: ".", sign: "signed" },
    content: Buffer.from(text, "utf16le"),
  });
}

mkdirSync(OUT, { recursive: true });
const index: { name: string; bank: string; region: string; note: string; rows: number }[] = [];
for (const f of fixtures) {
  writeFileSync(join(OUT, `${f.name}.csv`), f.content);
  const { content, ...meta } = f;
  writeFileSync(join(OUT, `${f.name}.expected.json`), JSON.stringify(meta, null, 2) + "\n");
  index.push({ name: f.name, bank: f.bank, region: f.region, note: f.note, rows: f.truth.length });
}
writeFileSync(join(OUT, "index.json"), JSON.stringify(index, null, 2) + "\n");
console.log(`Wrote ${fixtures.length} fixtures to ${OUT}`);
