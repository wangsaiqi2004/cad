/**
 * The law of `src/geometry/min-rect.ts` (plan-soundness PS5.1b): the exact minimum-area
 * enclosing rectangle against a brute-force ROTATION ORACLE that lives here only.
 *
 * The oracle turns the point set through sampled angles (doubles, `Math.cos`/`Math.sin`, test
 * code only) and measures the axis-aligned extent each time. The exact answer must be at or
 * under every sampled rectangle's area, and equal (to float precision) to the rectangle the
 * oracle measures at each hull edge's own angle, the smallest of which is the exact answer
 * itself (a minimum rectangle has a side on a hull edge). A second, quadratic oracle checks
 * every hull edge in BigInt, so the calipers' pointer walk is checked exactly too.
 */

import { describe, expect, it } from "vitest";
import { convexHull, latticeArea2, type LatticePoint, minAreaRect, minRectCost } from "../src/geometry/min-rect.js";

const P = (x: number, y: number): LatticePoint => ({ x: BigInt(x), y: BigInt(y) });

/** Area of the axis-aligned extent of the points turned by `t` radians (the rotation oracle). */
function sampledArea(pts: readonly LatticePoint[], t: number): number {
  const c = Math.cos(t);
  const s = Math.sin(t);
  let x0 = Infinity;
  let x1 = -Infinity;
  let y0 = Infinity;
  let y1 = -Infinity;
  for (const p of pts) {
    const x = Number(p.x) * c - Number(p.y) * s;
    const y = Number(p.x) * s + Number(p.y) * c;
    x0 = Math.min(x0, x);
    x1 = Math.max(x1, x);
    y0 = Math.min(y0, y);
    y1 = Math.max(y1, y);
  }
  return (x1 - x0) * (y1 - y0);
}

/** Every hull edge, measured over every hull point in BigInt: the quadratic oracle. */
function bruteMin(pts: readonly LatticePoint[]): { area: [bigint, bigint]; edges: Array<[bigint, bigint]> } {
  const h = convexHull(pts);
  let best: [bigint, bigint] | null = null;
  const edges: Array<[bigint, bigint]> = [];
  for (let i = 0; i < h.length; i++) {
    const p = h[i]!;
    const q = h[(i + 1) % h.length]!;
    const ex = q.x - p.x;
    const ey = q.y - p.y;
    edges.push([ex, ey]);
    let dmin: bigint | null = null;
    let dmax: bigint | null = null;
    let cmax = 0n;
    for (const t of h) {
      const d = t.x * ex + t.y * ey;
      const c = ex * (t.y - p.y) - ey * (t.x - p.x);
      if (dmin === null || d < dmin) dmin = d;
      if (dmax === null || d > dmax) dmax = d;
      if (c > cmax) cmax = c;
    }
    const num = (dmax! - dmin!) * cmax;
    const den = ex * ex + ey * ey;
    if (best === null || num * best[1] < best[0] * den) best = [num, den];
  }
  return { area: best!, edges };
}

/** A deterministic pseudo-random lattice cloud (an LCG; no Math.random). */
function cloud(seed: number, n: number, span: number): LatticePoint[] {
  let s = seed >>> 0;
  const next = (): number => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
  return Array.from({ length: n }, () => P(Math.round((next() - 0.5) * span), Math.round((next() - 0.5) * span)));
}

const SHAPES: Array<[string, LatticePoint[]]> = [
  ["a 2000 × 5000 rectangle", [P(0, 0), P(2000000, 0), P(2000000, 5000000), P(0, 5000000)]],
  ["a 3000 square turned 45°", [P(0, 2121320), P(2121320, 0), P(4242640, 2121320), P(2121320, 4242640)]],
  ["an L", [P(0, 0), P(4000000, 0), P(4000000, 2000000), P(2000000, 2000000), P(2000000, 4000000), P(0, 4000000)]],
  ["a hexagon", [P(1000, 0), P(3000, 0), P(4000, 1732), P(3000, 3464), P(1000, 3464), P(0, 1732)]],
  ["a thin sliver at 30°", [P(0, 0), P(866025, 500000), P(865025, 501732), P(-1000, 1732)]],
  ...[1, 2, 3, 4, 5, 6, 7, 8].map((k): [string, LatticePoint[]] => [`cloud ${k}`, cloud(k, 5 + 7 * k, 1e7)]),
];

describe("minAreaRect: exact, against the rotation oracle", () => {
  for (const [name, pts] of SHAPES) {
    it(name, () => {
      const r = minAreaRect(pts)!;
      expect(r).not.toBeNull();
      const exact = Number(r.long * r.short) / Number(r.norm2);
      // At or under every sampled rotation's rectangle (720 samples over a quarter turn… and more).
      for (let i = 0; i < 1440; i++) {
        const a = sampledArea(pts, (i * Math.PI) / 1440);
        expect(exact).toBeLessThanOrEqual(a * (1 + 1e-9));
      }
      // Equal to the oracle at the hull-edge angles: the smallest edge-angle rectangle is the answer.
      const { area, edges } = bruteMin(pts);
      expect(r.long * r.short * area[1]).toBe(area[0] * r.norm2);
      const atEdges = edges.map(([ex, ey]) => sampledArea(pts, -Math.atan2(Number(ey), Number(ex))));
      expect(Math.abs(Math.min(...atEdges) - exact)).toBeLessThanOrEqual(exact * 1e-9);
    });
  }

  it("reads the shape, never the bounding box: the turned square is a square", () => {
    const r = minAreaRect(SHAPES[1]![1])!;
    expect(r.long).toBe(r.short);
    // The axis-aligned box of the turned square is twice its area.
    const box = 4242640n * 4242640n;
    expect(r.long * r.short * 2n < box * r.norm2 * 2n).toBe(true);
  });

  it("2000 × 5000 reads aspect 5/2 and rectangularity 1; the L reads 3/4 of its hull rectangle", () => {
    const rect = minAreaRect(SHAPES[0]![1])!;
    expect(rect.long * 2n).toBe(rect.short * 5n);
    const l = SHAPES[2]![1];
    const lr = minAreaRect(l)!;
    // area / rect area = latticeArea2 · norm2 / (2 · long · short)
    expect(latticeArea2(l) * lr.norm2 * 4n).toBe(2n * lr.long * lr.short * 3n);
  });

  it("is the same under the D4 frames and translations (lattice to lattice)", () => {
    for (const [, pts] of SHAPES) {
      const r = minAreaRect(pts)!;
      const frames: Array<(p: LatticePoint) => LatticePoint> = [
        (p) => ({ x: -p.y, y: p.x }),
        (p) => ({ x: -p.x, y: -p.y }),
        (p) => ({ x: p.y, y: -p.x }),
        (p) => ({ x: -p.x, y: p.y }),
        (p) => ({ x: p.y, y: p.x }),
        (p) => ({ x: p.x + 123457n, y: p.y - 99999n }),
      ];
      for (const f of frames) {
        const g = minAreaRect(pts.map(f))!;
        expect(g.long * g.short * r.norm2).toBe(r.long * r.short * g.norm2);
        expect(g.long * r.short).toBe(r.long * g.short);
      }
    }
  });

  it("degenerate sets have no rectangle; the counted work stays under minRectCost", () => {
    expect(minAreaRect([P(0, 0), P(1, 1), P(2, 2)])).toBeNull();
    expect(minAreaRect([P(5, 5), P(5, 5)])).toBeNull();
    for (const [, pts] of SHAPES) {
      const w = { n: 0 };
      minAreaRect(pts, w);
      expect(w.n).toBeLessThanOrEqual(minRectCost(pts.length));
    }
    const big = cloud(99, 5000, 1e9);
    const w = { n: 0 };
    minAreaRect(big, w);
    expect(w.n).toBeLessThanOrEqual(minRectCost(big.length));
  });
});
