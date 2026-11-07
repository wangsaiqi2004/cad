/**
 * Generate `llms-full.txt` — the single bundled "system prompt" for AI agents.
 *
 * Where `spec.llm.md` is the tiny learn-the-language page, `llms-full.txt` is the
 * full-context bundle an agent can ingest in one read (per the llmstxt.org
 * convention: `/llms.txt` is the map, `/llms-full.txt` the complete text). It
 * concatenates, from the single sources of truth: the language spec
 * (`spec.llm.md`), the agent workflow skill ({@link SKILL_SOURCE}), a compact CLI reference
 * derived from the capability manifest (`src/manifest.ts`), and the full
 * diagnostic catalog (`src/error-catalog.ts`).
 *
 * Like `scripts/gen-llm-spec.ts`, {@link renderLlmsFull} is pure — every source is
 * passed in — so the drift test (`test/llms-full-drift.test.ts`) can regenerate it
 * in-memory and assert byte-equality. Run `npm run gen:llms` after editing any of
 * the sources; CI asserts no drift.
 */

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { splitContext } from "../src/cli/commands-meta.js";
import type { CatalogEntry } from "../src/error-catalog.js";
import { ERROR_CATALOG, ERROR_CODES } from "../src/error-catalog.js";
import type { Manifest, ManifestCommand, ManifestFlag } from "../src/manifest.js";
import { buildManifest, CLI_NAME } from "../src/manifest.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "..");

/** The umbrella skill, the bundle's agent-workflow section. It sits beside the task skills under `skills/`. */
export const SKILL_SOURCE = "skills/archlang/SKILL.md";

/** Everything {@link renderLlmsFull} needs, passed in so the render stays pure. */
export interface LlmsFullInputs {
  /** The generated `spec.llm.md` content. */
  spec: string;
  /** The {@link SKILL_SOURCE} content (YAML frontmatter is stripped for the bundle). */
  skill: string;
  /** The capability manifest (`buildManifest()`); its `version` is intentionally not emitted. */
  manifest: Manifest;
  /** The full diagnostic catalog, keyed by code. */
  errorCatalog: Readonly<Record<string, CatalogEntry>>;
  /** Catalog codes in canonical order (errors then warnings). */
  errorCodes: readonly string[];
}

const lf = (s: string): string => s.replace(/\r\n/g, "\n");

/** Drop a leading `<!-- … -->` generated banner (spec.llm.md carries its own). */
const stripLeadingComment = (s: string): string => lf(s).replace(/^<!--[\s\S]*?-->\n+/, "");

/** Drop the YAML frontmatter (`--- … ---`) from a Skill markdown file. */
const stripFrontmatter = (s: string): string => lf(s).replace(/^---\n[\s\S]*?\n---\n+/, "");

/** One flag rendered compactly: `--flag|-a <arg>` — description. */
function flagStr(f: ManifestFlag): string {
  const names = f.alias ? `${f.flag}|${f.alias}` : f.flag;
  const arg = f.arg ? ` ${f.arg}` : "";
  return `\`${names}${arg}\` ${f.description}`;
}

/**
 * One command as a compact block: name, summary, input/output, key flags, and ONE
 * worked invocation. Only the first example ships: the bundle is already large
 * (`src/context-size.ts`) and goes into a system prompt, so it buys the "what does a real call look like" signal
 * without paying for the full example set (that lives in `docs/cli-reference.md`).
 */
function commandBlock(c: ManifestCommand): string {
  const aliases = c.aliases?.length ? ` (aliases: ${c.aliases.map((a) => `\`${a}\``).join(", ")})` : "";
  const lines = [
    `**\`${CLI_NAME} ${c.name}\`**${aliases} — ${c.summary}`,
    `  - input: ${c.input} → output: ${c.output}`,
  ];
  if (c.flags.length) lines.push(`  - flags: ${c.flags.map(flagStr).join(" · ")}`);
  const [first] = c.examples;
  if (!first) throw new Error(`command "${c.name}" has no example — every command must carry at least one`);
  lines.push(`  - example: \`${first.cmd}\` — ${first.note}`);
  return lines.join("\n");
}

/** The compact CLI reference, derived entirely from the manifest. */
function cliReference(m: Manifest): string {
  const exit = Object.entries(m.exitCodes)
    .map(([code, desc]) => `\`${code}\` ${desc}`)
    .join(" · ");
  const formats = m.formats.map((f) => `\`${f.id}\`${f.zeroDep ? "" : ` (needs \`${f.optionalDep}\`)`}`).join(" · ");
  return [
    `The \`${CLI_NAME}\` CLI is the agent interface. ${m.description}`,
    "",
    `Without a global install (\`npm i -g @chanmeng666/archlang\`), write \`npx -y @chanmeng666/archlang <cmd>\`.`,
    "The package also installs `arch` as an alias, but on Linux, macOS and Git Bash coreutils owns that",
    "name, so never run a bare `arch`.",
    "",
    "Every command takes `--json` (structured result on stdout, messages on stderr) and reads source",
    "from a file or stdin (`-`). This CLI is the primary agent interface; an optional stdio MCP shim",
    "(`@chanmeng666/archlang-mcp`) wraps the same library functions for MCP-native hosts.",
    "",
    `**Exit codes:** ${exit}`,
    "",
    `**Global flags:** ${m.globalFlags.map(flagStr).join(" · ")}`,
    "",
    `**Output formats (\`-f\`):** ${formats}`,
    "",
    "### Commands",
    "",
    m.commands.map(commandBlock).join("\n\n"),
  ].join("\n");
}

/** The full diagnostic catalog as a compact `code — message Fix: fix` list. */
function diagnosticCatalog(catalog: Readonly<Record<string, CatalogEntry>>, codes: readonly string[]): string {
  const entry = (c: string): string => {
    const e = catalog[c];
    if (!e) throw new Error(`error code "${c}" has no catalog entry`);
    return `- \`${c}\` — ${e.message} **Fix:** ${e.fix}`;
  };
  const errors = codes.filter((c) => catalog[c]?.severity === "error");
  const warnings = codes.filter((c) => catalog[c]?.severity === "warning");
  return [
    `Every diagnostic carries a stable code and a \`fix\`. Look one up with \`${CLI_NAME} explain <CODE>\`.`,
    `**${errors.length} errors** (abort rendering) · **${warnings.length} warnings** (advisory; \`validate --strict\` fails on them too).`,
    "",
    "### Errors",
    "",
    errors.map(entry).join("\n"),
    "",
    "### Warnings",
    "",
    warnings.map(entry).join("\n"),
  ].join("\n");
}

/**
 * Render `llms-full.txt` from the given sources. Pure: no fs, no clock, no
 * randomness, stable ordering (manifest + catalog order as-is) — safe for the
 * drift test.
 */
export function renderLlmsFull(inputs: LlmsFullInputs): string {
  const { spec, skill, manifest, errorCatalog, errorCodes } = inputs;
  const sections = [
    `<!-- GENERATED by scripts/gen-llms-full.ts — do not edit by hand. Run \`npm run gen:llms\`. -->

# ArchLang — full agent context (llms-full.txt)

This is the complete context for driving **ArchLang**, a tiny declarative language that compiles a
\`.arch\` floor-plan source file into a professional drawing (SVG/PNG/PDF/DXF). It follows the
[llms.txt](https://llmstxt.org/) convention: \`llms.txt\` is the concise project map, and this
\`llms-full.txt\` is the whole thing in one document — the language spec, the agent workflow, the CLI
reference, and every diagnostic code — sized to drop into a system prompt.

ArchLang is built for agents: **deterministic** (same source → byte-identical output), **pure** (no
runtime, no IO in the compiler), and **self-correcting** (every error carries a machine code and a
\`fix\`). Author, render, and verify entirely through the \`${CLI_NAME}\` CLI — never hand-render SVG.

Contents:

1. Language spec — the whole language in one page.
2. Agent workflow — the compile → fix → describe → gate loop, and how to repair plan topology.
3. CLI reference — every command, flag, and exit code.
4. Diagnostic catalog — every error and warning, each with a fix.`,
    `## 1. Language spec\n\n${stripLeadingComment(spec)}`,
    `## 2. Agent workflow\n\n${stripFrontmatter(skill)}`,
    `## 3. CLI reference\n\n${cliReference(manifest)}`,
    `## 4. Diagnostic catalog\n\n${diagnosticCatalog(errorCatalog, errorCodes)}`,
  ];
  return `${sections.map((s) => s.replace(/\n+$/, "")).join("\n\n---\n\n")}\n`;
}

/** Read the on-disk sources (CLI/main path only). */
function readInputs(): LlmsFullInputs {
  return {
    spec: readFileSync(resolve(ROOT, "spec.llm.md"), "utf8"),
    skill: readFileSync(resolve(ROOT, SKILL_SOURCE), "utf8"),
    // The version is not emitted into the bundle (kept stable across releases),
    // so any value works; use the shipped package version for consistency.
    manifest: buildManifest(JSON.parse(readFileSync(resolve(ROOT, "package.json"), "utf8")).version ?? "0.0.0"),
    errorCatalog: ERROR_CATALOG,
    errorCodes: ERROR_CODES,
  };
}

/** Kilobytes of 1,000 bytes, rounded: the unit every stated bundle size uses. */
const kb = (text: string): number => Math.round(Buffer.byteLength(text, "utf8") / 1000);

/**
 * Render `src/context-size.ts` — the measured size of a rendered bundle and of each section
 * `archlang context --section` hands back. Pure. The sections come from the CLI's own
 * `splitContext`, so a size can only be stated for a slice the CLI really serves.
 */
export function renderContextSize(bundle: string): string {
  const sections = splitContext(bundle);
  if (sections === null) throw new Error("llms-full.txt does not split into its four sections");
  const sizes = { total: kb(bundle), ...Object.fromEntries(Object.entries(sections).map(([n, s]) => [n, kb(s)])) };
  const literal = Object.entries(sizes)
    .map(([n, v]) => `${n}: ${v}`)
    .join(", ");
  return `// GENERATED by scripts/gen-llms-full.ts — do not edit by hand. Run \`npm run gen:llms\`.

/**
 * The size of \`llms-full.txt\` (what \`archlang context\` prints) and of each \`--section\` of it, in
 * kilobytes of 1,000 bytes, rounded. Measured from the rendered bundle by the generator, so the help
 * never states a size the file does not have; \`check:drift\` and \`test/context-size.test.ts\` fail
 * when it goes stale.
 */
export const CONTEXT_BUNDLE_KB = { ${literal} } as const;
`;
}

/**
 * The bundle states its own size (the `context` command's help is in its CLI reference), and that
 * size is imported from `src/context-size.ts` when this module loads. So a size that moved is
 * written first and the bundle is rendered again by a fresh process that imports it. A rounded
 * size with the same number of digits renders to the same byte length, so the second pass settles.
 */
function main(): void {
  const bundle = renderLlmsFull(readInputs());
  const sizePath = resolve(ROOT, "src/context-size.ts");
  const size = renderContextSize(bundle);
  const current = existsSync(sizePath) ? lf(readFileSync(sizePath, "utf8")) : "";
  if (current !== size) {
    const pass = Number(process.env.ARCHLANG_GEN_LLMS_PASS ?? "1");
    if (pass >= 3) throw new Error("the bundle size did not settle after three passes");
    writeFileSync(sizePath, size);
    process.stdout.write("✓ measured the bundle into src/context-size.ts; rendering again with it\n");
    execFileSync(process.execPath, [...process.execArgv, fileURLToPath(import.meta.url)], {
      stdio: "inherit",
      env: { ...process.env, ARCHLANG_GEN_LLMS_PASS: String(pass + 1) },
    });
    return;
  }
  writeFileSync(resolve(ROOT, "llms-full.txt"), bundle);
  process.stdout.write(`✓ generated llms-full.txt from spec.llm.md + ${SKILL_SOURCE} + manifest + error catalog\n`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) main();
