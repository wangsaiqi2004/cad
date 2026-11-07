// The resource set the Worker bundles, DERIVED from the stdio server rather than retyped:
// `name: readResource("<flat>", "<repo path>")` in packages/mcp/src/server.ts → { name: repo path }.
// Those calls are what test/lockstep.test.ts already pins against copy-resources.mjs, so the stdio
// package, its dist/ copy and the Worker serve one list.

/** @param {string} serverSrc @returns {Record<string, string>} */
export function resourcePaths(serverSrc) {
  /** @type {Record<string, string>} */
  const out = {};
  for (const m of serverSrc.matchAll(/^\s*"?([\w-]+)"?:\s*readResource\(\s*"([^"]+)"\s*,\s*"([^"]+)"\s*\)/gm)) {
    out[m[1]] = m[3];
  }
  return out;
}
