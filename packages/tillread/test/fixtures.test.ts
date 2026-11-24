import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parse } from "../src";

const DIR = join(import.meta.dirname, "fixtures");
const names = readdirSync(DIR)
  .filter((f) => f.endsWith(".csv"))
  .map((f) => f.slice(0, -4));

interface Expected {
  bank: string;
  truth: { date: string; amount: number; description: string; balance?: number; currency?: string; category?: string }[];
  skipped: number;
  detection: Record<string, unknown>;
}

describe.each(names)("%s", (name) => {
  const expected = JSON.parse(readFileSync(join(DIR, `${name}.expected.json`), "utf8")) as Expected;
  // Bytes, not text: the encoding is part of what's being tested.
  const bytes = readFileSync(join(DIR, `${name}.csv`));
  const result = parse(new Uint8Array(bytes));

  it("detects the layout", () => {
    expect(result.detection).toMatchObject(expected.detection);
  });

  it("reads every transaction exactly", () => {
    const got = result.transactions.map((t, i) => {
      const want = expected.truth[i];
      const pick: Record<string, unknown> = { date: t.date, amount: t.amount, description: t.description };
      for (const k of ["balance", "currency", "category"] as const) if (want && k in want) pick[k] = t[k];
      return pick;
    });
    expect(got).toEqual(expected.truth);
  });

  it("reports the rows it skipped", () => {
    expect(result.skipped).toHaveLength(expected.skipped);
  });

  it("is confident when nothing was guessed", () => {
    if (result.detection.warnings.length === 0) expect(result.detection.confidence).toBeGreaterThanOrEqual(0.7);
  });
});
