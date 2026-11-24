"use client";

import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import { formatMinor, parse, toCSV, type ColumnMap, type DateFormat, type DecimalSeparator, type ParseOptions, type SignConvention } from "tillread";
import samples from "../../packages/tillread/test/fixtures/index.json";
import { CopyButton } from "./ui";

type Source = { kind: "sample"; name: string; bytes: Uint8Array } | { kind: "file"; name: string; bytes: Uint8Array } | { kind: "paste"; name: string; text: string };

const MAX_BYTES = 10 * 1024 * 1024;
const SHOW_ROWS = 200;

const ROLE_LABEL: Record<keyof ColumnMap, string> = {
  date: "date",
  description: "description",
  memo: "memo",
  amount: "amount",
  debit: "money out",
  credit: "money in",
  direction: "direction",
  balance: "balance",
  currency: "currency",
  category: "category",
  reference: "reference",
};
const ROLE_COLOR: Partial<Record<keyof ColumnMap, string>> = {
  date: "var(--role-date)",
  description: "var(--role-desc)",
  memo: "var(--role-desc)",
  amount: "var(--role-amount)",
  debit: "var(--role-amount)",
  credit: "var(--role-amount)",
  direction: "var(--role-amount)",
  balance: "var(--role-balance)",
};

const SIGN_LABEL: Record<SignConvention, string> = {
  signed: "Signed (negative = out)",
  inverted: "Inverted (positive = out)",
  split: "Separate debit / credit",
  direction: "Direction column",
};

type Overrides = { dateFormat?: DateFormat; decimal?: DecimalSeparator; sign?: SignConvention; delimiter?: string };

export function Playground() {
  const [source, setSource] = useState<Source | null>(null);
  const [overrides, setOverrides] = useState<Overrides>({});
  const [tab, setTab] = useState<"transactions" | "raw" | "json" | "skipped">("transactions");
  const [error, setError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const [paste, setPaste] = useState("");
  const fileInput = useRef<HTMLInputElement>(null);

  const loadSample = useCallback(async (name: string) => {
    setError(null);
    try {
      const res = await fetch(`/samples/${name}.csv`);
      if (!res.ok) throw new Error(String(res.status));
      setSource({ kind: "sample", name, bytes: new Uint8Array(await res.arrayBuffer()) });
      setOverrides({});
    } catch {
      setError("Couldn't load that sample. Check your connection and try again.");
    }
  }, []);

  // First sample on mount. State is set in the fetch callbacks, not synchronously in the effect.
  useEffect(() => {
    let alive = true;
    fetch("/samples/sparkasse.csv")
      .then((res) => (res.ok ? res.arrayBuffer() : Promise.reject(new Error(String(res.status)))))
      .then((buf) => alive && setSource((s) => s ?? { kind: "sample", name: "sparkasse", bytes: new Uint8Array(buf) }))
      .catch(() => alive && setError("Couldn't load the sample. Check your connection and try again."));
    return () => {
      alive = false;
    };
  }, []);

  const loadFile = async (file: File) => {
    setError(null);
    if (file.size > MAX_BYTES) return setError("That file is over 10 MB. Try exporting a shorter date range.");
    setSource({ kind: "file", name: file.name, bytes: new Uint8Array(await file.arrayBuffer()) });
    setOverrides({});
    setTab("transactions");
  };

  const deferredSource = useDeferredValue(source);
  const deferredOverrides = useDeferredValue(overrides);
  const result = useMemo(() => {
    if (!deferredSource) return null;
    const input = deferredSource.kind === "paste" ? deferredSource.text : deferredSource.bytes;
    const opts: ParseOptions = {};
    for (const [k, v] of Object.entries(deferredOverrides)) if (v) (opts as Record<string, unknown>)[k] = v;
    return { ...parse(input, opts), opts };
  }, [deferredSource, deferredOverrides]);

  const roles = useMemo(() => {
    const m = new Map<number, keyof ColumnMap>();
    if (result) for (const [k, v] of Object.entries(result.detection.columns)) if (typeof v === "number") m.set(v, k as keyof ColumnMap);
    return m;
  }, [result]);

  const download = () => {
    if (!result) return;
    const url = URL.createObjectURL(new Blob([toCSV(result.transactions)], { type: "text/csv;charset=utf-8" }));
    const a = Object.assign(document.createElement("a"), { href: url, download: `${(source?.name ?? "transactions").replace(/\.\w+$/, "")}-clean.csv` });
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  const snippet = useMemo(() => {
    const entries = Object.entries(result?.opts ?? {});
    const opts = entries.length ? `, { ${entries.map(([k, v]) => `${k}: ${JSON.stringify(v)}`).join(", ")} }` : "";
    return `import { parse } from "tillread";\n\nconst bytes = new Uint8Array(await file.arrayBuffer());\nconst { transactions, skipped, detection } = parse(bytes${opts});`;
  }, [result]);

  const d = result?.detection;
  const currency = result?.transactions.find((t) => t.currency)?.currency;
  const money = (n: number) => {
    const s = formatMinor(n);
    const [w, f] = s.replace("-", "").split(".");
    const grouped = `${w!.replace(/\B(?=(\d{3})+(?!\d))/g, ",")}.${f}`;
    return (n < 0 ? "−" : "") + grouped;
  };

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_340px]">
      {/* Input */}
      <div className="min-w-0 rounded-2xl border border-line bg-surface p-4 sm:p-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-sm font-semibold">1. Pick a bank export, or bring your own</h3>
          <span className="text-xs text-muted">Files never leave your browser.</span>
        </div>
        <div className="mt-3 flex flex-wrap gap-1.5" role="group" aria-label="Sample files">
          {samples.map((s) => {
            const active = source?.kind === "sample" && source.name === s.name;
            return (
              <button
                key={s.name}
                type="button"
                onClick={() => void loadSample(s.name)}
                aria-pressed={active}
                title={s.note}
                className={`rounded-full border px-3 py-1 text-xs transition ${
                  active ? "border-accent bg-accent text-accent-ink" : "border-line text-muted hover:border-line-strong hover:text-ink"
                }`}
              >
                {s.bank.replace(/ \((checking|credit card)\)$/, "").replace("Ambiguous dates", "Ambiguous")}
              </button>
            );
          })}
        </div>

        <div
          onDragOver={(e) => {
            e.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragging(false);
            const f = e.dataTransfer.files[0];
            if (f) void loadFile(f);
          }}
          className={`mt-4 grid gap-3 rounded-xl border border-dashed p-4 transition sm:grid-cols-[auto_minmax(0,1fr)] sm:items-center ${
            dragging ? "border-accent bg-accent-soft" : "border-line-strong"
          }`}
        >
          <button
            type="button"
            onClick={() => fileInput.current?.click()}
            className="rounded-lg bg-ink px-4 py-2 text-sm font-medium text-bg transition hover:opacity-90"
          >
            Choose a CSV…
          </button>
          <p className="text-sm text-muted">or drop one here. Any bank, any encoding, up to 10 MB.</p>
          <input
            ref={fileInput}
            type="file"
            aria-label="Upload a CSV file"
            tabIndex={-1}
            accept=".csv,.txt,.tsv,text/csv,text/plain"
            className="sr-only"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void loadFile(f);
              e.target.value = "";
            }}
          />
        </div>

        <details className="group mt-3">
          <summary className="cursor-pointer text-sm text-muted transition hover:text-ink">Or paste CSV text</summary>
          <textarea
            value={paste}
            onChange={(e) => {
              setPaste(e.target.value);
              if (e.target.value.trim()) setSource({ kind: "paste", name: "pasted", text: e.target.value });
            }}
            rows={5}
            spellCheck={false}
            placeholder={"Date,Description,Amount\n03/01/2026,Coffee,-4.50"}
            className="mt-2 w-full rounded-lg border border-line bg-bg p-3 font-mono text-xs outline-none focus:border-accent"
            aria-label="CSV text"
          />
        </details>
        {error && (
          <p role="alert" className="mt-3 rounded-lg bg-warn-soft px-3 py-2 text-sm text-warn">
            {error}
          </p>
        )}
      </div>

      {/* Detection */}
      <aside className="rounded-2xl border border-line bg-surface p-4 sm:p-5" aria-live="polite">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold">2. What Tillread worked out</h3>
        </div>
        {d ? (
          <>
            <Confidence value={d.confidence} />
            <dl className="mt-4 grid grid-cols-[auto_minmax(0,1fr)] items-center gap-x-3 gap-y-2 text-sm">
              <dt className="text-muted">Delimiter</dt>
              <dd>
                <Select
                  label="Delimiter"
                  value={overrides.delimiter ?? ""}
                  auto={d.delimiter === "\t" ? "tab" : d.delimiter}
                  options={[[",", ","], [";", ";"], ["\t", "tab"], ["|", "|"]]}
                  onChange={(v) => setOverrides((o) => ({ ...o, delimiter: v || undefined }))}
                />
              </dd>
              <dt className="text-muted">Dates</dt>
              <dd>
                <Select
                  label="Date order"
                  value={overrides.dateFormat ?? ""}
                  auto={{ YMD: "Year first", DMY: "Day first", MDY: "Month first" }[d.dateFormat]}
                  options={[["YMD", "Year first"], ["DMY", "Day first"], ["MDY", "Month first"]]}
                  onChange={(v) => setOverrides((o) => ({ ...o, dateFormat: (v || undefined) as DateFormat | undefined }))}
                />
              </dd>
              <dt className="text-muted">Decimal</dt>
              <dd>
                <Select
                  label="Decimal separator"
                  value={overrides.decimal ?? ""}
                  auto={d.decimal === "," ? "Comma (1.234,56)" : "Dot (1,234.56)"}
                  options={[[".", "Dot (1,234.56)"], [",", "Comma (1.234,56)"]]}
                  onChange={(v) => setOverrides((o) => ({ ...o, decimal: (v || undefined) as DecimalSeparator | undefined }))}
                />
              </dd>
              <dt className="text-muted">Signs</dt>
              <dd>
                <Select
                  label="Sign convention"
                  value={overrides.sign ?? ""}
                  auto={SIGN_LABEL[d.sign]}
                  options={Object.entries(SIGN_LABEL) as [string, string][]}
                  onChange={(v) => setOverrides((o) => ({ ...o, sign: (v || undefined) as SignConvention | undefined }))}
                />
              </dd>
              <dt className="text-muted">Header</dt>
              <dd className="truncate">{d.headerRow == null ? "None (read from contents)" : d.headerRow === 0 ? "First row" : `Row ${d.headerRow + 1}`}</dd>
              <dt className="text-muted">Order</dt>
              <dd>{d.order === "unknown" ? "Mixed" : d.order === "descending" ? "Newest first" : "Oldest first"}</dd>
            </dl>
            {d.warnings.length > 0 && (
              <ul className="mt-4 space-y-1.5">
                {d.warnings.map((w) => (
                  <li key={w} className="rounded-lg bg-warn-soft px-3 py-2 text-xs leading-relaxed text-warn">
                    {w}
                  </li>
                ))}
              </ul>
            )}
            <ul className="mt-4 space-y-1 border-t border-line pt-3 text-xs leading-relaxed text-muted">
              {d.notes.map((n) => (
                <li key={n} className="flex gap-2">
                  <span aria-hidden className="mt-[7px] size-1 shrink-0 rounded-full bg-line-strong" />
                  {n}
                </li>
              ))}
            </ul>
          </>
        ) : (
          <div className="mt-4 space-y-2" aria-hidden>
            {[0, 1, 2, 3, 4].map((i) => (
              <div key={i} className="h-6 animate-pulse rounded bg-surface-2" />
            ))}
          </div>
        )}
      </aside>

      {/* Results */}
      <div className="min-w-0 rounded-2xl border border-line bg-surface lg:col-span-2">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-4 py-3 sm:px-5">
          <div role="tablist" aria-label="Results" className="flex flex-wrap gap-1">
            {(
              [
                ["transactions", `Transactions${result ? ` · ${result.transactions.length.toLocaleString("en-US")}` : ""}`],
                ["raw", "Raw file"],
                ["json", "JSON"],
                ["skipped", `Skipped${result ? ` · ${result.skipped.length}` : ""}`],
              ] as const
            ).map(([id, label]) => (
              <button
                key={id}
                role="tab"
                type="button"
                aria-selected={tab === id}
                onClick={() => setTab(id)}
                className={`rounded-lg px-3 py-1.5 text-sm transition ${tab === id ? "bg-surface-2 font-medium text-ink" : "text-muted hover:text-ink"}`}
              >
                {label}
              </button>
            ))}
          </div>
          <button
            type="button"
            onClick={download}
            disabled={!result?.transactions.length}
            className="rounded-lg border border-line px-3 py-1.5 text-sm transition hover:border-line-strong disabled:opacity-40"
          >
            Download clean CSV
          </button>
        </div>

        <div role="tabpanel" className="min-w-0">
          {!result ? (
            <div className="h-64 animate-pulse bg-surface-2/50" />
          ) : tab === "transactions" ? (
            result.transactions.length === 0 ? (
              <Empty text="No transactions found. Try another delimiter or date order above." />
            ) : (
              <div className="max-h-[480px] overflow-auto">
                <table className="w-full min-w-[560px] text-sm">
                  <thead className="sticky top-0 bg-surface text-left text-xs text-muted">
                    <tr className="border-b border-line">
                      <th className="px-4 py-2 font-medium sm:px-5">Date</th>
                      <th className="px-2 py-2 font-medium">Description</th>
                      <th className="px-2 py-2 text-right font-medium">Amount{currency ? ` (${currency})` : ""}</th>
                      {result.transactions.some((t) => t.balance != null) && <th className="px-4 py-2 text-right font-medium sm:px-5">Balance</th>}
                    </tr>
                  </thead>
                  <tbody>
                    {result.transactions.slice(0, SHOW_ROWS).map((t) => (
                      <tr key={t.line} className="border-b border-line/60 last:border-0 hover:bg-surface-2/60">
                        <td className="whitespace-nowrap px-4 py-2 font-mono text-xs tabular sm:px-5">{t.date}</td>
                        <td className="max-w-[420px] truncate px-2 py-2" title={t.memo ? `${t.description} · ${t.memo}` : t.description}>
                          {t.description}
                          {t.category && <span className="ml-2 rounded bg-surface-2 px-1.5 py-0.5 text-[11px] text-muted">{t.category}</span>}
                        </td>
                        <td className={`whitespace-nowrap px-2 py-2 text-right font-mono text-xs tabular ${t.amount < 0 ? "text-neg" : "text-pos"}`}>
                          {t.amount > 0 ? "+" : ""}
                          {money(t.amount)}
                        </td>
                        {result.transactions.some((x) => x.balance != null) && (
                          <td className="whitespace-nowrap px-4 py-2 text-right font-mono text-xs text-muted tabular sm:px-5">{t.balance != null ? money(t.balance) : ""}</td>
                        )}
                      </tr>
                    ))}
                  </tbody>
                </table>
                {result.transactions.length > SHOW_ROWS && (
                  <p className="px-5 py-3 text-xs text-muted">
                    Showing {SHOW_ROWS} of {result.transactions.length.toLocaleString("en-US")}. The download has all of them.
                  </p>
                )}
              </div>
            )
          ) : tab === "raw" ? (
            <div className="max-h-[480px] overflow-auto">
              <table className="w-full text-xs">
                <thead className="sticky top-0 bg-surface text-left">
                  <tr className="border-b border-line">
                    {d!.headers.map((h, i) => {
                      const role = roles.get(i);
                      return (
                        <th key={i} className="whitespace-nowrap px-3 py-2 align-bottom font-medium">
                          {role ? (
                            <span className="mb-1 block text-[10px] font-semibold uppercase tracking-wide" style={{ color: ROLE_COLOR[role] ?? "var(--role-other)" }}>
                              {ROLE_LABEL[role]}
                            </span>
                          ) : (
                            <span className="mb-1 block text-[10px] uppercase tracking-wide text-line-strong">ignored</span>
                          )}
                          <span className={role ? "text-ink" : "text-muted"}>{h}</span>
                        </th>
                      );
                    })}
                  </tr>
                </thead>
                <tbody className="font-mono">
                  {result.transactions.slice(0, 40).map((t) => (
                    <tr key={t.line} className="border-b border-line/60">
                      {d!.headers.map((_, i) => (
                        <td key={i} className={`max-w-[260px] truncate whitespace-nowrap px-3 py-1.5 ${roles.has(i) ? "" : "text-muted/70"}`}>
                          {t.raw[i]}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : tab === "json" ? (
            <pre className="max-h-[480px] overflow-auto bg-code-bg p-4 font-mono text-xs leading-relaxed text-code-ink sm:p-5">
              {JSON.stringify(result.transactions.slice(0, 20).map((t) => Object.fromEntries(Object.entries(t).filter(([k]) => k !== "raw"))), null, 2)}
              {result.transactions.length > 20 ? `\n// …and ${result.transactions.length - 20} more` : ""}
            </pre>
          ) : result.skipped.length === 0 ? (
            <Empty text="Nothing skipped. Every row with a date became a transaction." />
          ) : (
            <ul className="divide-y divide-line">
              {result.skipped.map((s) => (
                <li key={s.line} className="flex flex-wrap items-baseline gap-x-3 gap-y-1 px-4 py-2.5 text-sm sm:px-5">
                  <span className="font-mono text-xs text-muted">line {s.line}</span>
                  <span>{s.message}</span>
                  <code className="min-w-0 truncate font-mono text-xs text-muted">{s.raw.filter(Boolean).join(" · ")}</code>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      <div className="min-w-0 lg:col-span-2">
        <div className="overflow-hidden rounded-xl border border-line bg-code-bg text-code-ink">
          <div className="flex items-center justify-between border-b border-white/10 px-4 py-2">
            <span className="font-mono text-xs text-white/55">The same thing in your code</span>
            <CopyButton text={snippet} className="text-white/60 hover:bg-white/10 hover:text-white" />
          </div>
          <pre className="overflow-x-auto p-4 font-mono text-[13px] leading-relaxed">{snippet}</pre>
        </div>
      </div>
    </div>
  );
}

function Confidence({ value }: { value: number }) {
  const pct = Math.round(value * 100);
  const tone = value >= 0.7 ? "var(--accent)" : "var(--warn)";
  return (
    <div className="mt-3">
      <div className="flex items-baseline justify-between text-xs">
        <span className="text-muted">Confidence</span>
        <span className="font-mono font-medium" style={{ color: tone }}>
          {pct}%
        </span>
      </div>
      <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-surface-2" role="meter" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct} aria-label="Confidence">
        <div className="h-full rounded-full transition-[width] duration-300" style={{ width: `${pct}%`, background: tone }} />
      </div>
      <p className="mt-1.5 text-[11px] text-muted">{value >= 0.7 ? "Safe to import as is." : "Worth a look before importing."}</p>
    </div>
  );
}

function Select({
  label,
  value,
  auto,
  options,
  onChange,
}: {
  label: string;
  value: string;
  auto: string;
  options: [string, string][];
  onChange: (v: string) => void;
}) {
  return (
    <select
      aria-label={label}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className={`w-full truncate rounded-md border bg-bg px-2 py-1 text-sm outline-none transition focus:border-accent ${value ? "border-accent" : "border-line"}`}
    >
      <option value="">Auto: {auto}</option>
      {options.map(([v, l]) => (
        <option key={v} value={v}>
          {l}
        </option>
      ))}
    </select>
  );
}

function Empty({ text }: { text: string }) {
  return <p className="px-5 py-12 text-center text-sm text-muted">{text}</p>;
}
