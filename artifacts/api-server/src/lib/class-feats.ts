// The Campaign — second wave: Class Feats.
//
// A level-unlocked ability layer over the Character Sheet. Each hero class
// earns a small ladder of feats as it levels: always-on PASSIVE biases (a small
// additive XP bump on the class's home categories) and once-a-day ACTIVE feats
// (an earned boost that reuses the existing Stat Perk windows — see
// stat-perks.ts — rather than a new economy).
//
// Which feats a hero has is DERIVED from class + level at read time, exactly the
// way feature-gates.ts derives feature unlocks from level. Nothing here is
// stored; only active-feat activation timestamps persist (for the daily
// cooldown), and that lives in the route/table, not this pure lib.
//
// INVARIANT (anti-shame + upside-only): a feat can only ADD. `passiveBonusPoints`
// is never negative and is 0 for a non-matching category or a locked feat; a
// locked or on-cooldown feat never reduces a payout. The tests pin this down,
// extending the same upside-only discipline as the Stat Perk invariants.
import type { HeroClass } from "./hero-flavor";
import { type KingdomId, kingdomForCategory } from "./kingdoms";

export type FeatKind = "passive" | "active";

/** What an active feat grants — each maps to an existing upside-only Stat Perk
 *  window, so the completion / focus seams already honor it. */
export type FeatGrant = "xp_boost" | "focus_boost" | "streak_shield";

export interface FeatDef {
  id: string;
  heroClass: HeroClass;
  kind: FeatKind;
  /** Hero level at which the feat unlocks (inside the campaign era, L4+). */
  unlockLevel: number;
  label: string;
  emoji: string;
  description: string;
  /** Active feats only: the Stat Perk window activating the feat grants. */
  grants?: FeatGrant;
  /** Passive feats only: the home kingdom whose categories get the XP bias. */
  passiveKingdom?: KingdomId;
  /** Passive feats only: the additive fraction of base XP added (e.g. 0.1). */
  passiveBonus?: number;
}

/** Passive home-category bias, as a fraction of base XP. Modest and additive. */
const PASSIVE_BONUS = 0.1;

/**
 * The feat registry — the source of truth. Four classes, each with one active
 * feat (L4) and one passive feat (L6). Every effect maps to an existing,
 * upside-only mechanic; names keep the app's flavor.
 */
export const FEATS: readonly FeatDef[] = [
  // ── Mage (Intellect / Athenaeum) ──
  {
    id: "focus_surge", heroClass: "mage", kind: "active", unlockLevel: 4,
    label: "Focus Surge", emoji: "🔮",
    description: "Once a day, call up a Focus Boost — free.",
    grants: "focus_boost",
  },
  {
    id: "scholars_insight", heroClass: "mage", kind: "passive", unlockLevel: 6,
    label: "Scholar's Insight", emoji: "📖",
    description: "+10% XP on learning and creative quests.",
    passiveKingdom: "athenaeum", passiveBonus: PASSIVE_BONUS,
  },
  // ── Ranger (Finesse / Crossroads) ──
  {
    id: "trailblazer", heroClass: "ranger", kind: "active", unlockLevel: 4,
    label: "Trailblazer", emoji: "🏹",
    description: "Once a day, call up an XP Boost — free.",
    grants: "xp_boost",
  },
  {
    id: "pathfinder", heroClass: "ranger", kind: "passive", unlockLevel: 6,
    label: "Pathfinder", emoji: "🧭",
    description: "+10% XP on social and travel quests.",
    passiveKingdom: "crossroads", passiveBonus: PASSIVE_BONUS,
  },
  // ── Fighter (Might / Forge) ──
  {
    id: "second_wind", heroClass: "fighter", kind: "active", unlockLevel: 4,
    label: "Second Wind", emoji: "⚔️",
    description: "Once a day, call up an XP Boost — free.",
    grants: "xp_boost",
  },
  {
    id: "iron_resolve", heroClass: "fighter", kind: "passive", unlockLevel: 6,
    label: "Iron Resolve", emoji: "🛡️",
    description: "+10% XP on deep work, admin, and finance quests.",
    passiveKingdom: "forge", passiveBonus: PASSIVE_BONUS,
  },
  // ── Healer (Attunement / Wellspring) ──
  {
    id: "mend", heroClass: "healer", kind: "active", unlockLevel: 4,
    label: "Mend", emoji: "✨",
    description: "Once a day, ward your streak with a Streak Shield — free.",
    grants: "streak_shield",
  },
  {
    id: "restorative", heroClass: "healer", kind: "passive", unlockLevel: 6,
    label: "Restorative", emoji: "🌿",
    description: "+10% XP on health and self-care quests.",
    passiveKingdom: "wellspring", passiveBonus: PASSIVE_BONUS,
  },
] as const;

/** Every feat defined for a class, in unlock order (ignores level). */
export function featsForClass(heroClass: string): FeatDef[] {
  return FEATS.filter((f) => f.heroClass === heroClass)
    .sort((a, b) => a.unlockLevel - b.unlockLevel);
}

/** Feats the hero has earned: their class's feats at or below their level. */
export function unlockedFeats(heroClass: string, level: number): FeatDef[] {
  return featsForClass(heroClass).filter((f) => level >= f.unlockLevel);
}

/** Feats still ahead of the hero — for a calm "unlocks at Level N" line. */
export function lockedFeats(heroClass: string, level: number): FeatDef[] {
  return featsForClass(heroClass).filter((f) => level < f.unlockLevel);
}

export function getFeat(id: string): FeatDef | undefined {
  return FEATS.find((f) => f.id === id);
}

/**
 * Extra XP the hero's passive feats add on top of a quest's base reward — the
 * sum of `round(base * bonus)` for every UNLOCKED passive feat whose home
 * kingdom matches the quest's category. Purely additive: always ≥ 0, and 0 when
 * no passive feat matches, so it can never lower a payout.
 */
export function passiveBonusPoints(
  feats: readonly FeatDef[],
  category: string,
  basePoints: number,
): number {
  const kingdom = kingdomForCategory(category);
  let bonus = 0;
  for (const f of feats) {
    if (f.kind === "passive" && f.passiveKingdom === kingdom && f.passiveBonus) {
      bonus += Math.round(basePoints * f.passiveBonus);
    }
  }
  return Math.max(0, bonus);
}

// ─── Act V: the branching feat tree (a chosen "second calling") ──────────────
// Build identity via CHOICE: past the base feats, the hero picks a
// specialization — a second Life Kingdom to also excel in — granting a passive
// XP bias there. Anti-shame reconciliation (the roadmap's "picking a branch
// locks siblings" would permanently foreclose upside): this is a FREE RESPEC —
// re-choosable anytime at no cost, nothing ever lost ("focus, not a cage").
// The effect rides the SAME passiveBonusPoints seam (a branch is a synthetic
// passive feat), so it is additive and upside-only by construction.

/** Level at which the specialization tree opens (past the base feats @ L4/L6). */
export const BRANCH_UNLOCK_LEVEL = 8;

/** A branch's passive XP bias — a bit stronger than a base passive, so the
 *  choice is felt, but still modest and additive. */
export const BRANCH_BONUS = 0.15;

export interface FeatBranch {
  id: string;
  heroClass: HeroClass;
  label: string;
  emoji: string;
  /** The player-facing pitch for this calling. */
  description: string;
  /** The Life Kingdom this branch grants a passive XP bias in. */
  kingdom: KingdomId;
}

/**
 * The specialization registry — two branches per class, each a different
 * (non-home) Life Kingdom to also excel in. Every branch is pure upside (a
 * passive XP bias); the choice is which second calling to follow.
 */
export const FEAT_BRANCHES: readonly FeatBranch[] = [
  // ── Fighter (home: Forge) ──
  { id: "fighter_warden",   heroClass: "fighter", label: "Warden",   emoji: "🛡️", kingdom: "hearth",     description: "+15% XP on household and errands — hold the home front." },
  { id: "fighter_champion", heroClass: "fighter", label: "Champion", emoji: "🏅", kingdom: "crossroads", description: "+15% XP on social and travel — rally the people." },
  // ── Mage (home: Athenaeum) ──
  { id: "mage_alchemist",   heroClass: "mage",    label: "Alchemist", emoji: "⚗️", kingdom: "forge",      description: "+15% XP on deep work, admin, and finance — turn theory into results." },
  { id: "mage_mystic",      heroClass: "mage",    label: "Mystic",    emoji: "🌙", kingdom: "wellspring", description: "+15% XP on health and self-care — tend the inner fire." },
  // ── Ranger (home: Crossroads) ──
  { id: "ranger_forager",   heroClass: "ranger",  label: "Forager",  emoji: "🍃", kingdom: "hearth",     description: "+15% XP on household and errands — keep the camp in order." },
  { id: "ranger_scholar",   heroClass: "ranger",  label: "Scholar",  emoji: "📜", kingdom: "athenaeum",  description: "+15% XP on learning and creative work — read the wild's signs." },
  // ── Healer (home: Wellspring) ──
  { id: "healer_shepherd",  heroClass: "healer",  label: "Shepherd", emoji: "🐑", kingdom: "crossroads", description: "+15% XP on social and travel — your care travels with you." },
  { id: "healer_gardener",  heroClass: "healer",  label: "Gardener", emoji: "🌷", kingdom: "hearth",     description: "+15% XP on household and errands — grow order at home." },
] as const;

/** The branches offered to a class, in registry order. */
export function branchesForClass(heroClass: string): FeatBranch[] {
  return FEAT_BRANCHES.filter((b) => b.heroClass === heroClass);
}

export function getBranch(id: string | null | undefined): FeatBranch | undefined {
  return id ? FEAT_BRANCHES.find((b) => b.id === id) : undefined;
}

/** The specialization tree opens once the hero reaches BRANCH_UNLOCK_LEVEL. */
export function branchTreeUnlocked(level: number): boolean {
  return level >= BRANCH_UNLOCK_LEVEL;
}

/**
 * The hero's chosen branch as a synthetic passive feat, so its bonus rides the
 * existing passiveBonusPoints seam — or null if no valid, unlocked choice. A
 * branch only takes effect when it belongs to the hero's CURRENT class and the
 * tree is unlocked, so a class change or a not-yet-unlocked hero simply gets no
 * branch bonus (never an error, never a penalty).
 */
export function chosenBranchPassive(
  branchId: string | null | undefined,
  heroClass: string,
  level: number,
): FeatDef | null {
  const branch = getBranch(branchId);
  if (!branch || branch.heroClass !== heroClass || !branchTreeUnlocked(level)) return null;
  return {
    id: branch.id,
    heroClass: branch.heroClass,
    kind: "passive",
    unlockLevel: BRANCH_UNLOCK_LEVEL,
    label: branch.label,
    emoji: branch.emoji,
    description: branch.description,
    passiveKingdom: branch.kingdom,
    passiveBonus: BRANCH_BONUS,
  };
}

/**
 * Whether an active feat is ready today. The cooldown is one use per local day:
 * ready iff it has never been used, or its last use was on an earlier local date
 * than today. Keying off the user's local date (same tz resolution as
 * reflections / DM beats) keeps "once a day" stable across clients and refetches.
 */
export function canActivate(lastUsedLocalDate: string | null, todayLocalDate: string): boolean {
  return lastUsedLocalDate === null || lastUsedLocalDate < todayLocalDate;
}
