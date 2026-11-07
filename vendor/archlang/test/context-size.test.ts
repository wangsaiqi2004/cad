/**
 * Every stated size of the agent bundle (`llms-full.txt`, what `archlang context` prints) is true.
 *
 * The CLI help, `docs/cli-reference.md` and the bundle's own CLI section once called it "~50KB"
 * while the file was 107 KB, and the docs said the catalog alone was "13 KB" while it was 32 KB:
 * a typed number that nothing measured. Now the generator measures the rendered bundle into
 * `src/context-size.ts`, the manifest interpolates that, and this file checks two things:
 *
 * 1. `src/context-size.ts` states the sizes of the committed `llms-full.txt` exactly (the drift
 *    gate also catches it, but this names the cause).
 * 2. A hand-written page that quotes a size uses one of two phrasings, "about N KB in all" for the
 *    whole bundle and "the catalog alone is about N KB" for the `errors` section, and N is within
 *    10% of the measured size. Any other `N KB` on those pages fails, so an old figure cannot hide.
 */

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { renderContextSize } from "../scripts/gen-llms-full.js";
import { splitContext } from "../src/cli/commands-meta.js";
import { CONTEXT_BUNDLE_KB } from "../src/context-size.js";

const bundle = readFileSync("llms-full.txt", "utf8").replace(/\r\n/g, "\n");
const bytes = (s: string): number => Buffer.byteLength(s, "utf8");

describe("src/context-size.ts", () => {
  it("is what the generator measures from the committed llms-full.txt", () => {
    const committed = readFileSync("src/context-size.ts", "utf8").replace(/\r\n/g, "\n");
    expect(committed).toBe(renderContextSize(bundle));
  });

  it("states each size within half a kilobyte of the file", () => {
    const sections = splitContext(bundle);
    expect(sections).not.toBeNull();
    expect(Math.abs(CONTEXT_BUNDLE_KB.total * 1000 - bytes(bundle))).toBeLessThanOrEqual(500);
    for (const [name, text] of Object.entries(sections!)) {
      const stated = CONTEXT_BUNDLE_KB[name as keyof typeof CONTEXT_BUNDLE_KB];
      expect(Math.abs(stated * 1000 - bytes(text)), name).toBeLessThanOrEqual(500);
    }
  });
});

/** Hand-written pages that quote the bundle's size. */
const PAGES = ["skills/archlang/SKILL.md", "llms.txt", "docs-site/agents.md", "docs/overview.md"];

/** Every `N KB` on a page, each judged against the size its phrasing names. */
function claims(text: string): { said: string; kb: number; actual: number | null }[] {
  const flat = text.replace(/\s+/g, " ");
  const errors = bytes(splitContext(bundle)!.errors!) / 1000;
  const total = bytes(bundle) / 1000;
  return [...flat.matchAll(/(\S+ \S+ \S+ \S+ )?(\d+(?:\.\d+)?) ?KB\b(?=(.{0,7}))/g)].map((m) => {
    const before = m[1] ?? "";
    const after = m[3] ?? "";
    const actual = after.startsWith(" in all") ? total : /catalog alone is about $/.test(before) ? errors : null;
    return { said: m[0], kb: Number(m[2]), actual };
  });
}

describe("hand-written pages state the bundle size truly", () => {
  it("judges a phrasing by the size it names (the canaries)", () => {
    const [whole, catalog, stale] = claims(
      "the bundle is about 107 KB in all; the catalog alone is about 32 KB, not 60 KB",
    );
    expect(whole!.actual).toBeCloseTo(bytes(bundle) / 1000, 3);
    expect(catalog!.actual).toBeGreaterThan(0);
    expect(stale!.actual).toBeNull();
  });

  it.each(PAGES)("%s", (page) => {
    const found = claims(readFileSync(page, "utf8"));
    expect(found.length, `${page} quotes no bundle size; drop it from PAGES if that is deliberate`).toBeGreaterThan(0);
    for (const c of found) {
      expect(c.actual, `${page}: "${c.said}" is not a recognised size claim`).not.toBeNull();
      expect(Math.abs(c.kb - c.actual!) / c.actual!, `${page}: "${c.said}" vs ${c.actual} KB`).toBeLessThanOrEqual(0.1);
    }
  });
});
