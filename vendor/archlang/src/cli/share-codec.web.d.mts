/** Types for `share-codec.web.mjs`, the Web-standard decoder of the `#z=` share payload. */

/** Thrown by {@link decodePlanHashWeb} when the inflated source would exceed `maxBytes`. */
export declare class PlanHashTooLarge extends RangeError {
  constructor(maxBytes: number);
  readonly maxBytes: number;
}

/** Decode a `#z=` payload back to plan source with `DecompressionStream` (no Node built-ins). */
export declare function decodePlanHashWeb(hash: string, opts?: { maxBytes?: number }): Promise<string>;
