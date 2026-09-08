import { describe, it, expect } from "vitest";
import {
  FEATS,
  featsForClass,
  unlockedFeats,
  lockedFeats,
  getFeat,
  passiveBonusPoints,
  canActivate,
  FEAT_BRANCHES,
  branchesForClass,
  getBranch,
  branchTreeUnlocked,
  chosenBranchPassive,
  BRANCH_UNLOCK_LEVEL,
  BRANCH_BONUS,
} from "./class-feats";

describe("class-feats registry", () => {
  it("gives every class one active (L4) and one passive (L6) feat", () => {
    for (const cls of ["fighter", "mage", "ranger", "healer"] as const) {
      const feats = featsForClass(cls);
      expect(feats).toHaveLength(2);
      expect(feats.map((f) => f.kind).sort()).toEqual(["active", "passive"]);
      expect(feats.find((f) => f.kind === "active")!.unlockLevel).toBe(4);
      expect(feats.find((f) => f.kind === "passive")!.unlockLevel).toBe(6);
    }
  });

  it("wires each active feat to an existing Stat Perk grant and each passive to a home kingdom", () => {
    for (const f of FEATS) {
      if (f.kind === "active") {
        expect(f.grants).toBeDefined();
        expect(["xp_boost", "focus_boost", "streak_shield"]).toContain(f.grants);
        expect(f.passiveKingdom).toBeUndefined();
      } else {
        expect(f.passiveKingdom).toBeDefined();
        expect(f.passiveBonus).toBeGreaterThan(0);
        expect(f.grants).toBeUndefined();
      }
    }
  });

  it("has unique feat ids", () => {
    expect(new Set(FEATS.map((f) => f.id)).size).toBe(FEATS.length);
  });
});

describe("unlockedFeats / lockedFeats", () => {
  it("unlocks nothing before the campaign era (below L4)", () => {
    expect(unlockedFeats("mage", 3)).toHaveLength(0);
    expect(lockedFeats("mage", 3)).toHaveLength(2);
  });

  it("unlocks the active feat at L4, then the passive at L6", () => {
    expect(unlockedFeats("ranger", 4).map((f) => f.id)).toEqual(["trailblazer"]);
    expect(unlockedFeats("ranger", 5).map((f) => f.id)).toEqual(["trailblazer"]);
    expect(unlockedFeats("ranger", 6).map((f) => f.id).sort()).toEqual(["pathfinder", "trailblazer"]);
    expect(lockedFeats("ranger", 4).map((f) => f.id)).toEqual(["pathfinder"]);
    expect(lockedFeats("ranger", 6)).toHaveLength(0);
  });

  it("is monotonic in level — unlocking never removes a feat", () => {
    const ids = (lvl: number) => new Set(unlockedFeats("fighter", lvl).map((f) => f.id));
    for (let lvl = 1; lvl < 10; lvl++) {
      const lower = ids(lvl);
      const higher = ids(lvl + 1);
      for (const id of lower) expect(higher.has(id)).toBe(true);
    }
  });

  it("yields no feats for an unknown class, and the default fighter still works", () => {
    expect(unlockedFeats("bard", 10)).toHaveLength(0);
    expect(unlockedFeats("fighter", 10)).toHaveLength(2);
  });
});

describe("passiveBonusPoints (upside-only)", () => {
  const mageAt6 = unlockedFeats("mage", 6); // Scholar's Insight: +10% on athenaeum

  it("adds a bonus on a matching (athenaeum) category", () => {
    // learning → athenaeum; +10% of 50 = 5
    expect(passiveBonusPoints(mageAt6, "learning", 50)).toBe(5);
    expect(passiveBonusPoints(mageAt6, "creative", 100)).toBe(10);
  });

  it("adds nothing on a non-matching category", () => {
    expect(passiveBonusPoints(mageAt6, "household", 100)).toBe(0);
    expect(passiveBonusPoints(mageAt6, "default", 100)).toBe(0);
  });

  it("adds nothing while the passive feat is still locked", () => {
    const mageAt5 = unlockedFeats("mage", 5); // active only, no passive yet
    expect(passiveBonusPoints(mageAt5, "learning", 100)).toBe(0);
  });

  it("is never negative, for any category or base", () => {
    for (const cat of ["learning", "household", "health", "deep_work", "social", "default", "unknown"]) {
      for (const base of [0, 1, 15, 250]) {
        expect(passiveBonusPoints(unlockedFeats("healer", 6), cat, base)).toBeGreaterThanOrEqual(0);
      }
    }
  });

  it("only an active feat set contributes nothing (active feats carry no passive bias)", () => {
    const rangerActiveOnly = unlockedFeats("ranger", 4);
    expect(passiveBonusPoints(rangerActiveOnly, "travel", 100)).toBe(0);
  });
});

describe("canActivate (once per local day)", () => {
  it("is ready when never used", () => {
    expect(canActivate(null, "2026-09-07")).toBe(true);
  });

  it("is not ready when already used today", () => {
    expect(canActivate("2026-09-07", "2026-09-07")).toBe(false);
  });

  it("is ready again on a later local day", () => {
    expect(canActivate("2026-09-06", "2026-09-07")).toBe(true);
  });
});

describe("getFeat", () => {
  it("finds a known feat and misses an unknown one", () => {
    expect(getFeat("focus_surge")?.heroClass).toBe("mage");
    expect(getFeat("nope")).toBeUndefined();
  });
});

describe("feat tree — the branching specialization (Act V, free respec)", () => {
  const CLASSES = ["fighter", "mage", "ranger", "healer"] as const;

  it("offers exactly two branches per class, each a distinct non-home Life Kingdom", () => {
    for (const cls of CLASSES) {
      const branches = branchesForClass(cls);
      expect(branches).toHaveLength(2);
      const kingdoms = new Set(branches.map((b) => b.kingdom));
      expect(kingdoms.size).toBe(2); // two different callings
      for (const b of branches) {
        expect(b.heroClass).toBe(cls);
        expect(b.label.length).toBeGreaterThan(0);
        expect(b.description.length).toBeGreaterThan(0);
      }
    }
  });

  it("has globally-unique branch ids", () => {
    const ids = new Set(FEAT_BRANCHES.map((b) => b.id));
    expect(ids.size).toBe(FEAT_BRANCHES.length);
  });

  it("the tree opens only at BRANCH_UNLOCK_LEVEL", () => {
    expect(branchTreeUnlocked(BRANCH_UNLOCK_LEVEL - 1)).toBe(false);
    expect(branchTreeUnlocked(BRANCH_UNLOCK_LEVEL)).toBe(true);
  });

  it("a chosen branch becomes a passive feat only when class matches AND tree is open", () => {
    const branch = branchesForClass("fighter")[0]!;
    // Right class, unlocked → a synthetic passive with the branch's kingdom + bonus.
    const feat = chosenBranchPassive(branch.id, "fighter", BRANCH_UNLOCK_LEVEL);
    expect(feat).not.toBeNull();
    expect(feat!.kind).toBe("passive");
    expect(feat!.passiveKingdom).toBe(branch.kingdom);
    expect(feat!.passiveBonus).toBe(BRANCH_BONUS);
    // Tree not yet open → no bonus.
    expect(chosenBranchPassive(branch.id, "fighter", BRANCH_UNLOCK_LEVEL - 1)).toBeNull();
    // Wrong class (e.g. after a class change) → no bonus, never an error.
    expect(chosenBranchPassive(branch.id, "mage", BRANCH_UNLOCK_LEVEL)).toBeNull();
    // No choice / unknown id → null.
    expect(chosenBranchPassive(null, "fighter", BRANCH_UNLOCK_LEVEL)).toBeNull();
    expect(chosenBranchPassive("nope", "fighter", BRANCH_UNLOCK_LEVEL)).toBeNull();
  });

  it("the branch bonus is upside-only through the passive seam (matches category, never lowers)", () => {
    const branch = getBranch("fighter_warden")!; // hearth (household/errands)
    const feat = chosenBranchPassive(branch.id, "fighter", BRANCH_UNLOCK_LEVEL)!;
    const onKingdom = passiveBonusPoints([feat], "household", 40);
    expect(onKingdom).toBe(Math.round(40 * BRANCH_BONUS));
    // A category outside the branch's kingdom gets nothing (never negative).
    expect(passiveBonusPoints([feat], "deep_work", 40)).toBe(0);
  });
});
