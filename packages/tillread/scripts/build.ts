/**
 * Builds dist/:
 *   index.js   ESM bundle        index.d.ts  (+ one .d.ts per module)
 *   index.cjs  CommonJS bundle   index.d.cts (+ one .d.cts per module)
 * The CommonJS declarations are copies whose imports point at .d.cts files, so TypeScript
 * resolves each format to its own types (checked by `npm run lint:pkg`).
 */
import { execSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const dist = join(root, "dist");
rmSync(dist, { recursive: true, force: true });

const common = { entryPoints: [join(root, "src/index.ts")], bundle: true, platform: "neutral", target: "es2020", logLevel: "warning" } as const;
await build({ ...common, format: "esm", outfile: join(dist, "index.js") });
await build({ ...common, format: "cjs", outfile: join(dist, "index.cjs") });

// The package's own TypeScript if npm nested it, else the workspace one.
const bin = process.platform === "win32" ? "tsc.cmd" : "tsc";
const tsc = [join(root, "node_modules", ".bin", bin), join(root, "..", "..", "node_modules", ".bin", bin)].find(existsSync)!;
execSync(`"${tsc}" -p "${join(root, "tsconfig.build.json")}"`, { stdio: "inherit" });

const IMPORT = /from "(\.\/[\w-]+)\.(?:ts|js)"/g;
for (const f of readdirSync(dist).filter((f) => f.endsWith(".d.ts"))) {
  const text = readFileSync(join(dist, f), "utf8");
  writeFileSync(join(dist, f), text.replace(IMPORT, 'from "$1.js"'));
  writeFileSync(join(dist, f.replace(/\.d\.ts$/, ".d.cts")), text.replace(IMPORT, 'from "$1.cjs"'));
}
console.log("Built", readdirSync(dist).join(", "));
