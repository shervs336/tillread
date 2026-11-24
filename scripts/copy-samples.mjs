// Copies the test fixtures into public/samples so the playground can fetch them as raw bytes
// (some are Windows-1252 or UTF-16, which is part of what the demo shows).
import { cpSync, mkdirSync, readdirSync } from "node:fs";

const from = "packages/tillread/test/fixtures";
mkdirSync("public/samples", { recursive: true });
for (const f of readdirSync(from)) if (f.endsWith(".csv")) cpSync(`${from}/${f}`, `public/samples/${f}`);
console.log("Copied samples");
