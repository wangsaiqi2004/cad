/**
 * The shape of `taste()`'s report (ADR 0032; design §2.2). Key order is part of the contract:
 * the report is built in the order these interfaces list their fields, and pinned by
 * `test/taste-digests.test.ts`.
 */

import type { LintUnclassifiedRoom } from "../lint/coverage.js";

/** The six subscores, in report order. `facade` has no criterion yet and is always `null`. */
export const TASTE_SUBSCORES = ["circulation", "zoning", "light", "geometry", "furnishing", "facade"] as const;
export type TasteSubscore = (typeof TASTE_SUBSCORES)[number];

/**
 * Why a criterion (or one storey of it) was not judged. The lint words are reused
 * (`LintSkipReason`); the rest are taste's own: `too-few-items` (nothing to measure, or fewer
 * items than the criterion needs), `too-small` (a room whose floor area rounds to 0 m², filed
 * with the room), `upper-storey` (an upper storey's depths are unreliable until PS0.3),
 * `taste-budget` (the call's counted budget would be exceeded), `curved-room` (a circular room
 * R18 cannot read as a rectangle), `door-off-ring` (R16: a door whose centre is on no edge of
 * the side room's floor ring). From lint: `non-dwelling` (R6, R11 and R12, PS2.18's reading) and
 * `non-rectangular-room` (R16).
 */
export type TasteSkipReason =
  | "no-entrance"
  | "too-few-items"
  | "too-small"
  | "upper-storey"
  | "taste-budget"
  | "non-dwelling"
  | "non-rectangular-room"
  | "curved-room"
  | "door-off-ring";

/** How a criterion's source was checked: read in the source [V], second-hand [S], remembered [M]. */
export type TasteVerified = "V" | "S" | "M";

/** One piece of evidence: the ids it is about (data, never in a message) and the measured fact. */
export interface TasteEvidence {
  ids: string[];
  fact: string;
  /** The storey, on a multi-storey plan. */
  level?: number;
}

/** One criterion's result. A criterion that cannot judge says so and is excluded, never passed. */
export interface TasteCriterion {
  id: string;
  name: string;
  subscore: TasteSubscore;
  kind: "taste";
  weight: number;
  assessable: boolean;
  /** Why it is not assessable; present only when `assessable` is false. */
  reason?: TasteSkipReason;
  /** The measured value as a rational of integers, or `null` when not assessable. */
  measured: { num: number; den: number } | null;
  /** The criterion's score in [0, 1] (a permyriad printed exactly), or `null`. */
  score: number | null;
  source: string;
  verified: TasteVerified;
  /** The `A_*` advice code when the score is below 1, else `null` (`src/taste/advice.ts`). */
  advice: string | null;
  /** One sentence that names rooms by label and never quotes an id. */
  message: string;
  /** At most {@link MAX_EVIDENCE} entries, in source order. */
  evidence: TasteEvidence[];
  /** How many evidence entries were left out past {@link MAX_EVIDENCE}. */
  evidence_more?: number;
}

/** A criterion's evidence list is cut here so the report's size is bounded. */
export const MAX_EVIDENCE = 8;

/** One skipped criterion (or one skipped storey of it). */
export interface TasteSkip {
  criterion: string;
  reason: TasteSkipReason;
  /** The room's id, for a skip about one room (data, like `coverage.unclassified[].id`). */
  room?: string;
  level?: number;
}

/** A profile-only lint warning (PS5.2). Always empty under `generic`. */
export interface TasteAdvisory {
  code: string;
  warnings: number;
}

export interface TasteReport {
  profile: string;
  /** False only when the plan does not resolve (it has compile errors): then nothing is scored. */
  ok: boolean;
  /** The total in [0, 1], capped at 0.5 while validity fails; `null` when nothing is assessable. */
  score: number | null;
  /** The total before the cap. */
  uncapped: number | null;
  /** True when validity fails and a score exists (the cap applies, whether or not it bit). */
  capped: boolean;
  validity: {
    /** No validity-layer warning from default-ruleset `lint()`. */
    pass: boolean;
    /** Validity-layer warnings: these cap. */
    warnings: number;
    codes: string[];
    /** Drafting-layer warnings (the annotation family): listed, never capping. */
    drafting: { warnings: number; codes: string[] };
  };
  advisory: TasteAdvisory[];
  coverage: {
    rooms: number;
    classified: number;
    unclassified: LintUnclassifiedRoom[];
    weight: { assessable: number; total: number };
    skipped: TasteSkip[];
  };
  subscores: Record<TasteSubscore, number | null>;
  criteria: TasteCriterion[];
}
