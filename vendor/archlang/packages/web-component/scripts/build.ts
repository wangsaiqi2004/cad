/**
 * The three builds of `<arch-plan>`, which differ ONLY in what the element's one
 * `import("@chanmeng666/archlang")` becomes:
 *
 * - `module`     (`dist/arch-plan.js`, the npm default): left bare, so a bundler (or jsDelivr's
 *                `+esm`) resolves the core as the peer dependency it is.
 * - `cdn`        (the file the docs site serves at `/arch-plan.js`): rewritten to the jsDelivr
 *                `+esm` URL of the core at the version in the repo-root `package.json`. One
 *                `<script type="module">` tag, a few KB, and the compiler is fetched on the
 *                first render. `npm run gen:arch-plan` writes it; `check:drift` and
 *                `test/served-file.test.ts` hold the committed copy to this output.
 * - `standalone` (`dist/arch-plan.standalone.js`): the core inlined from the repo's built
 *                `dist/index.js` (`npm run build` at the root first) — no second origin, for a
 *                page that must not load from jsDelivr. The docs build also writes it to
 *                `docs-site/public/arch-plan.standalone.js` (`--standalone-to`, gitignored, built
 *                from the tree being deployed like the gallery SVGs). Never committed.
 *
 * `buildArchPlan()` is pure apart from reading the sources, so the generator, the package
 * build and the drift test all call this one function and cannot disagree.
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { build, type Plugin } from "esbuild";

const PKG = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const ROOT = resolve(PKG, "..", "..");
const ENTRY = join(PKG, "src", "arch-plan.ts");
const CORE = "@chanmeng666/archlang";

export type Variant = "module" | "cdn" | "standalone";

/** The core's version, read from the repo-root `package.json`: never retyped. */
export function coreVersion(): string {
  return JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")).version;
}

/** The pinned jsDelivr ESM URL of the core: the recipe the docs page documents. */
export function cdnUrl(version: string = coreVersion()): string {
  return `https://cdn.jsdelivr.net/npm/${CORE}@${version}/+esm`;
}

/** Optional Node-only backends the core reaches by lazy `import()` and never in a browser. */
const NODE_ONLY = [
  "pdfkit",
  "clipper2-wasm",
  "@resvg/resvg-js",
  "@chanmeng666/archlang-font-cjk",
  "fs",
  "url",
  "node:*",
];

function corePlugin(variant: Variant, version: string): Plugin {
  return {
    name: "archlang-core",
    setup(b) {
      b.onResolve({ filter: /^@chanmeng666\/archlang$/ }, () => {
        if (variant === "module") return { path: CORE, external: true };
        if (variant === "cdn") return { path: cdnUrl(version), external: true };
        return { path: join(ROOT, "dist", "index.js") };
      });
    },
  };
}

function banner(variant: Variant, version: string): string {
  const head = "// <arch-plan>, the ArchLang web component. Built from packages/web-component/src/arch-plan.ts";
  if (variant === "cdn") {
    return (
      `${head} by \`npm run gen:arch-plan\`; do not edit.\n` +
      `// Loads the ArchLang compiler ${version} from ${cdnUrl(version)} on the first render.\n` +
      "// Usage: https://archlang.uk/embed"
    );
  }
  if (variant === "standalone") return `${head}, with @chanmeng666/archlang ${version} inlined.`;
  return `${head}.`;
}

/** The newest modification time under `dir`, in ms. */
function newestMtime(dir: string): number {
  let newest = 0;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    newest = Math.max(newest, entry.isDirectory() ? newestMtime(path) : statSync(path).mtimeMs);
  }
  return newest;
}

/**
 * The standalone build inlines the repo's BUILT core, so a missing or out-of-date `dist/` would
 * ship a stale compiler without a word (nothing else gates that file). Refuse instead: `dist/`
 * must exist and be newer than every file under `src/`.
 */
export function assertFreshCore(): void {
  const entry = join(ROOT, "dist", "index.js");
  const fix = "run `npm run build` at the repo root first";
  if (!existsSync(entry)) throw new Error(`arch-plan standalone build: ${entry} is missing; ${fix}`);
  if (statSync(entry).mtimeMs < newestMtime(join(ROOT, "src"))) {
    throw new Error(
      `arch-plan standalone build: dist/index.js is older than src/ (it would inline a stale core); ${fix}`,
    );
  }
}

/** One build, in memory. */
export async function buildArchPlan(variant: Variant): Promise<string> {
  if (variant === "standalone") assertFreshCore();
  const version = coreVersion();
  const result = await build({
    entryPoints: [ENTRY],
    bundle: true,
    write: false,
    format: "esm",
    platform: "browser",
    target: "es2022",
    charset: "utf8",
    legalComments: "none",
    minify: variant === "standalone",
    external: variant === "standalone" ? NODE_ONLY : [],
    banner: { js: banner(variant, version) },
    plugins: [corePlugin(variant, version)],
    logLevel: "silent",
  });
  const [out] = result.outputFiles;
  if (!out || result.outputFiles.length !== 1) throw new Error("arch-plan build: expected exactly one output file");
  return out.text;
}

async function main(): Promise<void> {
  // `--standalone-to <file>`: the docs build's one output, relative to the caller's directory.
  const at = process.argv.indexOf("--standalone-to");
  if (at >= 0) {
    const target = process.argv[at + 1];
    if (!target) throw new Error("--standalone-to needs a file path");
    const text = await buildArchPlan("standalone");
    mkdirSync(dirname(resolve(target)), { recursive: true });
    writeFileSync(resolve(target), text);
    process.stdout.write(`  standalone → ${target}  (${Buffer.byteLength(text)} bytes)\n`);
    return;
  }
  const dist = join(PKG, "dist");
  mkdirSync(dist, { recursive: true });
  for (const [variant, file] of [
    ["module", "arch-plan.js"],
    ["standalone", "arch-plan.standalone.js"],
  ] as const) {
    const text = await buildArchPlan(variant);
    writeFileSync(join(dist, file), text);
    process.stdout.write(`  ${variant.padEnd(10)} → dist/${file}  (${Buffer.byteLength(text)} bytes)\n`);
  }
}

// Run only when invoked directly (not when imported by the generator or the drift test).
if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) await main();
