/** Times parse() on generated files. Run: npm run build && node scripts/bench.ts */
import { parse } from "../dist/index.js";

for (const n of [1_000, 10_000, 100_000]) {
  const rows = ["Date,Description,Amount,Balance"];
  for (let i = 0; i < n; i++) {
    rows.push(`${String((i % 12) + 1).padStart(2, "0")}/${String((i % 28) + 1).padStart(2, "0")}/2026,"Shop ${i}, Inc",-${(i % 500) + 1}.25,"${(i * 3).toLocaleString("en-US")}.00"`);
  }
  const text = rows.join("\n");
  parse(text); // warm up
  const runs = n >= 100_000 ? 5 : 20;
  const t = performance.now();
  for (let r = 0; r < runs; r++) parse(text);
  const ms = (performance.now() - t) / runs;
  console.log(`${n.toLocaleString("en-US").padStart(8)} rows  ${(text.length / 1e6).toFixed(1).padStart(4)} MB  ${ms.toFixed(1).padStart(7)} ms  ${Math.round(n / (ms / 1000)).toLocaleString("en-US")} rows/s`);
}
