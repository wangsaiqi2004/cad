/**
 * Release gate: refuse to publish the shim when the oldest core its dependency range admits does
 * not export every core subpath the server loads.
 *
 *   npx tsx packages/mcp/scripts/check-core-exports.ts
 *
 * The server loads subpaths such as `@chanmeng666/archlang/link` lazily, so a shim pinned to a
 * core without them publishes cleanly and only fails at the first call. `release.yml` skips a core
 * version npm already has, so a `workflow_dispatch` run can publish a new shim against an old core;
 * this asks npm what that core actually exports. It runs after the core publish step, so a core
 * published in the same run is the one asked about (with retries while the registry catches up).
 */

import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export const CORE = "@chanmeng666/archlang";

/**
 * npm answers "Your package is being processed and may take a few minutes to become available"
 * after a publish; a version has been seen to appear 3m09s later. 32 x 15 s = 8 min of waiting.
 */
export const VIEW_ATTEMPTS = 32;
export const VIEW_INTERVAL_MS = 15_000;

/**
 * Every `./<sub>` of the core the server loads at RUNTIME: a static `import … from` (not
 * `import type`) or an `import("…")` call. A type-only `typeof import("…")` loads nothing.
 */
export function coreSubpaths(serverSource: string): string[] {
  const out = new Set<string>();
  const sub = String.raw`@chanmeng666\/archlang\/([\w./-]+)`;
  for (const m of serverSource.matchAll(new RegExp(String.raw`(?<!typeof\s*)\bimport\(\s*["']${sub}["']\s*\)`, "g")))
    out.add(`./${m[1]}`);
  for (const m of serverSource.matchAll(new RegExp(String.raw`^import(?!\s+type\b)[^;]*?["']${sub}["']`, "gm")))
    out.add(`./${m[1]}`);
  return [...out].sort();
}

/** The lowest version a `^x.y.z` / `~x.y.z` / `x.y.z` range admits. Anything else is refused. */
export function rangeMinimum(range: string): string {
  const v = range.trim().replace(/^[\^~]/, "");
  if (!/^\d+\.\d+\.\d+$/.test(v)) throw new Error(`cannot take the minimum of the core range "${range}"`);
  return v;
}

/** The subpaths a core's `exports` field (as `npm view … exports --json` prints it) lacks. */
export function missingExports(subpaths: readonly string[], exportsField: unknown): string[] {
  const keys =
    exportsField !== null && typeof exportsField === "object" && !Array.isArray(exportsField)
      ? Object.keys(exportsField)
      : [];
  return subpaths.filter((s) => !keys.includes(s));
}

/** `npm view <core>@<version> exports --json`, or `undefined` while npm does not have that version. */
function viewExports(version: string): unknown {
  const r = spawnSync("npm", ["view", `${CORE}@${version}`, "exports", "--json"], {
    encoding: "utf8",
    shell: process.platform === "win32",
  });
  const text = (r.stdout ?? "").trim();
  if (r.status !== 0 || text === "") return undefined;
  return JSON.parse(text);
}

async function main(): Promise<void> {
  const mcp = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  const server = readFileSync(resolve(mcp, "src", "server.ts"), "utf8");
  const pkg = JSON.parse(readFileSync(resolve(mcp, "package.json"), "utf8"));
  const subpaths = coreSubpaths(server);
  if (subpaths.length === 0) {
    console.log("check-core-exports: the server loads no core subpath; nothing to check");
    return;
  }
  const min = rangeMinimum(String(pkg.dependencies?.[CORE] ?? ""));
  let exportsField: unknown;
  for (let attempt = 1; attempt <= VIEW_ATTEMPTS; attempt++) {
    exportsField = viewExports(min);
    if (exportsField !== undefined) break;
    console.log(`check-core-exports: ${CORE}@${min} not on npm yet (attempt ${attempt}/${VIEW_ATTEMPTS})`);
    await new Promise((r) => setTimeout(r, VIEW_INTERVAL_MS));
  }
  if (exportsField === undefined) {
    console.error(`::error::${CORE}@${min} (the minimum of the shim's core range) is not on npm.`);
    process.exit(1);
  }
  const missing = missingExports(subpaths, exportsField);
  if (missing.length > 0) {
    console.error(
      `::error::${CORE}@${min} does not export ${missing.join(", ")}, which the shim loads. ` +
        "Publish a core that exports it and pin the shim's range to it before publishing the shim.",
    );
    process.exit(1);
  }
  console.log(`check-core-exports: ${CORE}@${min} exports ${subpaths.join(", ")}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
