/**
 * The Web-standard decoder of the playground's `#z=` share payload, beside the Node one in
 * `share-codec.mjs`: `#z=<base64url(deflate-raw(utf8))>`, read with `DecompressionStream` and
 * `atob` instead of `zlib` and `Buffer`, so a runtime with no Node built-ins (the hosted MCP
 * Worker's `GET /svg/<payload>`) reads exactly what `archlang link` mints.
 * `test/share-codec-web.test.ts` holds the two decoders to the same source on every example.
 *
 * Bounded: `maxBytes` caps the INFLATED size and stops reading the moment it is passed, so a
 * small payload that inflates enormously costs at most `maxBytes` of work, never the whole bomb.
 * Types: `share-codec.web.d.mts`.
 */

/** Thrown by {@link decodePlanHashWeb} when the inflated source would exceed `maxBytes`. */
export class PlanHashTooLarge extends RangeError {
  /** @param {number} maxBytes */
  constructor(maxBytes) {
    super(`the decoded plan is larger than ${maxBytes} bytes`);
    this.name = "PlanHashTooLarge";
    this.maxBytes = maxBytes;
  }
}

/** base64url (no padding) → bytes. Throws on a character outside the alphabet. */
function fromBase64Url(hash) {
  const bin = atob(hash.replace(/-/g, "+").replace(/_/g, "/"));
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

/**
 * Decode a `#z=` payload back to plan source. The inverse of `encodePlanHash` in
 * `share-codec.mjs`, and of the playground's browser encoder.
 *
 * @param {string} hash the payload after `#z=`
 * @param {{ maxBytes?: number }} [opts] refuse (with {@link PlanHashTooLarge}) past this many inflated bytes
 * @returns {Promise<string>}
 */
export async function decodePlanHashWeb(hash, opts = {}) {
  const max = opts.maxBytes ?? Number.POSITIVE_INFINITY;
  const input = fromBase64Url(hash);
  const stream = new Blob([input]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
  const reader = stream.getReader();
  const chunks = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > max) {
      await reader.cancel().catch(() => {});
      throw new PlanHashTooLarge(max);
    }
    chunks.push(value);
  }
  const out = new Uint8Array(total);
  let at = 0;
  for (const c of chunks) {
    out.set(c, at);
    at += c.byteLength;
  }
  return new TextDecoder("utf-8").decode(out);
}
