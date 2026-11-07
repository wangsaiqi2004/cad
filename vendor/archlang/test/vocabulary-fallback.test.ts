/**
 * The fallback use vocabulary (plan-soundness PS2.19): storage, office, utility, a nursery and a
 * water closet, read only for a label the primary vocabulary leaves with no use at all.
 *
 * Pinned here: what each fallback word classifies to, that a label the primary table already
 * classifies keeps exactly that answer (the fallback never adds to a non-empty answer), the
 * water-closet guard on "closet", the deliberate absences (balcony, terrace, studio, gallery,
 * meeting, staff room). The property behind the byte-identity claim (the answer differs from
 * the one before PS2.19 only where that one was empty) is held by
 * `test/vocabulary-matcher-oracle.test.ts`, whose verbatim oracle is the code before it.
 */

import { describe, expect, it } from "vitest";
import { describe as describePlan, lint } from "../src/index.js";
import { FALLBACK_USE_VOCABULARY, USE_VOCABULARY, classifyLabelUses } from "../src/vocabulary.js";

const planWith = (label: string): string => `plan "t" {
  units mm
  wall exterior thickness 200 { (0,0) (4000,0) (4000,3000) (0,3000) close }
  room id=r at (0,0) size 4000x3000 label "${label}"
  door id=d on exterior at 20% width 900
  window on exterior at 60% width 1200
}`;

describe("classifyLabelUses — the fallback kinds", () => {
  it("reads storage, office and utility from their canonical words", () => {
    for (const l of [
      "Store",
      "Storage",
      "Stores",
      "Storeroom",
      "Closet",
      "Wardrobe",
      "Walk-in Wardrobe",
      "Pantry",
      "Larder",
    ])
      expect(classifyLabelUses(l), l).toEqual({ uses: ["storage"], aliases: [] });
    for (const l of ["Office", "Study", "Open Office", "Office 2"])
      expect(classifyLabelUses(l), l).toEqual({ uses: ["office"], aliases: [] });
    for (const l of ["Utility", "Laundry", "Utility Room"])
      expect(classifyLabelUses(l), l).toEqual({ uses: ["utility"], aliases: [] });
  });

  it("flags the alias words", () => {
    expect(classifyLabelUses("Nursery")).toEqual({
      uses: ["bedroom"],
      aliases: [{ kind: "bedroom", word: "nursery" }],
    });
    // A day nursery is a childcare room, not a bedroom: it stays unclassified.
    expect(classifyLabelUses("Day Nursery")).toEqual({ uses: [], aliases: [] });
    expect(classifyLabelUses("Day-Nursery 2")).toEqual({ uses: [], aliases: [] });
    expect(classifyLabelUses("Dressing Room")).toEqual({
      uses: ["storage"],
      aliases: [{ kind: "storage", word: "dressing" }],
    });
    expect(classifyLabelUses("Linen")).toEqual({ uses: ["storage"], aliases: [{ kind: "storage", word: "linen" }] });
    expect(classifyLabelUses("Cellar")).toEqual({ uses: ["storage"], aliases: [{ kind: "storage", word: "cellar" }] });
    expect(classifyLabelUses("Consulting 1")).toEqual({
      uses: ["office"],
      aliases: [{ kind: "office", word: "consulting" }],
    });
    expect(classifyLabelUses("Plant Room")).toEqual({
      uses: ["utility"],
      aliases: [{ kind: "utility", word: "plant" }],
    });
    expect(classifyLabelUses("Boiler")).toEqual({ uses: ["utility"], aliases: [{ kind: "utility", word: "boiler" }] });
  });

  it("reads a water closet as a WC, not as storage", () => {
    expect(classifyLabelUses("Water Closet")).toEqual({
      uses: ["wc"],
      aliases: [{ kind: "wc", word: "water closet" }],
    });
    expect(classifyLabelUses("Closet")).toEqual({ uses: ["storage"], aliases: [] });
  });

  it("emits fallback kinds in their own order when a label names two", () => {
    expect(classifyLabelUses("Utility / Store").uses).toEqual(["storage", "utility"]);
    expect(classifyLabelUses("Study / Store").uses).toEqual(["storage", "office"]);
  });

  it("never adds to a label the primary vocabulary classifies", () => {
    expect(classifyLabelUses("Kitchen Store")).toEqual({ uses: ["kitchen"], aliases: [] });
    expect(classifyLabelUses("Bedroom Closet")).toEqual({ uses: ["bedroom"], aliases: [] });
    expect(classifyLabelUses("Study Bedroom")).toEqual({ uses: ["bedroom"], aliases: [] });
    expect(classifyLabelUses("Garage Utility Entrance").uses).toEqual(["entry", "garage"]);
    expect(classifyLabelUses("Family Store")).toEqual({
      uses: ["living"],
      aliases: [{ kind: "living", word: "family" }],
    });
  });

  it("leaves balconies, terraces, studios, galleries, meeting and staff rooms unclassified", () => {
    for (const l of [
      "Balcony",
      "Terrace",
      "Studio",
      "Gallery",
      "Meeting Room",
      "Staff room",
      "Storey",
      "Officer",
      "Planter",
    ])
      expect(classifyLabelUses(l).uses, l).toEqual([]);
  });

  it("uses only existing use kinds, none of them a primary row's key twice over", () => {
    for (const k of Object.keys(FALLBACK_USE_VOCABULARY))
      expect(["bedroom", "wc", "storage", "office", "utility", "living"]).toContain(k);
    const primary = new Set(Object.values(USE_VOCABULARY).flatMap((v) => [...v.canonical, ...v.aliases]));
    for (const v of Object.values(FALLBACK_USE_VOCABULARY))
      for (const w of [...v.canonical, ...v.aliases]) expect(primary.has(w), w).toBe(false);
  });
});

describe("PS2.18: a US/UK house's main rooms", () => {
  it("reads great room, reception room and drawing room as living, snug and den as aliases", () => {
    for (const l of ["Great room", "Great Room 1", "Reception room", "Drawing room"])
      expect(classifyLabelUses(l), l).toEqual({ uses: ["living"], aliases: [] });
    for (const [l, word] of [
      ["Snug", "snug"],
      ["Den", "den"],
    ] as const)
      expect(classifyLabelUses(l), l).toEqual({ uses: ["living"], aliases: [{ kind: "living", word }] });
  });

  it("reads guest, kids', children's rooms and the master suite as bedrooms, and a bare master as an alias", () => {
    for (const l of ["Guest room", "Kids room", "Children's room", "Master suite", "Master Suite 2"])
      expect(classifyLabelUses(l), l).toEqual({ uses: ["bedroom"], aliases: [] });
    expect(classifyLabelUses("Master")).toEqual({ uses: ["bedroom"], aliases: [{ kind: "bedroom", word: "master" }] });
  });

  it("a bare master gives way to another fallback room, and living is read only alone", () => {
    expect(classifyLabelUses("Master Closet").uses).toEqual(["storage"]);
    expect(classifyLabelUses("Master Study").uses).toEqual(["office"]);
    expect(classifyLabelUses("Den Store").uses).toEqual(["storage"]);
    expect(classifyLabelUses("Snug Study").uses).toEqual(["office"]);
    expect(classifyLabelUses("Guest room Store").uses).toEqual(["bedroom", "storage"]);
  });

  it("leaves every label the primary table classifies as it was", () => {
    for (const [l, uses] of [
      ["Family room", ["living"]],
      ["Lounge", ["living"]],
      ["Sitting room", ["living"]],
      ["Master Bedroom", ["bedroom"]],
      ["Master Bath", ["bath"]],
      ["Guest WC", ["wc"]],
      ["Den / Kitchen", ["kitchen"]],
    ] as const)
      expect(classifyLabelUses(l).uses, l).toEqual(uses);
    // Whole words only: "Garden" is not "den", "Masterpiece" is not "master".
    for (const l of ["Garden", "Masterpiece", "Greatroom"]) expect(classifyLabelUses(l).uses, l).toEqual([]);
  });

  it("a Great room, Master and Study house reads as a dwelling, not an office", async () => {
    const { dwellingReading } = await import("../src/analyze/dwelling.js");
    const rooms = ["Great room", "Kitchen", "Master", "Dining", "Hall", "Study"].map((label, i) => ({
      id: `r${i}`,
      label,
    }));
    expect(dwellingReading(rooms)).toBe("dwelling");
  });
});

describe("the fallback reaches describe() and lint()", () => {
  it("describes a label-only Store as storage and a Study as an office", () => {
    expect(describePlan(planWith("Store")).rooms[0]?.uses).toEqual(["storage"]);
    expect(describePlan(planWith("Study")).rooms[0]?.uses).toEqual(["office"]);
  });

  it("advises pinning an alias with W_ALIAS_MATCH, and not a canonical word", () => {
    expect(lint(planWith("Nursery")).map((d) => d.code)).toContain("W_ALIAS_MATCH");
    expect(lint(planWith("Pantry")).map((d) => d.code)).not.toContain("W_ALIAS_MATCH");
  });
});
