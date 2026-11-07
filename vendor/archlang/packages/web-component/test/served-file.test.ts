/**
 * The docs site serves `<arch-plan>` at `/arch-plan.js` from the committed
 * `docs-site/public/arch-plan.js`. That file is GENERATED (`npm run gen:arch-plan`, gated by
 * `check:drift`); this rebuilds it in memory with the package's own build function and fails on
 * any difference, so a hand edit or an element change without a regeneration cannot ship.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { buildArchPlan, cdnUrl, coreVersion } from "../scripts/build.js";

const SERVED = new URL("../../../docs-site/public/arch-plan.js", import.meta.url);
const ROOT_PKG = new URL("../../../package.json", import.meta.url);

describe("docs-site/public/arch-plan.js", () => {
  it("equals the package's `cdn` build output (run `npm run gen:arch-plan`)", async () => {
    const served = readFileSync(SERVED, "utf8").replace(/\r\n/g, "\n");
    expect(served).toBe(await buildArchPlan("cdn"));
  });

  it("imports the core from jsDelivr at the version in the root package.json, and nothing else", () => {
    const version = JSON.parse(readFileSync(ROOT_PKG, "utf8")).version as string;
    expect(coreVersion()).toBe(version);
    expect(cdnUrl()).toBe(`https://cdn.jsdelivr.net/npm/@chanmeng666/archlang@${version}/+esm`);
    const served = readFileSync(SERVED, "utf8");
    const imports = [...served.matchAll(/\bimport\s*\(\s*"([^"]+)"\s*\)|\bfrom\s*"([^"]+)"/g)].map((m) => m[1] ?? m[2]);
    expect(imports).toEqual([cdnUrl()]);
  });

  it("is the element alone, not the inlined compiler", () => {
    expect(Buffer.byteLength(readFileSync(SERVED))).toBeLessThan(16 * 1024);
  });
});
