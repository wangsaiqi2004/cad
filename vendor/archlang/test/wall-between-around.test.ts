/**
 * The pairwise wall forms (ADR 0028 §4; card PS3.3):
 *
 *     wall id=p partition thickness 100 between <A> and <B>
 *     wall id=e exterior thickness 200 around [<A> <B> <C>]
 *
 *  - the swap-back law: a pairwise wall draws and lints byte for byte as the same wall typed
 *    with its points, and describes the same but for its `derived_walls[]` row and the
 *    `freedom.walls` family (`relational`); in a `walls from rooms` group it takes over the
 *    derived run exactly as the typed wall does; a `door between` hosts on it; inside a
 *    placed component it follows every frame as the typed wall does;
 *  - the §3 direction rule (a run from its smaller-y-then-x end; a ring clockwise from its
 *    smallest-y-then-x vertex);
 *  - every refusal on its clause (or on the room name), each catalogued;
 *  - the widening drill, the bounds, Plan JSON.
 */

import { describe as suite, expect, it } from "vitest";
import { compile, describe, lint, planFromJson, planToJson, type PlanJson } from "../src/index.js";
import { resolvePlan } from "../src/analyze.js";
import type { RDoor, ResolvedPlan, RWall, RWindow } from "../src/ir.js";
import { withStepMeter } from "../src/expr.js";
import { deriveAround, sortSteps } from "../src/room-tiling.js";

const plan = (body: string, grid = 50) => `plan "p" {\n  units mm\n  grid ${grid}\n${body}\n}\n`;
/** a | b on top, c below both: an exterior outline of four corners. */
const ROOMS =
  '  room id=a at (0,0) size 4000x3000 label "A" uses living\n  room id=b at (4000,0) size 3000x3000 label "B" uses bedroom\n  room id=c at (0,3000) size 7000x2000 label "C" uses kitchen\n';

const irOf = (src: string): ResolvedPlan => {
  const r = resolvePlan(src);
  if (!r.ir) throw new Error(r.diagnostics.map((d) => `${d.code}: ${d.message}`).join("\n"));
  return r.ir;
};
const errors = (src: string) => compile(src).diagnostics.filter((d) => d.severity === "error");
const strip = (src: string) => lint(src).map(({ span: _s, fixes: _f, ...d }) => d);
const wallOf = (src: string, id: string): RWall => irOf(src).walls.find((w) => w.id === id)!;
/** describe() less the pairwise facts: what must equal the typed twin. */
const plain = (src: string): unknown => {
  const d = JSON.parse(JSON.stringify(describe(src))) as Record<string, unknown> & {
    derived_walls?: Array<{ from: string }>;
    freedom: { walls?: Record<string, number> };
  };
  if (d.derived_walls) {
    d.derived_walls = d.derived_walls.filter((r) => r.from === "rooms");
    if (d.derived_walls.length === 0) delete d.derived_walls;
  }
  const w = d.freedom.walls;
  if (w) {
    if (w.relational !== undefined) {
      w.absolute! += w.relational;
      delete w.relational;
    }
    if (!d.derived_walls) delete d.freedom.walls;
  }
  return d;
};
/** The three surfaces of the swap-back law. */
const twins = (rel: string, typed: string): void => {
  expect(errors(rel)).toEqual([]);
  expect(compile(rel).svg).toBe(compile(typed).svg);
  expect(strip(rel)).toEqual(strip(typed));
  expect(plain(rel)).toEqual(plain(typed));
};
/** The one diagnostic of `code`, asserting the source text its span covers. */
const one = (src: string, code: string, spanText: string) => {
  const ds = compile(src).diagnostics.filter((d) => d.code === code);
  expect(ds, `${code} in ${JSON.stringify(compile(src).diagnostics.map((d) => d.code))}`).toHaveLength(1);
  const d = ds[0]!;
  expect(src.slice(d.span!.start, d.span!.end)).toBe(spanText);
  return d;
};

// ------------------------------------------------------------------------------------------

suite("parse and print", () => {
  it("round-trips both forms (with material and height) through `arch fmt`'s printer", async () => {
    const { format: formatSource } = await import("../src/format.js");
    for (const f of [
      "wall id=p partition thickness 100 between a and b",
      "wall partition thickness 100 material brick scale 2 height 2400 between c and a",
      "wall id=e exterior thickness 200 around [a b c]",
      "wall id=e exterior thickness 200 material concrete around [c]",
    ]) {
      const src = plan(`${ROOMS}  ${f}\n`);
      const once = formatSource(src);
      expect(once).toContain(f);
      expect(formatSource(once)).toBe(once);
    }
  });

  it("refuses an empty `around` list at parse", () => {
    expect(compile(plan(`${ROOMS}  wall exterior thickness 200 around []\n`)).diagnostics[0]!.message).toMatch(
      /at least one room/,
    );
  });
});

// ------------------------------------------------------------------------------------------

suite("the swap-back law", () => {
  const REL =
    "  wall id=e exterior thickness 200 around [a b c]\n  wall id=p partition thickness 100 between a and b\n  wall id=q partition thickness 100 between c and a\n  wall id=r partition thickness 100 between b and c\n";
  const TYPED =
    "  wall id=e exterior thickness 200 { (0,0) (7000,0) (7000,5000) (0,5000) close }\n  wall id=p partition thickness 100 { (4000,0) (4000,3000) }\n  wall id=q partition thickness 100 { (0,3000) (4000,3000) }\n  wall id=r partition thickness 100 { (4000,3000) (7000,3000) }\n";
  const DOORS =
    "  door id=front at (1000,5000) width 900 wall exterior hinge left swing in\n  door id=d hinged between a and b at 800 from end width 800 hinge left swing into b\n  door id=k on q at 50% width 800\n";

  it("between and around, with a door between and a door on the wall, equal the typed walls", () => {
    twins(plan(`${ROOMS}${REL}${DOORS}`), plan(`${ROOMS}${TYPED}${DOORS}`));
  });

  it("describe() reports the relation as written and counts the walls relational", () => {
    const d = describe(plan(`${ROOMS}${REL}`));
    expect(d.derived_walls).toEqual([
      { from: "around", name: "e", around: ["a", "b", "c"] },
      { from: "between", name: "p", between: ["a", "b"] },
      { from: "between", name: "q", between: ["c", "a"] },
      { from: "between", name: "r", between: ["b", "c"] },
    ]);
    expect(d.freedom.walls).toEqual({ total: 4, derived: 0, absolute: 0, relational: 4 });
    // a plan with no pairwise wall carries neither key
    const typed = describe(plan(`${ROOMS}${TYPED}`));
    expect(typed.derived_walls).toBeUndefined();
    expect(typed.freedom.walls).toBeUndefined();
  });

  it("an L-shaped union: the ring is the outline, clockwise from its smallest-y-then-x vertex", () => {
    const L = '  room id=a at (0,0) size 4000x3000 label "A"\n  room id=c at (0,3000) size 7000x2000 label "C"\n';
    const src = plan(`${L}  wall id=e exterior thickness 200 around [c a]\n`);
    const w = wallOf(src, "e");
    expect(w.closed).toBe(true);
    expect(w.points).toEqual([
      { x: 0, y: 0 },
      { x: 4000, y: 0 },
      { x: 4000, y: 3000 },
      { x: 7000, y: 3000 },
      { x: 7000, y: 5000 },
      { x: 0, y: 5000 },
    ]);
    twins(
      src,
      plan(
        `${L}  wall id=e exterior thickness 200 { (0,0) (4000,0) (4000,3000) (7000,3000) (7000,5000) (0,5000) close }\n`,
      ),
    );
  });

  it("a run starts at its smaller-y end (vertical) or smaller-x end (horizontal), whatever the rooms' order", () => {
    const src = plan(
      `${ROOMS}  wall id=p partition thickness 100 between b and a\n  wall id=q partition thickness 100 between c and b\n`,
    );
    expect(wallOf(src, "p").points).toEqual([
      { x: 4000, y: 0 },
      { x: 4000, y: 3000 },
    ]);
    expect(wallOf(src, "q").points).toEqual([
      { x: 4000, y: 3000 },
      { x: 7000, y: 3000 },
    ]);
  });

  it("a wall shorter than the room's edge: the run is the overlap of the two edges", () => {
    const src = plan(
      '  room id=a at (0,0) size 4000x5000 label "A"\n  room id=b at (4000,1000) size 3000x2000 label "B"\n  wall id=p partition thickness 100 between a and b\n',
    );
    expect(wallOf(src, "p").points).toEqual([
      { x: 4000, y: 1000 },
      { x: 4000, y: 3000 },
    ]);
  });

  it("an ordinary authored wall afterwards: material, height, hosted datums, a window on a ring edge", () => {
    const tail =
      "  door id=k on p at 800 from end width 800\n  window id=w on b.top at center width 1200 sill 900\n  window id=w2 on e at 25% width 1000\n";
    twins(
      plan(
        `${ROOMS}  wall id=e exterior thickness 200 material brick height 2800 around [a b c]\n  wall id=p partition thickness 100 height 2400 between c and a\n${tail}`,
      ),
      plan(
        `${ROOMS}  wall id=e exterior thickness 200 material brick height 2800 { (0,0) (7000,0) (7000,5000) (0,5000) close }\n  wall id=p partition thickness 100 height 2400 { (0,3000) (4000,3000) }\n${tail}`,
      ),
    );
    const ir = irOf(
      plan(`${ROOMS}  wall id=e exterior thickness 200 around [a b c]\n  window id=w on b.top width 1200\n`),
    );
    const win = ir.elements.find((e) => e.id === "w") as RWindow;
    expect(win.at).toEqual({ x: 5500, y: 0 });
    expect(win.host!.wallId).toBe("e");
  });
});

// ------------------------------------------------------------------------------------------

suite("beside `walls from rooms`", () => {
  const WFR = "  walls from rooms exterior 200 partition 100\n";
  it("a between wall takes over the derived run exactly as the typed wall does, and the drop is reported", () => {
    const rel = plan(`${ROOMS}${WFR}  wall id=p partition thickness 150 material brick between a and b\n`);
    const typed = plan(`${ROOMS}${WFR}  wall id=p partition thickness 150 material brick { (4000,0) (4000,3000) }\n`);
    twins(rel, typed);
    const rows = describe(rel).derived_walls!;
    expect(rows.find((r) => r.name === "a|b")!.dropped).toEqual([{ x1: 4000, y1: 0, x2: 4000, y2: 3000, by: "p" }]);
    expect(rows).toContainEqual({ from: "between", name: "p", between: ["a", "b"] });
    // the ring and two partitions stay derived; `a|b` is wholly taken over, so it leaves no wall
    expect(describe(rel).freedom.walls).toEqual({ total: 4, derived: 3, absolute: 0, relational: 1 });
  });

  it("an around ring takes over the derived exterior ring", () => {
    const rel = plan(`${ROOMS}${WFR}  wall id=shell exterior thickness 300 around [a b c]\n`);
    const typed = plan(
      `${ROOMS}${WFR}  wall id=shell exterior thickness 300 { (0,0) (7000,0) (7000,5000) (0,5000) close }\n`,
    );
    twins(rel, typed);
  });

  it("a door between the pair hosts on the authored between wall, not on a derived remainder", () => {
    const door = "  door id=d between a and b at 800 from end width 800 hinge left swing into b\n";
    twins(
      plan(`${ROOMS}${WFR}  wall id=p partition thickness 100 between a and b\n${door}`),
      plan(`${ROOMS}${WFR}  wall id=p partition thickness 100 { (4000,0) (4000,3000) }\n${door}`),
    );
    const d = irOf(plan(`${ROOMS}${WFR}  wall id=p partition thickness 100 between a and b\n${door}`)).elements.find(
      (e) => e.id === "d",
    ) as RDoor;
    expect(d.host!.wallId).toBe("p");
  });

  it("E_WALL_BETWEEN_OPEN: a between wall on a pair the statement declares open", () => {
    const src = plan(
      `${ROOMS}  walls from rooms exterior 200 partition 100 { open between a and b }\n  wall id=p partition thickness 100 between a and b\n`,
    );
    const d = one(src, "E_WALL_BETWEEN_OPEN", "open between a and b");
    expect(d.message).toContain('wall "p"');
  });
});

// ------------------------------------------------------------------------------------------

suite("refusals", () => {
  it("E_ROOMS_OVERLAP: overlapping rooms, a room listed twice", () => {
    const over = '  room id=a at (0,0) size 4000x3000 label "A"\n  room id=b at (3000,0) size 3000x3000 label "B"\n';
    one(plan(`${over}  wall partition thickness 100 between a and b\n`), "E_ROOMS_OVERLAP", "between a and b");
    one(plan(`${over}  wall exterior thickness 200 around [a b]\n`), "E_ROOMS_OVERLAP", "around [a b]");
    const twice = one(plan(`${ROOMS}  wall exterior thickness 200 around [a b a]\n`), "E_ROOMS_OVERLAP", "a");
    expect(twice.message).toContain("listed twice");
  });

  it("E_WALL_BETWEEN_NOT_ADJACENT: apart, touching at a corner, one room twice", () => {
    const corner =
      '  room id=a at (0,0) size 4000x3000 label "A"\n  room id=b at (4000,3000) size 3000x3000 label "B"\n  room id=z at (9000,0) size 1000x1000 label "Z"\n';
    // `between a and a` is NOT_ADJACENT (a room shares no edge with itself), as a `door between` reports it
    for (const w of ["between a and b", "between a and z", "between a and a"]) {
      one(plan(`${corner}  wall partition thickness 100 ${w}\n`), "E_WALL_BETWEEN_NOT_ADJACENT", w);
    }
  });

  it("E_ROOM_NOT_RECTANGLE, E_UNKNOWN_REF, E_DATUM_UNPLACED: on the room's name", () => {
    const poly = `${ROOMS}  room id=L polygon (7000,0) (9000,0) (9000,5000) (7000,5000) label "L"\n`;
    one(plan(`${poly}  wall partition thickness 100 between b and L\n`), "E_ROOM_NOT_RECTANGLE", "L");
    one(plan(`${poly}  wall exterior thickness 200 around [a L]\n`), "E_ROOM_NOT_RECTANGLE", "L");
    const unk = one(plan(`${ROOMS}  wall partition thickness 100 between a and bb\n`), "E_UNKNOWN_REF", "bb");
    expect(unk.hints).toEqual(['did you mean "b"?']);
    const unplaced = `${ROOMS}  room id=g right-of ghost size 1000x1000 label "G"\n`;
    one(plan(`${unplaced}  wall partition thickness 100 between a and g\n`), "E_DATUM_UNPLACED", "g");
  });

  it("E_PARTITION_TOO_SHORT: a run shorter than the wall is thick", () => {
    const src = plan(
      '  room id=a at (0,0) size 4000x3000 label "A"\n  room id=b at (4000,2950) size 3000x3000 label "B"\n  wall partition thickness 100 between a and b\n',
    );
    const d = one(src, "E_PARTITION_TOO_SHORT", "between a and b");
    expect(d.message).toContain("run of 50 mm");
    // the same run is long enough for a thinner wall
    expect(errors(src.replace("thickness 100", "thickness 50"))).toEqual([]);
  });

  it("E_ROOMS_NOT_TILING: apart, a pinch, a hole (covered or not: one wall is one ring)", () => {
    const apart = '  room id=a at (0,0) size 4000x3000 label "A"\n  room id=b at (5000,0) size 3000x3000 label "B"\n';
    one(plan(`${apart}  wall exterior thickness 200 around [a b]\n`), "E_ROOMS_NOT_TILING", "around [a b]");
    const pinch =
      '  room id=a at (0,0) size 2000x2000 label "A"\n  room id=b at (2000,2000) size 2000x2000 label "B"\n  room id=c at (2000,0) size 2000x2000 label "C"\n  room id=d at (0,2000) size 1000x2000 label "D"\n  room id=e at (0,4000) size 4000x1000 label "E"\n';
    expect(errors(plan(`${pinch}  wall exterior thickness 200 around [a b c d e]\n`)).map((d) => d.code)).toEqual([
      "E_ROOMS_NOT_TILING",
    ]);
    const ring =
      '  room id=n at (0,0) size 6000x2000 label "N"\n  room id=s at (0,4000) size 6000x2000 label "S"\n  room id=w at (0,2000) size 2000x2000 label "W"\n  room id=e at (4000,2000) size 2000x2000 label "E"\n';
    const hole = one(
      plan(`${ring}  wall exterior thickness 200 around [n s w e]\n`),
      "E_ROOMS_NOT_TILING",
      "around [n s w e]",
    );
    expect(hole.message).toContain("one ring");
    // a void covering the hole exactly does not make it legal here
    one(
      plan(`${ring}  void at (2000,2000) size 2000x2000\n  wall exterior thickness 200 around [n s w e]\n`),
      "E_ROOMS_NOT_TILING",
      "around [n s w e]",
    );
  });

  it("a refused wall has no body, and what names it says it could not be placed", () => {
    const src = plan(
      `${ROOMS}  wall id=p partition thickness 100 between a and z\n  door on p at 50% width 800\n  furniture id=f wardrobe against wall p in a\n  dim radius p offset 500\n`,
    );
    const errs = errors(src);
    // the first error is the refusal, on its clause's room name; each follow-on names it
    expect(errs.map((d) => d.code)).toEqual([
      "E_UNKNOWN_REF",
      "E_ATTACH_WALL_REF",
      "E_FURN_AGAINST",
      "E_DIM_CURVE_REF",
    ]);
    expect(src.slice(errs[0]!.span!.start, errs[0]!.span!.end)).toBe("z");
    for (const d of errs.slice(1)) {
      expect(d.message).toContain('"p"');
      expect(d.message).toContain("could not be placed (see its own error)");
      expect(d.message).not.toContain("no wall has that id");
    }
    // a name that is no wall at all keeps the old text
    expect(errors(plan(`${ROOMS}  door on nope at 50% width 800\n`))[0]!.message).toContain(
      "no wall has that id or category",
    );
    expect(() => describe(src)).not.toThrow();
    expect(() => lint(src)).not.toThrow();
    expect(() => planToJson(src)).not.toThrow();
  });

  it("a refused wall inside a placed instance, named from the root, says the same", () => {
    const src = `plan "p" {\n  units mm\n  grid 50\n  component unit() {\n    room id=a at (0,0) size 4000x3000 label "A"\n    room id=b at (5000,0) size 3000x3000 label "B"\n    wall id=p partition thickness 100 between a and b\n  }\n  place unit() as west at (0,0)\n  door on west.p at 50% width 800\n}\n`;
    const errs = errors(src);
    expect(errs.map((d) => d.code)).toEqual(["E_WALL_BETWEEN_NOT_ADJACENT", "E_ATTACH_WALL_REF"]);
    expect(errs[1]!.message).toContain('wall "west.p" could not be placed');
  });

  it("every code is catalogued with the pairwise form named", async () => {
    const { ERROR_CATALOG } = await import("../src/error-catalog.js");
    for (const c of [
      "E_ROOMS_OVERLAP",
      "E_WALL_BETWEEN_NOT_ADJACENT",
      "E_ROOM_NOT_RECTANGLE",
      "E_PARTITION_TOO_SHORT",
      "E_ROOMS_NOT_TILING",
    ]) {
      const e = ERROR_CATALOG[c]!;
      expect(`${e.message} ${e.cause}`, c).toMatch(/`wall … (between|around)`/);
    }
  });
});

// ------------------------------------------------------------------------------------------

suite("instances and the widening drill", () => {
  const comp = (walls: string) =>
    `plan "p" {\n  units mm\n  grid 50\n  component unit() {\n${ROOMS.replace(/^ {2}/gm, "    ")}${walls}    door id=d between a and b at 800 from end width 800 hinge left swing into b\n    window id=w on b.top at 1000 from b.left width 1200\n  }\n` +
    [0, 90, 180, 270]
      .flatMap((r, i) => [
        `  place unit() as r${r} at (${i * 20000},0) rotate ${r}\n`,
        `  place unit() as m${r} at (${i * 20000},20000) rotate ${r} mirror x\n`,
      ])
      .join("") +
    "}\n";
  it("pairwise walls inside a placed component, under all eight frames, equal the typed twins", () => {
    const rel = comp(
      "    wall id=e exterior thickness 200 around [a b c]\n    wall id=p partition thickness 100 between a and b\n    wall id=q partition thickness 100 between c and a\n",
    );
    const typed = comp(
      "    wall id=e exterior thickness 200 { (0,0) (7000,0) (7000,5000) (0,5000) close }\n    wall id=p partition thickness 100 { (4000,0) (4000,3000) }\n    wall id=q partition thickness 100 { (0,3000) (4000,3000) }\n",
    );
    twins(rel, typed);
    const rows = describe(rel).derived_walls!;
    expect(rows).toContainEqual({ from: "between", name: "r90.p", between: ["r90.a", "r90.b"] });
    expect(rows).toContainEqual({ from: "around", name: "m270.e", around: ["m270.a", "m270.b", "m270.c"] });
    expect(rows).toHaveLength(24);
  });

  it("the root reads a placed instance's rooms by their dotted names", () => {
    const src = `plan "p" {\n  units mm\n  grid 50\n  component unit() {\n    room id=a at (0,0) size 4000x3000 label "A"\n  }\n  place unit() as west at (0,0)\n  room id=b at (4000,0) size 3000x3000 label "B"\n  wall id=p partition thickness 100 between west.a and b\n}\n`;
    expect(errors(src)).toEqual([]);
    expect(wallOf(src, "p").points).toEqual([
      { x: 4000, y: 0 },
      { x: 4000, y: 3000 },
    ]);
  });

  const widen = (aw: number) =>
    plan(
      `  room id=a at (0,0) size ${aw}x5000 label "Living"\n  room id=b right-of a align top gap 0 size 4000x5000 label "Bed"\n  wall id=e exterior thickness 200 around [a b]\n  wall id=p partition thickness 100 between a and b\n  door id=d between a and b at 800 from end width 800 hinge left swing into b\n  window id=w on b.top width 1500\n`,
    );
  it("widening a room by 500 mm moves the between wall, the around ring, and what they host", () => {
    const before = irOf(widen(4000));
    const after = irOf(widen(4500));
    const pts = (ir: ResolvedPlan, id: string) => ir.walls.find((w) => w.id === id)!.points;
    expect(pts(before, "p")).toEqual([
      { x: 4000, y: 0 },
      { x: 4000, y: 5000 },
    ]);
    expect(pts(after, "p")).toEqual([
      { x: 4500, y: 0 },
      { x: 4500, y: 5000 },
    ]);
    expect(pts(after, "e")).toEqual([
      { x: 0, y: 0 },
      { x: 8500, y: 0 },
      { x: 8500, y: 5000 },
      { x: 0, y: 5000 },
    ]);
    expect((after.elements.find((e) => e.id === "d") as RDoor).at).toEqual({ x: 4500, y: 4200 });
    // the widened plan draws as the hand-edited one
    const hand = plan(
      '  room id=a at (0,0) size 4500x5000 label "Living"\n  room id=b right-of a align top gap 0 size 4000x5000 label "Bed"\n  wall id=e exterior thickness 200 { (0,0) (8500,0) (8500,5000) (0,5000) close }\n  wall id=p partition thickness 100 { (4500,0) (4500,5000) }\n  door id=d at (4500,4200) width 800 wall p hinge left swing into b\n  window id=w at (6500,0) width 1500 wall e\n',
    );
    expect(compile(widen(4500)).svg).toBe(compile(hand).svg);
    for (const src of [widen(4000), widen(4500)]) expect(errors(src)).toEqual([]);
  });
});

// ------------------------------------------------------------------------------------------

suite("bounded", () => {
  it("the around sweep is charged at least n log n + 3n (n = 4 edges per room) before it runs", () => {
    const rooms = (k: number) =>
      Array.from({ length: k }, (_, i) => ({
        id: `r${i}`,
        rect: { x0: i * 1000, y0: 0, x1: i * 1000 + 1000, y1: 1000 },
      }));
    for (const k of [1, 10, 100]) {
      const run = withStepMeter(0, () => deriveAround(rooms(k)));
      if ("signal" in run) throw new Error("step budget");
      expect(run.value.ok).toBe(true);
      expect(run.used).toBeGreaterThanOrEqual(sortSteps(4 * k) + 3 * 4 * k);
    }
  });

  it("an around ring counts 4 per listed room toward MAX_ELEMENTS at expansion", () => {
    // 1000 rings over 2 rooms: 1000 walls + 8000 counted vertices crosses 5000
    const src = plan(
      `  room id=a at (0,0) size 1000x1000\n  room id=b at (1000,0) size 1000x1000\n  for i in 0..999 {\n    wall exterior thickness 100 around [a b]\n  }\n`,
    );
    const ds = compile(src).diagnostics.filter((d) => d.code === "E_ELEMENT_LIMIT");
    expect(ds).toHaveLength(1);
    expect(ds[0]!.message).toContain("`wall … around` over 2 rooms may draw a ring of up to 8 vertices");
    // the same count of typed rings is within the budget
    expect(
      compile(src.replace("around [a b]", "{ (0,0) (2000,0) (2000,1000) (0,1000) close }")).diagnostics.filter(
        (d) => d.code === "E_ELEMENT_LIMIT",
      ),
    ).toEqual([]);
  });
});

// ------------------------------------------------------------------------------------------

suite("Plan JSON", () => {
  it("exports a pairwise wall by its resolved points, as a typed wall: the geometry round-trips, the relation does not", () => {
    const src = plan(
      `${ROOMS}  wall id=e exterior thickness 200 around [a b c]\n  wall id=p partition thickness 100 between a and b\n`,
    );
    const { json, diagnostics } = planToJson(src);
    expect(diagnostics.filter((d) => d.severity === "error")).toEqual([]);
    expect(json!.walls.map((w) => [w.id, w.points.map((q) => [q.x, q.y]), w.closed ?? false])).toEqual([
      [
        "e",
        [
          [0, 0],
          [7000, 0],
          [7000, 5000],
          [0, 5000],
        ],
        true,
      ],
      [
        "p",
        [
          [4000, 0],
          [4000, 3000],
        ],
        false,
      ],
    ]);
    expect(JSON.stringify(json)).not.toContain("around");
    const { source } = planFromJson(json as PlanJson);
    expect(compile(source!).svg).toBe(compile(src).svg);
  });
});
