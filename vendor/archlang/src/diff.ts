/**
 * `diffPlans(sourceA, sourceB)` — a pure, structural semantic diff of two plans.
 *
 * Where {@link import("./describe.js").describe} turns one source into *facts*, this
 * turns two sources into the *delta* between them: which rooms were added, removed,
 * resized, moved or relabeled; which doors/windows/openings appeared, vanished, changed
 * width or were re-hosted; which walls (authored or derived) came, went, moved, resized or
 * changed thickness; which furniture came and went; and the before/after plan totals. It
 * runs on top of `describe()` plus the walls and opening hosts of the same resolve
 * (`describeWithAutoIds`'s `fabric`), so it inherits the same purity, determinism and
 * never-throw contract. Every loop is one pass per element list with map lookups.
 *
 * Pure, synchronous, deterministic. It never throws on bad input: a side that fails
 * to resolve yields `{ ok: false, …empty… }`.
 *
 * Task 4 layers circulation deltas and human-readable summary sentences on top of the
 * {@link PlanDiff} returned here; those fields (`circulation`, `summary`) are present
 * but stay empty in this task. **The exported type shapes are frozen API** — ArchCanvas
 * consumes `PlanDiff` verbatim.
 */

import {
  describeWithAutoIds,
  type DescribeOptions,
  type DiffHostFact,
  type DiffWallFact,
  type RoomSummary,
  type SceneSummary,
} from "./describe.js";
import type { Diagnostic } from "./diagnostics.js";

type Pt = { x: number; y: number };

/** A room's area may drift by this much (m²) before it counts as resized. */
const AREA_EPS_M2 = 0.05;
/** A bbox edge may drift by this much (mm) before it counts as resized. */
const EDGE_EPS_MM = 10;
/** A walk may drift by this much (mm) before it counts as a circulation change. */
const WALK_EPS_MM = 250;
/** A clear width (a pinch, or a blocked room's widest way in) may drift by this much (mm). */
const PINCH_EPS_MM = 50;

export interface RoomChange {
  id: string;
  label?: string;
  /** `moved`: the same shape at another position (appended; it used to read "resized"). */
  change: "added" | "removed" | "resized" | "relabeled" | "moved";
  areaBeforeM2?: number;
  areaAfterM2?: number;
  /** Signed mm delta of each bbox edge in plan coordinates (after − before); "resized" only. */
  edges?: { top: number; bottom: number; left: number; right: number };
  /** "moved" only: the translation (mm, after − before, +y down) that carries the room's shape
   *  onto its new one, read off the shape's own vertices (or a circle's centre). */
  offset?: { dx: number; dy: number };
}
export interface OpeningChange {
  id: string;
  kind: "door" | "window" | "opening";
  /** `rehosted` (appended): same width, but its host or the spaces it joins changed. */
  change: "added" | "removed" | "resized" | "rehosted";
  widthBeforeMm?: number;
  widthAfterMm?: number;
  /** The spaces it joins (a window: the room it serves), on the side the change reports. */
  between?: string[];
  /** Present on a "rehosted" entry, and on a "resized" one whose host changed too: the wall
   *  it stood in before and after, named as a person would (`wall "p"`, `the partition between
   *  "a" and "b"`, `the exterior wall derived from the rooms`; `no wall`), and its relational
   *  placement as written (`between a and b`, `on r.top`) when it has one. */
  hostBefore?: string;
  hostAfter?: string;
  relationBefore?: string;
  relationAfter?: string;
  /** Present when the spaces it joins changed: {@link between} before the edit. */
  betweenBefore?: string[];
}
/**
 * One wall's change (appended section). Authored walls carry their `id`; a wall `walls from
 * rooms` derived has none an author can type, so it is named by its relation (`name`).
 */
export interface WallChange {
  /** How a person names it: `wall "<id>"`, `the partition between "a" and "b"`, … */
  name: string;
  /** The authored id; absent on a derived wall. */
  id?: string;
  /** True on a wall `walls from rooms` derived. */
  derived?: true;
  category: string;
  /** `rethickened`: same line, new thickness. A moved or resized wall whose thickness also
   *  changed carries both thickness fields under its geometric change. */
  change: "added" | "removed" | "moved" | "resized" | "rethickened";
  /** "moved" only: the translation (mm, +y down) carrying its centreline onto the new one. */
  offset?: { dx: number; dy: number };
  /** Centreline length (mm; a closed wall's perimeter, an arc measured on the arc). */
  lengthBeforeMm?: number;
  lengthAfterMm?: number;
  thicknessBeforeMm?: number;
  thicknessAfterMm?: number;
  /** A wall placed by relation that moved or resized because these rooms (after-side ids)
   *  moved or resized: it followed them. */
  follows?: string[];
}
export interface FurnitureChange {
  id: string;
  category: string;
  change: "added" | "removed";
}
export interface CirculationChange {
  roomId: string;
  walkDistanceBeforeMm: number;
  walkDistanceAfterMm: number;
  bottleneckBeforeMm: number;
  bottleneckAfterMm: number;
}
export interface PlanDiff {
  ok: boolean;
  diagnostics: Diagnostic[];
  rooms: RoomChange[];
  openings: OpeningChange[];
  furniture: FurnitureChange[];
  totals: { floorAreaBeforeM2: number; floorAreaAfterM2: number; roomsBefore: number; roomsAfter: number };
  circulation: CirculationChange[]; // populated in Task 4
  summary: string[]; // populated in Task 4
  /** Walls added, removed, moved, resized or re-thickened (appended; authored and derived). */
  walls: WallChange[];
}

/** Adapt here (only here) if BBox is min/max-shaped — see plan Task 3 Step 2.
 *  The real `BBox` (src/geometry/rect.ts) is `{ x, y, w, h }` in mm, so this is a
 *  straight edge derivation. */
function edgesOf(b: RoomSummary["bbox"]): { top: number; bottom: number; left: number; right: number } {
  return { top: b.y, bottom: b.y + b.h, left: b.x, right: b.x + b.w };
}

/** The labels that name exactly one room of `rooms` — ALL of them, authored ids included.
 *  An empty label is "no label" (see the rescue below) and never counts. */
function uniqueLabels(rooms: RoomSummary[]): Set<string> {
  const count = new Map<string, number>();
  for (const r of rooms) if (r.label) count.set(r.label, (count.get(r.label) ?? 0) + 1);
  return new Set([...count].filter(([, n]) => n === 1).map(([l]) => l));
}

function matchRooms(
  before: RoomSummary[],
  after: RoomSummary[],
  autoBefore: ReadonlySet<string>,
  autoAfter: ReadonlySet<string>,
): Array<[RoomSummary | null, RoomSummary | null]> {
  const pairs: Array<[RoomSummary | null, RoomSummary | null]> = [];
  const unmatchedAfter = new Map(after.map((r) => [r.id, r]));
  // Pass 0 — an id AUTHORED on both sides is the author's own stable key: it pairs first,
  // whatever the labels say (relabelling `id=room_3` from "Bedroom" to "Study" while adding
  // a new "Bedroom" is a relabel plus an add, not a swap). Authored-on-both is a property of
  // the pair, read identically from either side.
  const authoredAfter = new Map<string, RoomSummary>();
  for (const b of after) if (!autoAfter.has(b.id)) authoredAfter.set(b.id, b);
  const partner = new Map<RoomSummary, RoomSummary>();
  const claimed = new Set<RoomSummary>();
  for (const a of before) {
    const b = autoBefore.has(a.id) ? undefined : authoredAfter.get(a.id);
    if (!b) continue;
    partner.set(a, b);
    claimed.add(b);
  }
  // Pass 1 — every other id may be a false key. An auto-id is POSITIONAL (`room_<n>` numbers
  // rooms in source order), so it shifts the moment a room is inserted or removed ahead of
  // it; and an id authored on ONE side only says nothing about which room it was before
  // (adding `id=hall` to "Hall" while inserting "Kitchen" ahead of it gave the old room_1
  // to Kitchen). So a room left by pass 0 whose non-empty label names exactly one room among
  // ALL rooms on EACH side pairs by that label before any id is consulted — auto or authored.
  // Both conditions read both sides identically, so swapping "before" and "after" yields the
  // same pairs — the antisymmetry law's precondition.
  const uniqBefore = uniqueLabels(before);
  const uniqAfter = uniqueLabels(after);
  const byLabelAfter = new Map<string, RoomSummary>();
  for (const b of after) if (b.label && uniqAfter.has(b.label) && !claimed.has(b)) byLabelAfter.set(b.label, b);
  for (const a of before) {
    if (partner.has(a) || !a.label || !uniqBefore.has(a.label)) continue;
    const b = byLabelAfter.get(a.label);
    if (!b) continue;
    partner.set(a, b);
    claimed.add(b);
  }
  // Both passes claim up front (so no id match below can take an after-room a pair needs),
  // but pairs are EMITTED in the id loop below, in `before` order — a plan whose pairing
  // these passes do not change keeps the change order it had.
  for (const b of claimed) unmatchedAfter.delete(b.id);
  const leftoverBefore: RoomSummary[] = [];
  for (const a of before) {
    const p = partner.get(a);
    if (p) {
      pairs.push([a, p]);
      continue;
    }
    const hit = unmatchedAfter.get(a.id);
    if (hit) {
      pairs.push([a, hit]);
      unmatchedAfter.delete(a.id);
    } else leftoverBefore.push(a);
  }
  // Fallback: positional auto-ids can shift; rescue pairs whose label matches uniquely —
  // on BOTH sides. Checking only the after side made this order-dependent (and so not
  // antisymmetric: `diffPlans(A, B)` could rescue a pair that `diffPlans(B, A)` could
  // not, purely because `leftoverBefore`'s OTHER entries differ by direction). Two
  // same-labelled rooms on either side are an equally real ambiguity — the label alone
  // does not say which pairs with which — so neither side rescues, and every one of them
  // reports as a separate add/remove instead of a guessed match.
  for (const a of leftoverBefore) {
    // `a.label` (not `!== undefined`): an EMPTY label is "no label" everywhere else in
    // this file (the relabel check below reads both sides through `?? ""`), so it must
    // not become a rescue key here either — that would be a second, inconsistent
    // definition of "no label" for the one type this module treats as frozen API.
    const uniqueBefore = !!a.label && leftoverBefore.filter((r) => r.label === a.label).length === 1;
    const byLabel = uniqueBefore ? [...unmatchedAfter.values()].filter((r) => r.label === a.label) : [];
    if (byLabel.length === 1) {
      const b = byLabel[0]!;
      pairs.push([a, b]);
      unmatchedAfter.delete(b.id);
    } else pairs.push([a, null]);
  }
  for (const b of unmatchedAfter.values()) pairs.push([null, b]);
  return pairs;
}

/** One room's circulation verdict, named by the `describe().circulation` key it comes from:
 *  measured (`rooms[]`), blocked by furniture (`blocked[]`) or not measured, with the
 *  model's own reason code (`unmeasured[]`) — or, when that side's `circulation` is null
 *  (no modeled entrance), no model at all. */
type CirculationState =
  | { kind: "measured"; walkMm: number; pinchMm: number }
  | { kind: "blocked"; wayInMm: number }
  | { kind: "unmeasured"; reason: string }
  | { kind: "none" };

const NO_MODEL: CirculationState = { kind: "none" };

/** Every room's verdict on one side; `null` when that side has no circulation model, so
 *  each room reads {@link NO_MODEL}. */
function circulationStates(c: SceneSummary["circulation"]): Map<string, CirculationState> | null {
  if (!c) return null;
  const out = new Map<string, CirculationState>();
  for (const r of c.rooms)
    out.set(r.roomId, { kind: "measured", walkMm: r.walkDistanceMm, pinchMm: r.bottleneckClearWidthMm });
  for (const r of c.blocked ?? []) out.set(r.roomId, { kind: "blocked", wayInMm: r.widestWayInMm });
  for (const r of c.unmeasured ?? []) out.set(r.roomId, { kind: "unmeasured", reason: r.reason });
  return out;
}

/** Same verdict: both measured (their numbers are `CirculationChange`'s business), both
 *  blocked with the widest way in within the pinch noise floor, both unmeasured for the
 *  same reason, or both without a model. */
function sameVerdict(a: CirculationState, b: CirculationState): boolean {
  if (a.kind === "unmeasured" && b.kind === "unmeasured") return a.reason === b.reason;
  if (a.kind === "blocked" && b.kind === "blocked") return Math.abs(b.wayInMm - a.wayInMm) <= PINCH_EPS_MM;
  return a.kind === b.kind;
}

function statePhrase(s: CirculationState, mm: (v: number) => string): string {
  if (s.kind === "measured") return `${mm(s.walkMm)} (pinch ${mm(s.pinchMm)})`;
  if (s.kind === "blocked") return `blocked (widest way in ${mm(s.wayInMm)})`;
  if (s.kind === "unmeasured") return `unmeasured (${s.reason})`;
  return "no circulation model";
}

/** The translation that carries `a`'s points onto `b`'s, vertex for vertex within the edge
 *  noise floor, or null when no single one does (another shape, or another vertex count).
 *  Read off the vertices themselves, never a bounding box or a centroid. */
function translationOf(a: readonly Pt[], b: readonly Pt[]): { dx: number; dy: number } | null {
  if (a.length === 0 || a.length !== b.length) return null;
  const dx = b[0]!.x - a[0]!.x;
  const dy = b[0]!.y - a[0]!.y;
  for (let i = 1; i < a.length; i++)
    if (Math.abs(b[i]!.x - a[i]!.x - dx) > EDGE_EPS_MM || Math.abs(b[i]!.y - a[i]!.y - dy) > EDGE_EPS_MM) return null;
  return { dx, dy };
}

/** A room's move: the same shape (and area) translated, from its floor ring or circle. */
function roomOffset(a: RoomSummary, b: RoomSummary): { dx: number; dy: number } | null {
  if (Math.abs(b.area_m2 - a.area_m2) > AREA_EPS_M2) return null;
  if (a.floor_circle || b.floor_circle) {
    const ca = a.floor_circle;
    const cb = b.floor_circle;
    if (!ca || !cb || Math.abs(cb.r - ca.r) > EDGE_EPS_MM) return null;
    return { dx: cb.cx - ca.cx, dy: cb.cy - ca.cy };
  }
  return ringTranslationOf(a.floor_polygon, b.floor_polygon);
}

/** Index of the lexicographically smallest vertex (x, then y): a start every rewriting of the
 *  same ring agrees on, since a translation keeps the order of its vertices. */
function lowestVertex(r: readonly Pt[]): number {
  let k = 0;
  for (let i = 1; i < r.length; i++) {
    const p = r[i]!;
    const q = r[k]!;
    if (p.x < q.x || (p.x === q.x && p.y < q.y)) k = i;
  }
  return k;
}

/** `r` read from vertex `k`, forwards, or backwards (the other winding). */
function startAt(r: readonly Pt[], k: number, reverse: boolean): Pt[] {
  const n = r.length;
  const out: Pt[] = [];
  for (let i = 0; i < n; i++) out.push(r[(k + (reverse ? n - i : i)) % n]!);
  return out;
}

/** {@link translationOf} for a closed ring, also when it is written from another vertex or in
 *  the other direction: tried as written (both windings), then with both rings read from their
 *  lowest vertex (both windings). The offset is vertex 0's (of the order that matched). Still
 *  the shape's own vertices, never a bbox or a centroid. Linear in the vertex count. */
function ringTranslationOf(a: readonly Pt[], b: readonly Pt[]): { dx: number; dy: number } | null {
  if (a.length === 0 || a.length !== b.length) return null;
  // As written first (both windings): a lowest vertex chosen within the 10 mm noise floor can
  // flip between two near-tied vertices, so the canonical start is only the fallback.
  const written = translationOf(a, b) ?? translationOf(a, startAt(b, 0, true));
  if (written) return written;
  const ca = startAt(a, lowestVertex(a), false);
  const kb = lowestVertex(b);
  return translationOf(ca, startAt(b, kb, false)) ?? translationOf(ca, startAt(b, kb, true));
}

/** A wall's move: same closure, same arcs, same points translated. */
function wallOffset(a: DiffWallFact, b: DiffWallFact): { dx: number; dy: number } | null {
  if (a.closed !== b.closed || a.arcs.length !== b.arcs.length) return null;
  for (let i = 0; i < a.arcs.length; i++) {
    const p = a.arcs[i];
    const q = b.arcs[i];
    if (!p !== !q) return null;
    if (p && q && (Math.abs(p.r - q.r) > EDGE_EPS_MM || Math.abs(p.sweep - q.sweep) > 1e-9)) return null;
  }
  return translationOf(a.points, b.points);
}

/** Centreline length: each straight segment's chord, each arc measured on the arc. */
function wallLength(w: DiffWallFact): number {
  const n = w.points.length;
  const last = w.closed ? n : n - 1;
  let len = 0;
  for (let k = 0; k < last; k++) {
    const arc = w.arcs[k];
    if (arc) len += Math.abs(arc.sweep) * arc.r;
    else {
      const p = w.points[k]!;
      const q = w.points[(k + 1) % n]!;
      len += Math.hypot(q.x - p.x, q.y - p.y);
    }
  }
  return Math.round(len);
}

const isMove = (o: { dx: number; dy: number }) => Math.abs(o.dx) > EDGE_EPS_MM || Math.abs(o.dy) > EDGE_EPS_MM;

/** `500 mm right, 200 mm down` (plan +y runs down the page). */
function offsetPhrase(o: { dx: number; dy: number }): string {
  const parts: string[] = [];
  if (Math.abs(o.dx) > EDGE_EPS_MM) parts.push(`${Math.round(Math.abs(o.dx))} mm ${o.dx > 0 ? "right" : "left"}`);
  if (Math.abs(o.dy) > EDGE_EPS_MM) parts.push(`${Math.round(Math.abs(o.dy))} mm ${o.dy > 0 ? "down" : "up"}`);
  return parts.join(", ");
}

const capitalise = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** `a and b`, `exterior and a`, or `nothing`: the spaces as `describe()` names them. */
const spacesPhrase = (s: readonly string[]) => (s.length === 0 ? "nothing" : s.join(" and "));

/** `A`, `A and B`, `A, B and C`. */
const listPhrase = (s: readonly string[]) =>
  s.length <= 2 ? s.join(" and ") : `${s.slice(0, -1).join(", ")} and ${s[s.length - 1]}`;

/**
 * The wall section. Walls pair by their resolved id (a derived wall's internal name is
 * stable while its rooms keep their ids); one map lookup per wall, so linear in the wall
 * count. A wall placed by relation that moved or resized while one of its rooms did is
 * listed as FOLLOWING those rooms: `changedRooms` holds every room that moved, resized,
 * appeared or vanished, and a derived ring (which follows the whole room union) lists all of
 * them — at most rings × rooms entries, rings being a handful.
 */
function diffWalls(
  before: readonly DiffWallFact[],
  after: readonly DiffWallFact[],
  changedRooms: ReadonlyMap<string, string>,
  geometricRooms: ReadonlySet<string>,
): WallChange[] {
  const out: WallChange[] = [];
  const afterByKey = new Map(after.map((w) => [w.key, w]));
  const head = (w: DiffWallFact): Pick<WallChange, "name" | "id" | "derived" | "category"> => ({
    name: w.name,
    ...(w.id !== undefined ? { id: w.id } : { derived: true as const }),
    category: w.category,
  });
  const followsOf = (w: DiffWallFact): string[] | undefined => {
    if (w.follows === undefined) return undefined;
    const ids = w.follows === "rooms" ? [...changedRooms.keys()] : w.follows.filter((id) => geometricRooms.has(id));
    return ids.length > 0 ? ids : undefined;
  };
  for (const a of before) {
    const b = afterByKey.get(a.key);
    if (!b) {
      out.push({ ...head(a), change: "removed", lengthBeforeMm: wallLength(a), thicknessBeforeMm: a.thickness });
      continue;
    }
    afterByKey.delete(a.key);
    const thick =
      a.thickness !== b.thickness ? { thicknessBeforeMm: a.thickness, thicknessAfterMm: b.thickness } : undefined;
    const off = wallOffset(a, b);
    const follows = followsOf(b);
    const tail = { ...(thick ?? {}), ...(follows ? { follows } : {}) };
    if (off && !isMove(off)) {
      if (thick) out.push({ ...head(b), change: "rethickened", ...thick });
    } else if (off) out.push({ ...head(b), change: "moved", offset: off, ...tail });
    else
      out.push({ ...head(b), change: "resized", lengthBeforeMm: wallLength(a), lengthAfterMm: wallLength(b), ...tail });
  }
  for (const b of afterByKey.values())
    out.push({ ...head(b), change: "added", lengthAfterMm: wallLength(b), thicknessAfterMm: b.thickness });
  return out;
}

/** The spaces an opening joins: a door's or cased opening's `between`, a window's room. */
const spacesOf = (o: OpeningLike): string[] => o.between ?? (o.room ? [o.room] : []);
const sameSpaces = (a: readonly string[], b: readonly string[]) =>
  a.length === b.length && JSON.stringify([...a].sort()) === JSON.stringify([...b].sort());

/** Structural superset of {@link import("./describe.js").DoorSummary},
 *  `WindowSummary` and `OpeningSummary` — enough to diff any of the three by id. */
interface OpeningLike {
  id: string;
  width: number;
  between?: string[];
  room?: string | null;
}

/** Both sides' opening hosts, and how each side names a wall key. */
interface HostSides {
  before: ReadonlyMap<string, DiffHostFact>;
  after: ReadonlyMap<string, DiffHostFact>;
  wallName: { before: (key: string | null) => string; after: (key: string | null) => string };
  /** A before-side room id as the after side names the room it paired with (itself when unpaired). */
  roomAfter: (id: string) => string;
}

function diffOpenings(
  kind: "door" | "window" | "opening",
  before: OpeningLike[],
  after: OpeningLike[],
  hosts: HostSides,
): OpeningChange[] {
  const out: OpeningChange[] = [];
  const afterById = new Map(after.map((o) => [o.id, o]));
  for (const a of before) {
    const b = afterById.get(a.id);
    if (!b) {
      out.push({ id: a.id, kind, change: "removed", widthBeforeMm: a.width, between: a.between });
      continue;
    }
    afterById.delete(a.id);
    // The host: the wall it stands in (paired by key, like the wall section) and the host
    // part of a relational placement as written; and the spaces it joins.
    const ha = hosts.before.get(a.id);
    const hb = hosts.after.get(b.id);
    const wallA = ha?.wall ?? null;
    const wallB = hb?.wall ?? null;
    const hostMoved = wallA !== wallB || ha?.relation !== hb?.relation;
    const sa = spacesOf(a);
    const sb = spacesOf(b);
    // Compared through the room pairing: under a shifted auto-id the same id names another
    // room, so a before-side room id is read as its after-side partner's.
    const spacesMoved = !sameSpaces(
      sa.map((id) => hosts.roomAfter(id)),
      sb,
    );
    const extra: Partial<OpeningChange> = {
      ...(hostMoved
        ? {
            hostBefore: hosts.wallName.before(wallA),
            hostAfter: hosts.wallName.after(wallB),
            ...(ha?.relation !== undefined ? { relationBefore: ha.relation } : {}),
            ...(hb?.relation !== undefined ? { relationAfter: hb.relation } : {}),
          }
        : {}),
      ...(spacesMoved ? { betweenBefore: sa } : {}),
    };
    if (a.width !== b.width)
      out.push({
        id: a.id,
        kind,
        change: "resized",
        widthBeforeMm: a.width,
        widthAfterMm: b.width,
        between: b.between,
        ...extra,
      });
    else if (hostMoved || spacesMoved)
      out.push({
        id: a.id,
        kind,
        change: "rehosted",
        widthBeforeMm: a.width,
        widthAfterMm: b.width,
        between: sb,
        ...extra,
      });
  }
  for (const b of afterById.values())
    out.push({ id: b.id, kind, change: "added", widthAfterMm: b.width, between: b.between });
  return out;
}

/**
 * Diff two ArchLang sources into a {@link PlanDiff}. Never throws: if either side
 * fails to resolve, returns `{ ok: false, …empty arrays… }` with the collected
 * error diagnostics.
 *
 * @example
 * const d = diffPlans(oldSrc, newSrc);
 * if (d.ok) for (const r of d.rooms) console.log(r.id, r.change);
 */
export function diffPlans(sourceA: string, sourceB: string, opts: DescribeOptions = {}): PlanDiff {
  return diffSides(sourceA, sourceB, opts, opts);
}

/**
 * @internal {@link diffPlans} with each side read under its own options: `arch impact --against`
 * resolves each file's `import`s against its own directory. Not public API.
 */
export function diffSides(sourceA: string, sourceB: string, optsA: DescribeOptions, optsB: DescribeOptions): PlanDiff {
  const { summary: before, autoRoomIds: autoBefore, fabric: fabricBefore } = describeWithAutoIds(sourceA, optsA);
  const { summary: after, autoRoomIds: autoAfter, fabric: fabricAfter } = describeWithAutoIds(sourceB, optsB);
  const base: PlanDiff = {
    ok: before.ok && after.ok,
    diagnostics: [...before.diagnostics, ...after.diagnostics].filter((d) => d.severity === "error"),
    rooms: [],
    openings: [],
    furniture: [],
    totals: {
      floorAreaBeforeM2: before.totals?.floor_area_m2 ?? 0,
      floorAreaAfterM2: after.totals?.floor_area_m2 ?? 0,
      roomsBefore: before.totals?.rooms ?? 0,
      roomsAfter: after.totals?.rooms ?? 0,
    },
    circulation: [],
    summary: [],
    walls: [],
  };
  if (!base.ok) return base;

  const pairs = matchRooms(before.rooms, after.rooms, autoBefore, autoAfter);
  for (const [a, b] of pairs) {
    if (a && !b) base.rooms.push({ id: a.id, label: a.label, change: "removed", areaBeforeM2: a.area_m2 });
    else if (!a && b) base.rooms.push({ id: b.id, label: b.label, change: "added", areaAfterM2: b.area_m2 });
    else if (a && b) {
      const ea = edgesOf(a.bbox);
      const eb = edgesOf(b.bbox);
      const edges = {
        top: eb.top - ea.top,
        bottom: eb.bottom - ea.bottom,
        left: eb.left - ea.left,
        right: eb.right - ea.right,
      };
      const geometryChanged =
        Math.abs(b.area_m2 - a.area_m2) > AREA_EPS_M2 || Object.values(edges).some((v) => Math.abs(v) > EDGE_EPS_MM);
      // A pure move — the same shape translated — is a move, not a "+0.0 m²" resize. The
      // offset comes from the floor ring's (or circle's) own vertices, never the bbox.
      const offset = geometryChanged ? roomOffset(a, b) : null;
      if (offset && isMove(offset)) base.rooms.push({ id: b.id, label: b.label, change: "moved", offset });
      else if (geometryChanged)
        base.rooms.push({
          id: b.id,
          label: b.label,
          change: "resized",
          areaBeforeM2: a.area_m2,
          areaAfterM2: b.area_m2,
          edges,
        });
      else if ((a.label ?? "") !== (b.label ?? "")) base.rooms.push({ id: b.id, label: b.label, change: "relabeled" });
    }
  }

  const wallsByKey = (ws: readonly DiffWallFact[]) => new Map(ws.map((w) => [w.key, w.name]));
  const namesBefore = wallsByKey(fabricBefore.walls);
  const namesAfter = wallsByKey(fabricAfter.walls);
  const pairedAfter = new Map<string, string>();
  // A before room with no partner maps to a name no after-side room can carry, so a door
  // into a removed room never reads as joining an added one that reused its id.
  for (const [a, b] of pairs) if (a) pairedAfter.set(a.id, b ? b.id : `${a.id} (removed)`);
  const hosts: HostSides = {
    roomAfter: (id) => pairedAfter.get(id) ?? id,
    before: fabricBefore.hosts,
    after: fabricAfter.hosts,
    wallName: {
      before: (k) => (k === null ? "no wall" : (namesBefore.get(k) ?? `wall "${k}"`)),
      after: (k) => (k === null ? "no wall" : (namesAfter.get(k) ?? `wall "${k}"`)),
    },
  };
  base.openings = [
    ...diffOpenings("door", before.doors, after.doors, hosts),
    ...diffOpenings("window", before.windows, after.windows, hosts),
    ...diffOpenings("opening", before.openings, after.openings, hosts),
  ];

  // Rooms whose geometry changed, by after-side id (a removed room by its before id), with
  // the name a sentence gives them; the wall section lists a relational wall as following them.
  const changedRooms = new Map<string, string>();
  const geometricRooms = new Set<string>();
  for (const r of base.rooms) {
    if (r.change === "relabeled") continue;
    changedRooms.set(r.id, r.label ?? r.id);
    if (r.change === "moved" || r.change === "resized") geometricRooms.add(r.id);
  }
  base.walls = diffWalls(fabricBefore.walls, fabricAfter.walls, changedRooms, geometricRooms);

  const afterFurn = new Map(after.furniture.map((f) => [f.id, f]));
  for (const f of before.furniture) {
    if (!afterFurn.delete(f.id)) base.furniture.push({ id: f.id, category: f.category, change: "removed" });
  }
  for (const f of afterFurn.values()) base.furniture.push({ id: f.id, category: f.category, change: "added" });

  const name = (id: string, label?: string) => label ?? id;
  const mm = (v: number) => `${Math.round(v)} mm`;
  const m2 = (v: number) => `${v.toFixed(1)} m²`;

  // A room's circulation is compared against its MATCHED room (the pairing above), not
  // whatever room holds the same id on the other side: under a shifted auto-id the same id
  // names a different room, and comparing by id reported one room's walk against another's.
  const partnerOf = new Map<string, RoomSummary>();
  for (const [a, b] of pairs) if (a && b) partnerOf.set(a.id, b);
  const stateSentences: string[] = [];

  if (before.circulation && after.circulation) {
    const afterByRoom = new Map(after.circulation.rooms.map((r) => [r.roomId, r]));
    for (const a of before.circulation.rooms) {
      const partner = partnerOf.get(a.roomId);
      const b = partner ? afterByRoom.get(partner.id) : undefined;
      // Not measured on the after side: a state change (blocked/unmeasured), reported below.
      if (!partner || !b) continue;
      if (
        Math.abs(b.walkDistanceMm - a.walkDistanceMm) > WALK_EPS_MM ||
        Math.abs(b.bottleneckClearWidthMm - a.bottleneckClearWidthMm) > PINCH_EPS_MM
      ) {
        base.circulation.push({
          roomId: partner.id,
          walkDistanceBeforeMm: a.walkDistanceMm,
          walkDistanceAfterMm: b.walkDistanceMm,
          bottleneckBeforeMm: a.bottleneckClearWidthMm,
          bottleneckAfterMm: b.bottleneckClearWidthMm,
        });
      }
    }
  }

  // A matched room whose verdict differs — measured on one side and blocked/unmeasured on
  // the other, unmeasured for a different reason, blocked on both with a different widest
  // way in, or with no circulation model at all on one side (an entrance added or removed)
  // — has no `CirculationChange`: that shape is frozen API and carries two walks, which such
  // a room does not have. It used to vanish from the diff entirely; it is reported here as a
  // sentence built from each side's own verdict (`rooms[]`, `blocked[]` or `unmeasured[]`,
  // which are total over the plan's rooms whenever `circulation` is non-null).
  const beforeState = circulationStates(before.circulation);
  const afterState = circulationStates(after.circulation);
  if (beforeState || afterState) {
    for (const [a, b] of pairs) {
      if (!a || !b) continue;
      const sa = beforeState ? beforeState.get(a.id) : NO_MODEL;
      const sb = afterState ? afterState.get(b.id) : NO_MODEL;
      if (!sa || !sb || sameVerdict(sa, sb)) continue;
      stateSentences.push(`Walk to ${b.id}: ${statePhrase(sa, mm)} → ${statePhrase(sb, mm)}`);
    }
  }

  for (const r of base.rooms) {
    if (r.change === "added") base.summary.push(`Added ${name(r.id, r.label)} (${m2(r.areaAfterM2!)})`);
    else if (r.change === "removed") base.summary.push(`Removed ${name(r.id, r.label)} (${m2(r.areaBeforeM2!)})`);
    else if (r.change === "relabeled") base.summary.push(`Relabeled ${r.id} to "${r.label ?? ""}"`);
    else if (r.change === "moved") base.summary.push(`Moved ${name(r.id, r.label)} ${offsetPhrase(r.offset!)}`);
    else {
      const delta = r.areaAfterM2! - r.areaBeforeM2!;
      const edge = Object.entries(r.edges!).reduce((m, e) => (Math.abs(e[1]) > Math.abs(m[1]) ? e : m));
      const edgeNote =
        Math.abs(edge[1]) > EDGE_EPS_MM ? `; ${edge[0]} edge ${edge[1] > 0 ? "+" : ""}${mm(edge[1])}` : "";
      base.summary.push(`${name(r.id, r.label)} ${delta >= 0 ? "+" : ""}${m2(delta)}${edgeNote}`);
    }
  }
  for (const o of base.openings) {
    // Named as written: a derived `open between` opening by its clause, never its internal id
    // (`A|B:open`); every other opening by kind and id, as these sentences always did.
    const side = o.change === "removed" ? fabricBefore : fabricAfter;
    const who = side.hosts.get(o.id)?.name ?? `${o.kind} ${o.id}`;
    if (o.change === "added") base.summary.push(`Added ${who} (${mm(o.widthAfterMm!)})`);
    else if (o.change === "removed") base.summary.push(`Removed ${who}`);
    else {
      if (o.change === "resized") base.summary.push(`${who} width ${mm(o.widthBeforeMm!)} → ${mm(o.widthAfterMm!)}`);
      // Appended after the entry's own width line: its host and the spaces it joins.
      if (o.hostBefore !== undefined) {
        const was = o.relationBefore ?? o.hostBefore;
        const now = o.relationAfter ?? o.hostAfter!;
        const host = was !== now ? `${was} → ${now}` : `${o.hostBefore} → ${o.hostAfter}`;
        base.summary.push(`${who} re-hosted: ${host}`);
      }
      if (o.betweenBefore !== undefined)
        base.summary.push(`${who} joins ${spacesPhrase(o.betweenBefore)} → ${spacesPhrase(o.between ?? [])}`);
    }
  }
  for (const f of base.furniture)
    base.summary.push(`${f.change === "added" ? "Added" : "Removed"} ${f.category} ${f.id}`);
  // The wall section's sentences, appended after every existing block and before the
  // trailing "Walk to" block. A wall that followed a room says so, naming the room as the
  // room sentence above does.
  for (const w of base.walls) {
    const following = w.follows ? `, following ${listPhrase(w.follows.map((id) => changedRooms.get(id) ?? id))}` : "";
    const thick =
      w.thicknessBeforeMm !== undefined && w.thicknessAfterMm !== undefined
        ? `; thickness ${mm(w.thicknessBeforeMm)} → ${mm(w.thicknessAfterMm)}`
        : "";
    if (w.change === "added")
      base.summary.push(
        `Added ${w.name} (${w.category}, ${mm(w.lengthAfterMm!)} long, ${mm(w.thicknessAfterMm!)} thick)`,
      );
    else if (w.change === "removed") base.summary.push(`Removed ${w.name}`);
    else if (w.change === "moved") base.summary.push(`Moved ${w.name} ${offsetPhrase(w.offset!)}${following}${thick}`);
    else if (w.change === "resized")
      base.summary.push(
        `${capitalise(w.name)} ${mm(w.lengthBeforeMm!)} → ${mm(w.lengthAfterMm!)} long${following}${thick}`,
      );
    else base.summary.push(`${capitalise(w.name)} thickness ${mm(w.thicknessBeforeMm!)} → ${mm(w.thicknessAfterMm!)}`);
  }
  for (const c of base.circulation) {
    base.summary.push(
      `Walk to ${c.roomId}: ${mm(c.walkDistanceBeforeMm)} → ${mm(c.walkDistanceAfterMm)} (pinch ${mm(c.bottleneckBeforeMm)} → ${mm(c.bottleneckAfterMm)})`,
    );
  }
  // After the measured deltas, still inside the trailing "Walk to" block.
  base.summary.push(...stateSentences);

  return base;
}
