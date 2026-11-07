/**
 * The element's peer range on the core must admit the core this repo builds. It is a caret
 * range, deliberately looser than the MCP shim's exact-version lockstep: the element uses three
 * stable exports (`compile`, `diagnosticToJson`, `THEMES`), so any 1.x at or above the floor
 * works. A core MAJOR bump fails this test on purpose: re-check those exports, then move the
 * range (`/release-check` says so).
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (rel: string) => JSON.parse(readFileSync(new URL(rel, import.meta.url), "utf8"));
const core = read("../../../package.json").version as string;
const range = read("../package.json").peerDependencies["@chanmeng666/archlang"] as string;

const parts = (v: string): number[] => v.split(".").map(Number);

describe("peerDependencies['@chanmeng666/archlang']", () => {
  it("is a caret range on a full x.y.z version", () => {
    expect(range).toMatch(/^\^\d+\.\d+\.\d+$/);
  });

  it(`admits the root core version`, () => {
    const floor = parts(range.slice(1));
    const v = parts(core);
    expect(v[0], `core ${core} is outside ${range}: a new major — re-check the exports, then move the range`).toBe(
      floor[0],
    );
    const atLeast = v[1]! > floor[1]! || (v[1] === floor[1] && v[2]! >= floor[2]!);
    expect(atLeast, `core ${core} is below the range's floor ${range}`).toBe(true);
  });
});
