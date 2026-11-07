/**
 * The taste layer's exact arithmetic (ADR 0032; design §2.3). Every value that reaches a pinned
 * byte is decided in integers: counts are plain integers, lengths are lattice integers (the
 * 0.001 mm lattice, below 2³⁶ within `MODEL_RANGE_MM`), and every product, ramp and mean is a
 * `BigInt` rational rounded half up in integers to a PERMYRIAD (a score in [0, 1] times 10,000).
 * No transcendental call, no float division upstream of a score.
 */

/** The largest permyriad: a score of 1. */
export const ONE = 10000;

/** A non-negative rational `num/den` (`den > 0`). */
export interface Ratio {
  num: bigint;
  den: bigint;
}

/** A length in mm on the 0.001 mm lattice, as an exact integer (ADR 0022). */
export function lattice(mm: number): bigint {
  return BigInt(Math.round(mm * 1000));
}

/** `floor(n / d)` for `d > 0` (BigInt `/` truncates toward zero). */
function floorDiv(n: bigint, d: bigint): bigint {
  const q = n / d;
  return n % d !== 0n && n < 0n ? q - 1n : q;
}

/** `n / d` rounded half up (toward +∞ on a tie), `d > 0`, decided in integers. */
export function roundHalfUp(n: bigint, d: bigint): bigint {
  return floorDiv(2n * n + d, 2n * d);
}

const clampP = (p: bigint): number => Number(p < 0n ? 0n : p > BigInt(ONE) ? BigInt(ONE) : p);

/**
 * The ramp of a criterion (design §2.3): `v` mapped piecewise linearly from `zero` (score 0) to
 * `one` (score 1) and clamped; `zero > one` for a lower-is-better value. Returns the permyriad
 * `clamp(roundHalfUp(10000·(v − zero)/(one − zero)))`, with the sign of `one − zero` normalised
 * first and the division done on cross-multiplied `BigInt` numerators and denominators.
 */
export function ramp(v: Ratio, zero: Ratio, one: Ratio): number {
  // (v − zero) = (v.num·zero.den − zero.num·v.den) / (v.den·zero.den)
  // (one − zero) = (one.num·zero.den − zero.num·one.den) / (one.den·zero.den)
  let n = (v.num * zero.den - zero.num * v.den) * one.den;
  let d = (one.num * zero.den - zero.num * one.den) * v.den;
  if (d === 0n) throw new RangeError("ramp: zero and one coincide");
  if (d < 0n) {
    n = -n;
    d = -d;
  }
  return clampP(roundHalfUp(10000n * n, d));
}

/** A weighted mean of permyriads with integer weights, rounded half up; `null` when empty. */
export function meanPermyriad(items: ReadonlyArray<{ p: number; w: number }>): number | null {
  let s = 0n;
  let w = 0n;
  for (const it of items) {
    s += BigInt(it.p) * BigInt(it.w);
    w += BigInt(it.w);
  }
  return w === 0n ? null : clampP(roundHalfUp(s, w));
}

/** `n / d` (`d > 0`) as a decimal with at most `places` digits after the point, rounded half up
 *  in integers and built from the digits (trailing zeros dropped). */
export function fmtRatio(n: bigint, d: bigint, places: number): string {
  const scale = 10n ** BigInt(places);
  const q = roundHalfUp(n * scale, d);
  const neg = q < 0n;
  const a = neg ? -q : q;
  const int = a / scale;
  const frac = (a % scale).toString().padStart(places, "0").replace(/0+$/, "");
  return `${neg ? "-" : ""}${int}${frac ? `.${frac}` : ""}`;
}
