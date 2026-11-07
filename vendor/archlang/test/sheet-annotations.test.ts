/**
 * The issued-sheet statements: `notes "…"`, the title block's `number`/`revision` fields, and
 * `schedule openings` (door/window tags + the DOOR & WINDOW SCHEDULE).
 *
 * What carries the weight:
 *
 * 1. **The byte-identity law, both halves.** A plan that writes none of the forms is
 *    untouched — pinned for the whole corpus by the existing law tables
 *    (`byte-identity-baseline.ts`, `while-byte-identity-baseline.ts`), which this branch only
 *    ADDED rows to. And a plan that writes them changes its DRAWING only: `describe()`,
 *    `lint()` and `compile().diagnostics` are byte-identical to the same source with every
 *    new statement removed (`examples/sheet-notes.arch` below), which is what "draws only"
 *    means.
 * 2. **The tags are derived from the shape.** A tag sits off a wall face with floor on it,
 *    beside a door's jamb and outside its leaf's quarter-disc, never in front of the doorway.
 * 3. **The schedule is derived from the plan**: rooms by the same derivation as
 *    `describe().doors[].between` / `windows[].room`, the hand read off the drawn leaf.
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { compile, describe as describePlan, lint } from "../src/index.js";
import { format } from "../src/format.js";
import { parse } from "../src/parser.js";
import { resolve } from "../src/ir.js";
import type { RDoor, ResolvedElement } from "../src/ir.js";
import { doorHand, openingRows } from "../src/opening-schedule.js";
import { doorSwing, segmentDirAt } from "../src/geometry.js";
import { planFromJson, planToJson } from "../src/plan-json.js";
import { drawBudgetDiagnostic, storeyPassUnits } from "../src/draw-budget.js";
import { BUILTIN_REGISTRY } from "../src/registry.js";
import { MAX_NOTE_LINES, NOTE_LINE_CHARS, noteLineCount, wrapNote } from "../src/sheet-tables.js";
import { MODEL_RANGE_MM } from "../src/num-format.js";
import type { Scene, SceneNode } from "../src/scene.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const EXAMPLE = readFileSync(join(HERE, "..", "examples", "sheet-notes.arch"), "utf8");

const sceneOf = (src: string): Scene => {
  const { scene, errors } = compile(src, { noCache: true });
  expect(errors).toEqual([]);
  return scene!;
};
const elementsOf = (src: string): ResolvedElement[] => resolve(parse(src).plan!).ir.elements;
const texts = (nodes: readonly SceneNode[]): string[] =>
  nodes.flatMap((n) => (n.prim.t === "text" ? [n.prim.value] : []));

/** The new statements, stripped line by line — the source the example "would be" without them. */
const withoutSheetAnnotations = (src: string): string =>
  src
    .split("\n")
    .filter((l) => !/^\s*(notes\b|schedule openings\b)/.test(l))
    .map((l) => l.replace(/ number "[^"]*"/, "").replace(/ revision "[^"]*"/, ""))
    .join("\n");

const box = (body: string): string =>
  `plan "P" {\n  units mm\n  paper A3\n  wall id=w exterior thickness 200 { (0,0) (6000,0) (6000,4000) (0,4000) close }\n` +
  `  room id=r at (0,0) size 6000x4000 label "Hall"\n${body}}\n`;

describe("parsing — the three forms", () => {
  it("`notes` takes one or more strings and repeats append, in source order", () => {
    const p = parse(box(`  notes "a" "b"\n  notes "c"\n`)).plan!;
    expect(p.notes).toEqual(["a", "b", "c"]);
  });

  it("`notes` with no string is a parse error, never a silent no-op", () => {
    const out = parse(box(`  notes\n`));
    expect(out.diagnostics.map((d) => d.code)).toContain("E_PARSE");
  });

  it("title takes `number` and `revision`", () => {
    const p = parse(box(`  title { project "X" number "A-101" revision "B" }\n`)).plan!;
    expect(p.title).toMatchObject({ project: "X", number: "A-101", revision: "B" });
  });

  it("`schedule rooms` and `schedule openings` compose; neither overwrites the other", () => {
    const p = parse(box(`  schedule openings\n  schedule rooms\n`)).plan!;
    expect(p.schedule).toBe("rooms");
    expect(p.openingSchedule).toBe(true);
    const q = parse(box(`  schedule rooms\n`)).plan!;
    expect(q.openingSchedule).toBeUndefined();
  });

  it("an unknown subject still fails, naming both subjects", () => {
    const out = parse(box(`  schedule doors\n`));
    const d = out.diagnostics.find((x) => x.code === "E_PARSE")!;
    expect(d.message).toMatch(/available: rooms, openings/);
  });

  it("the formatter is a fixed point and keeps every note, number and revision", () => {
    const src = box(
      `  schedule openings\n  notes "One \\"quoted\\" {brace}" "Two"\n  title { project "X" number "A-1" revision "C" }\n`,
    );
    const once = format(src);
    expect(format(once)).toBe(once);
    const p = parse(once).plan!;
    expect(p.notes).toEqual(['One "quoted" {brace}', "Two"]);
    expect(p.title).toMatchObject({ number: "A-1", revision: "C" });
    expect(p.openingSchedule).toBe(true);
  });
});

describe("the byte-identity law — the forms draw, and only draw", () => {
  it("the example's describe(), lint() and diagnostics equal the same plan without the forms", () => {
    const bare = withoutSheetAnnotations(EXAMPLE);
    expect(bare).not.toBe(EXAMPLE);
    const code = bare
      .split("\n")
      .filter((l) => !/^\s*#/.test(l))
      .join("\n");
    expect(code).not.toMatch(/\bnotes\b|schedule openings|\bnumber "|\brevision "/);
    expect(JSON.stringify(describePlan(EXAMPLE))).toBe(JSON.stringify(describePlan(bare)));
    expect(JSON.stringify(lint(EXAMPLE))).toBe(JSON.stringify(lint(bare)));
    expect(JSON.stringify(compile(EXAMPLE, { noCache: true }).diagnostics)).toBe(
      JSON.stringify(compile(bare, { noCache: true }).diagnostics),
    );
    // …and the drawing DID change, so the comparison above is not vacuous.
    expect(compile(EXAMPLE, { noCache: true }).svg).not.toBe(compile(bare, { noCache: true }).svg);
  });

  it("a plan with none of the forms draws no tag, no NOTES and no new title row", () => {
    const s = sceneOf(box(`  door on w at 1000 width 900\n  window on w at 3000 width 1200\n`));
    const all = texts(s.nodes);
    expect(all.some((t) => /^[DW]\d\d$/.test(t))).toBe(false);
    expect(all).not.toContain("NOTES");
    expect(all).not.toContain("DOOR & WINDOW SCHEDULE");
    expect(s.chrome?.titleBlock?.rows.map((r) => r.k) ?? []).not.toContain("DRAWING NO.");
    expect(s.chrome?.tables).toBeUndefined();
  });
});

describe("what the sheet draws", () => {
  it("the title block gains DRAWING NO. and REVISION rows, before SCALE", () => {
    const s = sceneOf(EXAMPLE);
    expect(s.chrome?.titleBlock?.rows).toEqual([
      { k: "PROJECT", v: "Sheet Notes Flat" },
      { k: "DRAWN BY", v: "ArchLang" },
      { k: "DATE", v: "2026-10-13" },
      { k: "DRAWING NO.", v: "A-101" },
      { k: "REVISION", v: "B" },
      { k: "SCALE", v: "1:50" },
    ]);
  });

  it("NOTES draws a numbered row per note, and a `\\n` note continues unnumbered", () => {
    const s = sceneOf(box(`  notes "First" "Second\\nwraps"\n`));
    const t = s.chrome!.tables!.notes!;
    expect(t.lines).toEqual([
      { no: "1.", text: "First" },
      { no: "2.", text: "Second" },
      { no: "", text: "wraps" },
    ]);
    expect(texts(s.nodes)).toEqual(expect.arrayContaining(["NOTES", "1.", "First", "2.", "Second", "wraps"]));
  });

  it("the DOOR & WINDOW SCHEDULE rows are the example's openings, derived", () => {
    expect(openingRows(elementsOf(EXAMPLE)).map(({ id: _id, ...r }) => r)).toEqual([
      { tag: "D01", kind: "door", rooms: "exterior / Living Room", width: "1000", type: "hinged", hand: "left" },
      { tag: "D02", kind: "door", rooms: "Living Room / Bedroom", width: "900", type: "hinged", hand: "left" },
      { tag: "D03", kind: "door", rooms: "Living Room / Study", width: "900", type: "sliding", hand: "-" },
      { tag: "W01", kind: "window", rooms: "Living Room", width: "1800", type: "window", hand: "-" },
      { tag: "W02", kind: "window", rooms: "Bedroom", width: "1400", type: "window", hand: "-" },
      { tag: "W03", kind: "window", rooms: "Study", width: "1400", type: "window", hand: "-" },
    ]);
  });

  it("the rooms column is describe()'s own answer, room id for room id", () => {
    const d = describePlan(EXAMPLE);
    const name = new Map(d.rooms.map((r) => [r.id, r.label ?? r.id]));
    const rows = openingRows(elementsOf(EXAMPLE));
    for (const door of d.doors) {
      const row = rows.find((r) => r.id === door.id)!;
      expect(row.rooms).toBe(door.between.map((id) => name.get(id) ?? id).join(" / "));
    }
    for (const w of d.windows) {
      const row = rows.find((r) => r.id === w.id)!;
      expect(row.rooms).toBe(w.room === null ? "-" : name.get(w.room));
    }
  });

  it("a window on a wall between two rooms lists both, the one describe() names first", () => {
    const src =
      `plan "W" {\n  units mm\n  wall id=p partition thickness 100 { (0,2000) (4000,2000) }\n` +
      `  room id=a at (0,0) size 4000x2000 label "Office"\n  room id=b at (0,2000) size 4000x2000 label "Lab"\n` +
      `  window id=w on p at 2000 width 1200\n}\n`;
    expect(describePlan(src).windows[0]!.room).toBe("a");
    expect(openingRows(elementsOf(src))[0]!.rooms).toBe("Office / Lab");
  });

  it("a ROOM(S) cell is clipped to its column; a long name never widens the table", () => {
    const long = "A Very Long Room Name That Goes On And On";
    const sOf = (label: string) =>
      sceneOf(box(`  schedule openings\n  door on w at 1000 width 900\n`).replace('label "Hall"', `label "${label}"`));
    const t = sOf(long).chrome!.tables!.openings!;
    const cell = t.rows[0]!.rooms;
    expect(cell.endsWith("...")).toBe(true);
    expect(cell.length).toBeLessThan(`exterior / ${long}`.length);
    expect(t.w).toBe(sOf("Hall").chrome!.tables!.openings!.w);
  });

  it("the sheet fit reserves the new rows: the example's A3 page is not grown", () => {
    const s = sceneOf(EXAMPLE);
    expect(s.sheet?.grown).toBe(false);
    expect(describePlan(EXAMPLE).sheet?.fits).toBe(true);
  });
});

describe("tags — placed from the opening's own shape", () => {
  const tagNodes = (src: string): { tag: string; at: { x: number; y: number }; frame: SceneNode }[] => {
    const nodes = sceneOf(src).nodes;
    const out: { tag: string; at: { x: number; y: number }; frame: SceneNode }[] = [];
    nodes.forEach((n, i) => {
      // A tag's text follows its frame (a circle, or a box); a table's TAG cell follows text.
      const prev = nodes[i - 1];
      const framed = prev !== undefined && (prev.prim.t === "circle" || prev.prim.t === "polygon");
      if (n.layer === "annotations" && n.prim.t === "text" && /^[DW]\d\d$/.test(n.prim.value) && framed)
        out.push({ tag: n.prim.value, at: n.prim.at, frame: prev });
    });
    return out;
  };

  it("every door and window gets exactly one tag, a frame then its text", () => {
    const tags = tagNodes(EXAMPLE);
    expect(tags.map((t) => t.tag)).toEqual(["D01", "D02", "D03", "W01", "W02", "W03"]);
    for (const t of tags.filter((x) => x.tag.startsWith("D"))) expect(t.frame.prim.t).toBe("circle");
    for (const t of tags.filter((x) => x.tag.startsWith("W"))) expect(t.frame.prim.t).toBe("polygon");
  });

  it("a door tag sits past a jamb (never in front of the doorway) and outside its leaf's quarter-disc", () => {
    const els = elementsOf(EXAMPLE);
    const doors = els.filter((e): e is RDoor => e.kind === "door");
    const tags = tagNodes(EXAMPLE).filter((t) => t.tag.startsWith("D"));
    doors.forEach((d, i) => {
      const c = tags[i]!.frame.prim as { t: "circle"; center: { x: number; y: number }; r: number };
      const dir = segmentDirAt(d.host!, d.at);
      const along = (c.center.x - d.at.x) * dir.x + (c.center.y - d.at.y) * dir.y;
      // The whole circle lies beyond a jamb, so it is clear of the passage.
      expect(Math.abs(along) - c.r).toBeGreaterThan(d.width / 2);
      const s = doorSwing(d);
      if (s) {
        // Outside the disc of radius `width` about the hinge, or behind the hinge.
        const hx = c.center.x - s.hinge.x;
        const hy = c.center.y - s.hinge.y;
        const toFar = { x: s.farJamb.x - s.hinge.x, y: s.farJamb.y - s.hinge.y };
        const behind = hx * toFar.x + hy * toFar.y < 0;
        expect(behind || Math.hypot(hx, hy) - c.r > d.width).toBe(true);
      }
    });
  });

  it("a window tag sits on the face with floor — inside the building, away from the dims", () => {
    for (const t of tagNodes(EXAMPLE).filter((x) => x.tag.startsWith("W"))) {
      expect(t.at.x).toBeGreaterThan(0);
      expect(t.at.x).toBeLessThan(9000);
      expect(t.at.y).toBeGreaterThan(0);
      expect(t.at.y).toBeLessThan(6000);
    }
    // The exterior front door swings IN, so its tag is inside too (the free face is outside).
    const d01 = tagNodes(EXAMPLE).find((t) => t.tag === "D01")!;
    expect(d01.at.y).toBeGreaterThan(0);
  });
});

describe("hand — read off the drawn leaf, not the traversal word", () => {
  const door = (wall: string, hinge: string, swing: string): RDoor =>
    elementsOf(
      `plan "H" {\n  units mm\n  wall id=w partition thickness 100 { ${wall} }\n` +
        `  room id=a at (0,0) size 4000x2000\n  room id=b at (0,2000) size 4000x2000\n` +
        `  door id=d at (2000,2000) width 900 wall w hinge ${hinge} swing ${swing}\n}\n`,
    ).find((e): e is RDoor => e.kind === "door")!;

  it("reversing the wall's points with the hinge word flipped draws the same door, and reads the same hand", () => {
    const fwd = door("(0,2000) (4000,2000)", "left", "in");
    const rev = door("(4000,2000) (0,2000)", "right", "out");
    expect(doorSwing(fwd)).toEqual(doorSwing(rev));
    expect(doorHand(fwd)).toBe(doorHand(rev));
  });

  it("the other hinge is the other hand", () => {
    expect(doorHand(door("(0,2000) (4000,2000)", "left", "in"))).not.toBe(
      doorHand(door("(0,2000) (4000,2000)", "right", "in")),
    );
  });

  it("a mirrored `place` swaps the hand; a quarter-turn does not", () => {
    const placed = (frame: string): string =>
      openingRows(
        elementsOf(
          `plan "M" {\n  units mm\n  component c() {\n` +
            `    wall id=w partition thickness 100 { (0,2000) (4000,2000) }\n` +
            `    room id=a at (0,0) size 4000x2000\n    room id=b at (0,2000) size 4000x2000\n` +
            `    door id=d at (2000,2000) width 900 wall w hinge left swing in\n  }\n` +
            `  place c() as u at (0,0)${frame}\n}\n`,
        ),
      )[0]!.hand;
    const base = placed("");
    expect(base).toMatch(/^(left|right)$/);
    expect(placed(" rotate 90")).toBe(base);
    expect(placed(" mirror x")).not.toBe(base);
  });

  it("a non-hinged door has no hand", () => {
    const els = elementsOf(box(`  door sliding on w at 1000 width 900\n`));
    expect(openingRows(els)[0]!.hand).toBe("-");
  });
});

describe("budgets and round-trips", () => {
  it("the drawing budget counts at least what the tags and tables draw", () => {
    const src = EXAMPLE;
    const ir = resolve(parse(src).plan!).ir;
    const withForms = storeyPassUnits(ir, BUILTIN_REGISTRY);
    const bareIr = resolve(parse(withoutSheetAnnotations(src)).plan!).ir;
    const without = storeyPassUnits(bareIr, BUILTIN_REGISTRY);
    const drawn = sceneOf(src).nodes.length - sceneOf(withoutSheetAnnotations(src)).nodes.length;
    expect(withForms - without).toBeGreaterThanOrEqual(drawn);
    expect(drawBudgetDiagnostic([{ ir }], BUILTIN_REGISTRY, undefined)).toBeUndefined();
  });

  it("a huge NOTES list is refused by the drawing budget, not drawn", () => {
    const many = Array.from({ length: 2000 }, (_, i) => `"n${i}"`).join(" ");
    const src = box(`  notes ${Array.from({ length: 100 }, () => many).join("\n  notes ")}\n`);
    const out = compile(src, { noCache: true });
    expect(out.diagnostics.map((d) => d.code)).toContain("E_DRAWING_LIMIT");
  });

  it("Plan JSON round-trips the title block's number and revision", () => {
    const src = `plan "J" {\n  units mm\n  room id=r at (0,0) size 3000x3000\n  title { project "J" number "A-7" revision "C" }\n}\n`;
    const { json } = planToJson(src);
    expect(json?.title).toEqual({ project: "J", number: "A-7", revision: "C" });
    const back = planFromJson(json);
    expect(back.diagnostics).toEqual([]);
    expect(back.ast?.title).toMatchObject({ project: "J", number: "A-7", revision: "C" });
  });
});

describe("NOTES — a fixed column: text adds rows, never width", () => {
  const viewBox = (svg: string): number[] => /viewBox="([^"]+)"/.exec(svg)![1]!.split(" ").map(Number);
  const withNote = (note: string): string => EXAMPLE.replace(/(\n {2}notes "Door hand[^\n]*)/, `$1\n  notes "${note}"`);

  it("wrapNote breaks at spaces, keeps `\\n` breaks, cuts an over-long word, never splits a surrogate pair", () => {
    expect(wrapNote("aa bb cc dd", 5)).toEqual(["aa bb", "cc dd"]);
    expect(wrapNote("aa  bb\ncc", 10)).toEqual(["aa bb", "cc"]);
    expect(wrapNote("abcdefghij", 4)).toEqual(["abcd", "efgh", "ij"]);
    for (const line of wrapNote("😀😀😀😀😀", 3)) expect(line).not.toMatch(/^[\uDC00-\uDFFF]|[\uD800-\uDBFF]$/);
    expect(wrapNote("", 5)).toEqual([""]);
  });

  it("a cut never starts a line with a combining mark (it stays on its base letter)", () => {
    const lines = wrapNote("é".repeat(20), 5);
    expect(lines.join("")).toBe("é".repeat(20));
    for (const line of lines) expect(line).not.toMatch(/^[̀-ͯ]/);
  });

  it("a run of combining marks or lone low surrogates is still cut at the width — no line is ever unbounded", () => {
    const W = NOTE_LINE_CHARS;
    const mark = "́";
    const cases = [mark.repeat(10_000), `ab${mark.repeat(300)} cd`, "\udc00".repeat(500), `x${"\udc00".repeat(130)}`];
    for (const note of cases) {
      const lines = wrapNote(note);
      for (const l of lines) expect(l.length).toBeLessThanOrEqual(W);
      // Nothing lost (spaces aside), and no phantom empty line after a word cut at the width.
      expect(lines.join("").replace(/ /g, "")).toBe(note.replace(/ /g, ""));
      expect(lines.every((l) => l !== "")).toBe(true);
    }
    expect(wrapNote(mark.repeat(10_000)).length).toBe(Math.ceil(10_000 / W));
    expect(wrapNote("x".repeat(2 * W))).toEqual(["x".repeat(W), "x".repeat(W)]);
    // A real surrogate pair is still never split, even inside a run of marks.
    for (const l of wrapNote(`${mark.repeat(W - 1)}😀${mark.repeat(W)}`))
      expect(l).not.toMatch(/^[\uDC00-\uDFFF]|[\uD800-\uDBFF]$/);
  });

  it("the count is wrapNote's line count, over generated notes with mark runs, pairs and lone surrogates", () => {
    // A fixed-seed generator (no randomness in a test): spaces, newlines, letters, combining
    // marks, emoji pairs, lone low surrogates, in runs of every length.
    let seed = 12345;
    const next = (n: number): number => {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      return seed % n;
    };
    const pieces = [" ", "\n", "a", "word", "́", "́".repeat(80), "😀", "\udc00", "\udc00".repeat(70), "x".repeat(120)];
    for (let k = 0; k < 300; k++) {
      let note = "";
      for (let j = next(40); j > 0; j--) note += pieces[next(pieces.length)];
      const lines = wrapNote(note);
      expect(noteLineCount([note], Number.POSITIVE_INFINITY)).toBe(lines.length);
      for (const l of lines) expect(l.length).toBeLessThanOrEqual(NOTE_LINE_CHARS);
    }
  });

  it("a note of 2,000,000 combining marks is refused like any note past the cap", () => {
    const out = compile(box(`  notes "${"́".repeat(2_000_000)}"\n`), { noCache: true });
    expect(out.diagnostics.map((d) => d.code)).toContain("E_DRAWING_LIMIT");
    expect(out.svg).toBe("");
  });

  it("counting stops at the cap: a 2,000,000-character note costs one past the cap to count", () => {
    expect(noteLineCount(["z".repeat(2_000_000)])).toBe(MAX_NOTE_LINES + 1);
    expect(noteLineCount(["a b"], 1)).toBe(1);
    // …and the count agrees with the drawn lines below the cap.
    const note = "word ".repeat(300);
    expect(noteLineCount([note])).toBe(wrapNote(note).length);
  });

  it("a 254-character note on the example sheet wraps, is counted by the fit, and does not grow the A3 page", () => {
    const note = Array.from({ length: 40 }, (_, i) => `word${i}`)
      .join(" ")
      .slice(0, 254);
    const src = withNote(note);
    const s = sceneOf(src);
    expect(s.chrome!.tables!.notes!.lines.length).toBeGreaterThan(5);
    expect(s.sheet?.grown).toBe(false);
    expect(describePlan(src).sheet?.fits).toBe(true);
    // The table is exactly as wide as with the short notes alone.
    expect(s.chrome!.tables!.notes!.w).toBe(sceneOf(EXAMPLE).chrome!.tables!.notes!.w);
  });

  it("a note at the line cap draws a page no wider than the example's, inside the modelling range", () => {
    const note = "x".repeat(NOTE_LINE_CHARS * (MAX_NOTE_LINES - 10));
    const out = compile(withNote(note), { noCache: true });
    expect(out.errors).toEqual([]);
    const [, , w, h] = viewBox(out.svg);
    expect(w).toBe(viewBox(compile(EXAMPLE, { noCache: true }).svg)[2]);
    expect(h).toBeLessThan(MODEL_RANGE_MM);
  });

  it("a 2,000,000-character note is a Diagnostic, never a drawing (and a 20 KB one too)", () => {
    for (const n of [2_000_000, 20_000]) {
      const out = compile(withNote("y".repeat(n)), { noCache: true });
      expect(out.diagnostics.map((d) => d.code)).toContain("E_DRAWING_LIMIT");
      expect(out.svg).not.toMatch(/viewBox="[^"]*\d{9}/);
    }
    expect(noteLineCount(["y".repeat(20_000)])).toBeGreaterThan(MAX_NOTE_LINES);
  });
});

describe("tags — clear of every other opening on the wall", () => {
  // The red-team repro: two 800 mm doors 200 mm apart on one partition.
  const ADJ = `plan "Adj" {
  units mm
  schedule openings
  wall id=s exterior thickness 200 { (0,0) (6000,0) (6000,4000) (0,4000) close }
  wall id=p partition thickness 100 { (0,2000) (6000,2000) }
  room id=a at (0,0) size 6000x2000 label "Hall"
  room id=b at (0,2000) size 6000x2000 label "Bed 1"
  door id=d1 on p at 2400 width 800 hinge right swing in
  door id=d2 on p at 3400 width 800 hinge left swing out
  window on s at 1000 width 1200
  window on s at 5000 width 1200
}
`;

  /** Axis-aligned bounds of what one element draws, from the annotated scene. */
  const drawnBox = (nodes: readonly SceneNode[], id: string) => {
    const pts: { x: number; y: number }[] = [];
    for (const n of nodes) {
      if (n.elementId !== id) continue;
      const p = n.prim;
      if (p.t === "polygon") pts.push(...p.pts);
      else if (p.t === "line") pts.push(p.a, p.b);
      else if (p.t === "arc") pts.push(p.start, p.end, p.center);
    }
    const xs = pts.map((q) => q.x);
    const ys = pts.map((q) => q.y);
    return { x0: Math.min(...xs), x1: Math.max(...xs), y0: Math.min(...ys), y1: Math.max(...ys) };
  };

  it("neither door's tag lands on the other door's leaf, swing or doorway, nor on the other tag", () => {
    const { scene, errors } = compile(ADJ, { noCache: true, annotate: true });
    expect(errors).toEqual([]);
    const nodes = scene!.nodes;
    const circles = nodes.filter((n) => n.layer === "annotations" && n.prim.t === "circle");
    expect(circles).toHaveLength(2);
    const [c1, c2] = circles.map((n) => n.prim as { t: "circle"; center: { x: number; y: number }; r: number });
    const tagBox = (c: { center: { x: number; y: number }; r: number }) => ({
      x0: c.center.x - c.r,
      x1: c.center.x + c.r,
      y0: c.center.y - c.r,
      y1: c.center.y + c.r,
    });
    const overlaps = (a: ReturnType<typeof tagBox>, b: ReturnType<typeof tagBox>) =>
      a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1;
    expect(overlaps(tagBox(c1!), drawnBox(nodes, "d2"))).toBe(false);
    expect(overlaps(tagBox(c2!), drawnBox(nodes, "d1"))).toBe(false);
    expect(overlaps(tagBox(c1!), tagBox(c2!))).toBe(false);
  });

  it("three 900 doors at 1000 pitch, mixed hands: no tag on another door's ink or on another tag", () => {
    // The red-team round-2 case: every first-row place conflicts somewhere, and the tag must
    // still find an ink-free place rather than trade one conflict for another.
    const src = ADJ.replace(
      /\n {2}door id=d1[^\n]*\n {2}door id=d2[^\n]*/,
      "\n  door id=d1 on p at 1500 width 900 hinge right swing in\n  door id=d2 on p at 2500 width 900 hinge left swing out\n  door id=d3 on p at 3500 width 900 hinge right swing in",
    );
    const { scene, errors } = compile(src, { noCache: true, annotate: true });
    expect(errors).toEqual([]);
    const nodes = scene!.nodes;
    const tags = nodes
      .filter((n) => n.layer === "annotations" && n.prim.t === "circle")
      .map((n) => n.prim as { center: { x: number; y: number }; r: number })
      .map((c) => ({ x0: c.center.x - c.r, x1: c.center.x + c.r, y0: c.center.y - c.r, y1: c.center.y + c.r }));
    expect(tags).toHaveLength(3);
    const overlaps = (a: (typeof tags)[number], b: (typeof tags)[number]) =>
      a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1;
    const ids = ["d1", "d2", "d3"];
    tags.forEach((t, i) => {
      for (const [j, id] of ids.entries())
        if (j !== i) expect(overlaps(t, drawnBox(nodes, id)), `D0${i + 1} on ${id}`).toBe(false);
      for (const [j, o] of tags.entries()) if (j !== i) expect(overlaps(t, o)).toBe(false);
    });
  });

  it("with the neighbour removed, D01 keeps its first choice — the avoidance only moves a tag that must move", () => {
    const alone = ADJ.replace(/\n {2}door id=d2[^\n]*/, "");
    const at = (src: string) =>
      (
        sceneOf(src).nodes.find((n) => n.layer === "annotations" && n.prim.t === "circle")!.prim as {
          center: { x: number; y: number };
        }
      ).center;
    const first = at(alone);
    // Beside the hinge jamb (d1 hinges right, so toward +x of 2400 + 400), off the free face.
    expect(first.x).toBeGreaterThan(2800);
    expect(at(ADJ)).not.toEqual(first);
  });
});
