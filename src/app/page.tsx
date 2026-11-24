import samples from "../../packages/tillread/test/fixtures/index.json";
import pkg from "../../packages/tillread/package.json";
import { Code } from "@/components/code";
import { LazyPlayground } from "@/components/lazy-playground";
import { CopyButton, Logo, ThemeToggle } from "@/components/ui";

const GITHUB = "https://github.com/shervs336/tillread";
const NPM = "https://www.npmjs.com/package/tillread";

const STEPS = [
  {
    title: "Decode the bytes",
    body: "UTF-8 with or without a BOM, UTF-16 from Excel, or Windows-1252 from older banks. “Café” stays “Café”.",
  },
  {
    title: "Find the delimiter",
    body: "Comma, semicolon, tab or pipe: whichever splits the start of the file into the most rows of the same width. A decimal comma can't fool it.",
  },
  {
    title: "Skip the preamble",
    body: "Account summaries above the header are passed over. The header is the row just before the first row that holds a date and an amount. No header? Columns are read from their contents.",
  },
  {
    title: "Name every column",
    body: "Header words in five languages plus what the cells contain. A sort code that looks like a date, a Fee column next to Amount, a card number: each is told apart.",
  },
  {
    title: "Settle the dates once per file",
    body: "A day above 12 decides day-first or month-first. If every day is 12 or under, the reading that keeps the rows in order wins, then the one covering the shorter period. One typo can't flip the file.",
  },
  {
    title: "Get the signs right",
    body: "Debit and credit columns, DR/CR or Af/Bij flags, or one signed column. If there's a running balance, every row is checked against it, which also proves whether the file is newest-first.",
  },
];

const PRINCIPLES = [
  ["Nothing disappears", "Rows with a date or an amount that can't be read come back in skipped, with the line number and the reason."],
  ["Money as integers", "Amounts are whole cents (or any minor unit), parsed from the digits. No 0.1 + 0.2 surprises."],
  ["It explains itself", "Every decision comes with a note and a confidence score, so your import screen can show its working."],
  ["Safe to export", "toCSV defuses =HYPERLINK() and other formulas, so a hostile merchant name can't run in a spreadsheet."],
] as const;

const API_PARSE = `import { parse } from "tillread";

// A string, an ArrayBuffer or a Uint8Array. Bytes are best: tillread handles the encoding.
const { transactions, skipped, detection } = parse(bytes);

transactions[0];
// {
//   date: "2026-01-02",           ISO, always
//   amount: -7802,                integer cents, negative = money out
//   description: "Lidl sagt Danke",
//   currency: "EUR",              when the file has one
//   balance: 245118,              when the file has a running balance
//   line: 2,                      for pointing users at a row
//   raw: ["DE44…", "02.01.26", …]
// }

detection.confidence;   // 0.85
detection.notes;        // ["Delimiter: \\";\\".", "Dates: day first (some days are above 12).", …]`;

const API_OPTIONS = `// Override anything it guessed. Everything else is still detected.
parse(bytes, {
  dateFormat: "DMY",          // "YMD" | "DMY" | "MDY"
  decimal: ",",               // "." | ","
  sign: "inverted",           // "signed" | "inverted" | "split" | "direction"
  delimiter: ";",
  headerRow: 4,               // or null for a file without a header
  columns: { description: 5, memo: 4 },
  minorUnits: 0,              // JPY; 3 for KWD
  maxRows: 50_000,
});`;

const API_HELPERS = `import { detect, parseAmount, parseDate, toCSV } from "tillread";

detect(bytes);                         // just the Detection, for a preview screen
parseAmount("1.234,56 €", ",");        // 123456
parseAmount("(12.50)");                // -1250
parseAmount("12.50 DR");               // -1250
parseDate("03-Apr-26");                // "2026-04-03"
parseDate("03/04/2026", "DMY");        // "2026-04-03"
toCSV(transactions);                   // "Date,Description,Amount\\r\\n2026-01-02,…"`;

export default function Home() {
  return (
    <>
      <header className="sticky top-0 z-20 border-b border-line/70 bg-bg/85 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-6xl items-center justify-between gap-4 px-4 sm:px-6">
          <a href="#top" className="flex items-center gap-2 font-semibold tracking-tight">
            <Logo className="size-6" />
            Tillread
          </a>
          <nav aria-label="Main" className="flex items-center gap-1 text-sm">
            <a href="#playground" className="hidden rounded-md px-3 py-1.5 text-muted transition hover:text-ink sm:block">
              Playground
            </a>
            <a href="#how" className="hidden rounded-md px-3 py-1.5 text-muted transition hover:text-ink md:block">
              How it works
            </a>
            <a href="#api" className="hidden rounded-md px-3 py-1.5 text-muted transition hover:text-ink sm:block">
              API
            </a>
            <a href={GITHUB} className="rounded-md px-3 py-1.5 text-muted transition hover:text-ink">
              GitHub
            </a>
            <ThemeToggle />
          </nav>
        </div>
      </header>

      <main id="top">
        {/* Hero */}
        <section className="mx-auto grid max-w-6xl gap-12 px-4 pb-16 pt-14 sm:px-6 sm:pt-20 grid-cols-1 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)] lg:items-center">
          <div>
            <p className="font-mono text-xs uppercase tracking-[0.14em] text-muted">
              Open source · TypeScript · 0 dependencies · v{pkg.version}
            </p>
            <h1 className="mt-5 font-serif text-[2.75rem] leading-[1.02] tracking-tight sm:text-6xl">
              Every bank exports CSV differently. <span className="text-accent">Tillread reads them all.</span>
            </h1>
            <p className="mt-6 max-w-xl text-lg leading-relaxed text-muted">
              One function turns Chase, Monzo, Sparkasse, ING and a dozen other layouts into clean, typed transactions: ISO dates,
              amounts in cents, money out negative. It tells you how it decided, and what it skipped.
            </p>
            <div className="mt-8 flex flex-wrap items-center gap-3">
              <div className="flex items-center gap-1 rounded-xl border border-line bg-surface py-1.5 pl-4 pr-1.5 font-mono text-sm">
                <span className="text-muted">$</span>&nbsp;npm i tillread
                <CopyButton text="npm i tillread" className="ml-2 text-muted hover:bg-surface-2 hover:text-ink" />
              </div>
              <a href="#playground" className="rounded-xl bg-accent px-5 py-2.5 text-sm font-medium text-accent-ink transition hover:opacity-90">
                Try it on a real layout
              </a>
            </div>
            <dl className="mt-10 grid max-w-xl grid-cols-2 gap-6 sm:grid-cols-4">
              {[
                ["6.3 kB", "minified + brotli"],
                ["16", "bank layouts tested"],
                ["~200k", "rows per second"],
                ["159", "tests, incl. property tests"],
              ].map(([v, l]) => (
                <div key={l}>
                  <dt className="sr-only">{l}</dt>
                  <dd className="font-serif text-3xl">{v}</dd>
                  <dd className="mt-1 text-xs leading-snug text-muted">{l}</dd>
                </div>
              ))}
            </dl>
          </div>

          <div className="relative mx-auto w-full min-w-0 max-w-md" aria-hidden>
            <div className="receipt-edge rounded-t-2xl border border-b-0 border-line bg-surface p-5 shadow-[0_20px_50px_-30px_rgba(0,0,0,0.35)]">
              <p className="font-mono text-[11px] uppercase tracking-[0.14em] text-muted">sparkasse.csv · Windows-1252</p>
              <pre className="mt-3 overflow-hidden whitespace-pre font-mono text-[11.5px] leading-6 text-muted">
                {`"Buchungstag";"Beguenstigter…";"Betrag"\n"02.01.26";"Lidl sagt Danke";"-78,02"\n"07.01.26";"ACME GmbH";"1.858,22"\n"09.01.26";"DB Vertrieb GmbH";"-29,44"`}
              </pre>
            </div>
            <div className="mx-auto -mt-2 flex w-8 justify-center py-2 text-accent">
              <svg viewBox="0 0 24 24" className="size-6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 4v16M6 14l6 6 6-6" />
              </svg>
            </div>
            <div className="rounded-2xl border border-line bg-code-bg p-5 text-code-ink shadow-[0_24px_60px_-30px_rgba(0,0,0,0.5)]">
              <p className="font-mono text-[11px] uppercase tracking-[0.14em] text-white/50">parse(bytes).transactions</p>
              <pre className="mt-3 overflow-hidden font-mono text-[11.5px] leading-6">
                <span className="text-white/50">{"[\n  { "}</span>
                <span className="text-[#f0b8a0]">date</span>: <span className="text-[#9fd8b6]">&quot;2026-01-02&quot;</span>, <span className="text-[#f0b8a0]">amount</span>:{" "}
                <span className="text-[#e9c46a]">-7802</span>,{"\n    "}
                <span className="text-[#f0b8a0]">description</span>: <span className="text-[#9fd8b6]">&quot;Lidl sagt Danke&quot;</span>
                <span className="text-white/50">{" },\n  { "}</span>
                <span className="text-[#f0b8a0]">date</span>: <span className="text-[#9fd8b6]">&quot;2026-01-07&quot;</span>, <span className="text-[#f0b8a0]">amount</span>:{" "}
                <span className="text-[#e9c46a]">185822</span>,{"\n    "}
                <span className="text-[#f0b8a0]">description</span>: <span className="text-[#9fd8b6]">&quot;ACME GmbH&quot;</span>
                <span className="text-white/50">{" },\n  …\n]"}</span>
              </pre>
            </div>
          </div>
        </section>

        {/* Playground */}
        <section id="playground" className="border-y border-line bg-surface-2/50">
          <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6">
            <h2 className="font-serif text-4xl tracking-tight">Playground</h2>
            <p className="mt-3 max-w-2xl text-muted">
              The samples copy the exact layouts of real exports: column names, date and number styles, preambles, encodings. Change any
              guess and watch the result update. Your own file is read here, in the page.
            </p>
            <div className="mt-8">
              <LazyPlayground />
            </div>
          </div>
        </section>

        {/* How it works */}
        <section id="how" className="mx-auto max-w-6xl px-4 py-20 [content-visibility:auto] [contain-intrinsic-size:auto_1100px] sm:px-6">
          <h2 className="font-serif text-4xl tracking-tight">How it reads a file</h2>
          <p className="mt-3 max-w-2xl text-muted">Six decisions, each made once per file from the whole sample, so one odd row can&apos;t change the rest.</p>
          <ol className="mt-10 grid gap-px overflow-hidden rounded-2xl border border-line bg-line sm:grid-cols-2 lg:grid-cols-3">
            {STEPS.map((s, i) => (
              <li key={s.title} className="bg-surface p-6">
                <span className="font-mono text-xs text-accent">{String(i + 1).padStart(2, "0")}</span>
                <h3 className="mt-3 font-semibold">{s.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-muted">{s.body}</p>
              </li>
            ))}
          </ol>

          <div className="mt-16 grid gap-8 sm:grid-cols-2 lg:grid-cols-4">
            {PRINCIPLES.map(([t, b]) => (
              <div key={t} className="border-t border-line-strong pt-4">
                <h3 className="font-semibold">{t}</h3>
                <p className="mt-2 text-sm leading-relaxed text-muted">{b}</p>
              </div>
            ))}
          </div>
        </section>

        {/* Layouts */}
        <section id="layouts" className="border-y border-line bg-surface-2/50 [content-visibility:auto] [contain-intrinsic-size:auto_900px]">
          <div className="mx-auto max-w-6xl px-4 py-20 sm:px-6">
            <h2 className="font-serif text-4xl tracking-tight">Tested layouts</h2>
            <p className="mt-3 max-w-2xl text-muted">
              Each fixture is written from a known list of transactions, and the tests check every date, amount and description against
              that list, not against Tillread&apos;s own output.
            </p>
            <ul className="mt-10 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              {samples.map((s) => (
                <li key={s.name} className="rounded-xl border border-line bg-surface p-4">
                  <div className="flex items-baseline justify-between gap-2">
                    <h3 className="font-medium">{s.bank}</h3>
                    <span className="shrink-0 text-[11px] text-muted">{s.region}</span>
                  </div>
                  <p className="mt-2 text-[13px] leading-relaxed text-muted">{s.note}</p>
                </li>
              ))}
            </ul>
          </div>
        </section>

        {/* API */}
        <section id="api" className="mx-auto max-w-6xl px-4 py-20 [content-visibility:auto] [contain-intrinsic-size:auto_1000px] sm:px-6">
          <h2 className="font-serif text-4xl tracking-tight">API</h2>
          <p className="mt-3 max-w-2xl text-muted">
            ESM and CommonJS, full types, works in browsers, Node 18+, Deno, Bun and workers. Tree-shakable: importing only{" "}
            <code className="font-mono text-[0.9em]">parseAmount</code> costs about 400 bytes.
          </p>
          <div className="mt-8 grid grid-cols-1 gap-4 lg:grid-cols-2 [&>*]:min-w-0">
            <div className="lg:row-span-2">
              <Code title="parse" code={API_PARSE} />
            </div>
            <Code title="options" code={API_OPTIONS} />
            <Code title="helpers" code={API_HELPERS} />
          </div>
        </section>
      </main>

      <footer className="border-t border-line">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-4 px-4 py-8 text-sm text-muted sm:px-6">
          <p className="flex items-center gap-2">
            <Logo className="size-5" /> Tillread · MIT licensed · sample data is invented
          </p>
          <div className="flex gap-4">
            <a href={GITHUB} className="transition hover:text-ink">
              GitHub
            </a>
            <a href={NPM} className="transition hover:text-ink">
              npm
            </a>
            <a href={`${GITHUB}/blob/main/docs/case-study.md`} className="transition hover:text-ink">
              Case study
            </a>
          </div>
        </div>
      </footer>
    </>
  );
}
