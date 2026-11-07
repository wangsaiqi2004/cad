import { describe, expect, it } from "vitest";
import { embedSnippets, exampleImageUrl } from "../src/embed-snippets.js";
import { exampleNameFor } from "../src/examples.js";
import studioSource from "../../examples/studio.arch?raw";

const BASE = "https://playground.archlang.uk/";
const HASH = "#z=q1YqLUktUrJSUFJSSs7PS8nMS1eyUjA0MjE1MDA0MDE2MDAwsLIyNjA0MDAwtbRUKkpVslJQUlICAA";

describe("embedSnippets", () => {
  it("links the Markdown snippet to the share URL, never as an image of embed.html", () => {
    const { markdown, shareUrl } = embedSnippets(BASE, HASH);
    expect(shareUrl).toBe(`${BASE}${HASH}`);
    expect(markdown).toBe(`[ArchLang floor plan — open it in the playground](${shareUrl})`);
    expect(markdown).not.toContain("![");
    expect(markdown).not.toContain("embed.html");
  });

  it("shows a bundled example's hosted drawing as an image linking to the share URL", () => {
    const imageUrl = exampleImageUrl("studio", null);
    const { markdown, shareUrl } = embedSnippets(BASE, HASH, imageUrl);
    expect(markdown).toBe(`[![ArchLang floor plan](https://archlang.uk/examples/studio.svg)](${shareUrl})`);
    expect(markdown).not.toContain("embed.html");
  });

  it("names a storey's drawing the way the docs gallery writes it", () => {
    expect(exampleImageUrl("studio", null)).toBe("https://archlang.uk/examples/studio.svg");
    expect(exampleImageUrl("townhouse", 1)).toBe("https://archlang.uk/examples/townhouse.L1.svg");
    expect(exampleImageUrl("townhouse", 3)).toBe("https://archlang.uk/examples/townhouse.L3.svg");
  });

  it("recognises only an unedited bundled example", () => {
    const studio = studioSource;
    expect(exampleNameFor(studio)).toBe("studio");
    // Either line-end convention: the editor holds LF, a Windows checkout may hold CRLF.
    expect(exampleNameFor(studio.replace(/\r?\n/g, "\n"))).toBe("studio");
    expect(exampleNameFor(studio.replace(/\r?\n/g, "\r\n"))).toBe("studio");
    expect(exampleNameFor(`${studio}\n# edited`)).toBeUndefined();
    expect(exampleNameFor("")).toBeUndefined();
  });

  it("frames the embed page in the iframe snippet", () => {
    const { iframe, embedUrl } = embedSnippets(BASE, HASH);
    expect(embedUrl).toBe(`${BASE}embed.html${HASH}`);
    expect(iframe).toContain(`<iframe src="${embedUrl}"`);
    expect(iframe).toContain('title="ArchLang floor plan"');
  });

  it("keeps the plan in the fragment, so no snippet sends it to the server", () => {
    const { shareUrl, embedUrl } = embedSnippets(BASE, HASH);
    for (const url of [shareUrl, embedUrl]) {
      const u = new URL(url);
      expect(u.search).toBe("");
      expect(u.hash).toBe(HASH);
    }
  });
});
