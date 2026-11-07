/**
 * B6 — the Markdown-preview plugin (`src/markdown.ts`).
 *
 * Drives the REAL core (vitest aliases `@chanmeng666/archlang` to `src/index.ts`).
 * Most cases use a stub shaped like markdown-it's fence rule; the last block uses a
 * real markdown-it instance through `createExtendMarkdownIt`, the exact function
 * `activate()` hands to VS Code. (`extension.ts` itself imports `vscode`, which does
 * not exist under vitest, so the wiring it adds is only `import()` of the core.)
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import MarkdownIt from "markdown-it";
import { describe, expect, it } from "vitest";
import * as archlang from "@chanmeng666/archlang";
import { createExtendMarkdownIt, installArchFence, type CoreCompile, type MarkdownItLike } from "../src/markdown.js";

const compile = archlang.compile as unknown as CoreCompile;
const DEFAULT_FENCE = "<pre><code>DEFAULT</code></pre>\n";

function render(info: string, content: string): string {
  const md: MarkdownItLike = { renderer: { rules: { fence: () => DEFAULT_FENCE } } };
  installArchFence(md, compile);
  const tokens = [{ info, content }];
  return (md.renderer.rules.fence as (...a: unknown[]) => string)(tokens, 0, {}, {}, {});
}

const example = (name: string): string =>
  readFileSync(fileURLToPath(new URL(`../../../examples/${name}`, import.meta.url)), "utf8");
const studio = example("studio.arch");

describe("markdown preview plugin", () => {
  it("renders an arch fence of examples/studio.arch as an inline <svg>", () => {
    const html = render("arch", studio);
    expect(html).toContain('class="archlang-preview code-line"');
    expect(html).toContain("<svg");
    expect(html).not.toContain("<script");
  });

  it("tolerates archlang as an alias", () => {
    expect(render("archlang", studio)).toContain("<svg");
  });

  it("renders a broken fence as its diagnostic code, message and source, without an <svg", () => {
    const html = render("arch", 'plan "x" { <bogus> }');
    expect(html).not.toContain("<svg");
    expect(html).toContain("E_PARSE");
    expect(html).toContain("&lt;bogus&gt;");
    expect(html).not.toContain("<bogus>");
  });

  it("leaves a non-arch fence to the default renderer", () => {
    expect(render("js", "let x = 1")).toBe(DEFAULT_FENCE);
    expect(render("", "plain")).toBe(DEFAULT_FENCE);
  });

  it("never throws, even when compile does", () => {
    const md: MarkdownItLike = { renderer: { rules: {} } };
    installArchFence(md, () => {
      throw new Error("boom");
    });
    const html = (md.renderer.rules.fence as (...a: unknown[]) => string)(
      [{ info: "arch", content: "x" }],
      0,
      {},
      {},
      {},
    );
    expect(html).toContain("boom");
    expect(html).not.toContain("<svg");
  });

  it("shows no diagnostics block for a clean plan", () => {
    expect(render("arch", studio)).not.toContain("archlang-diagnostics");
  });
});

describe("markdown preview plugin on a real markdown-it", () => {
  const doc = [
    "# Plans",
    "",
    "```arch",
    studio,
    "```",
    "",
    "```arch",
    'plan "x" { <bogus> }',
    "```",
    "",
    "```js",
    "let x = 1;",
    "```",
    "",
    "```arch",
    example("terrace-row.arch"),
    "```",
    "",
  ].join("\n");
  const html = createExtendMarkdownIt(compile)(new MarkdownIt()).render(doc);

  it("renders the plan, the diagnostic and the untouched js fence", () => {
    expect(html.match(/<svg/g)?.length).toBe(2);
    expect(html).toContain("E_PARSE");
    expect(html).toContain('<pre><code class="language-js">let x = 1;');
  });

  it("carries data-line and code-line on the wrapper, for scroll sync", () => {
    expect(html).toMatch(/<div class="archlang-preview code-line" data-line="2">/);
  });

  it("gives two plans in one document disjoint ids, and every reference resolves in its own svg", () => {
    const svgs = html.match(/<svg[\s\S]*?<\/svg>/g)!;
    expect(svgs).toHaveLength(2);
    const ids = svgs.map((s) => [...s.matchAll(/\sid="([^"]*)"/g)].map((m) => m[1]!));
    expect(ids[0]!.length).toBeGreaterThan(0);
    for (const id of ids[0]!) expect(ids[1]).not.toContain(id);
    svgs.forEach((s, i) => {
      const refs = [...s.matchAll(/url\(#([^)]+)\)/g)].map((m) => m[1]!);
      expect(refs.length).toBeGreaterThan(0);
      for (const r of refs) expect(ids[i]).toContain(r);
    });
  });
});

describe("namespacing touches attributes only", () => {
  it("leaves a label reading url(#poche) untouched while the references are prefixed", () => {
    const src = studio.replace(/label "[^"]*"/, 'label "see url(#poche)"');
    expect(src).not.toBe(studio);
    const html = render("arch", src);
    expect(html).toContain("see url(#poche)");
    expect(html).not.toContain("see url(#arch");
    expect(html).toMatch(/url\(#arch\w*-poche\)/);
    expect(html).toMatch(/\sid="arch\w*-poche"/);
  });
});
