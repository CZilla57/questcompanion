// The Campaign — Phase 0: the Character Sheet.
//
// Six ability scores DERIVED at read time from signals already persisted — the
// five Life Kingdoms' lifetime points and the hero's focus discipline — plus a
// proficiency bonus from the capital's tier. Nothing here is stored: scores are
// a re-reading of kingdom structure and focus history, exactly the same
// derived-at-read-time discipline as kingdoms.ts / companion.ts / hero-care.ts.
//
// INVARIANT (anti-shame + monotonic): more work can only raise a score, never
// lower it. Every source signal (kingdom lifetime points, completed focus
// intervals) is itself monotonic, and every mapping below is non-decreasing, so
// a character sheet can never regress. The tests pin this down.
import {
  type KingdomId,
  kingdomTier,
  capitalTier,
  capitalLifetime,
} from "./kingdoms";

/** The six abilities. App-flavored names; the classic D&D ability each stands in
 *  for is noted so the modifier math reads as expected to a tabletop player. */
export type AbilityId =
  | "vigor"       // CON — Hearth: upkeep, home, endurance
  | "attunement"  // WIS — Wellspring: health, self-care, attunement to self
  | "might"       // STR — Forge: deep work, admin, finance (the grind)
  | "intellect"   // INT — Athenaeum: learning, creative
  | "presence"    // CHA — Crossroads: social, travel
  | "finesse";    // DEX — focus discipline (timing, quickness)

export interface AbilityMeta {
  id: AbilityId;
  name: string;
  abbreviation: string;
  /** Source kingdom, or null for finesse (which reads focus discipline). */
  kingdomId: KingdomId | null;
}

/** Fixed display order — mirrors the kingdom display order, with finesse last
 *  since it is the one ability not drawn from a kingdom. */
export const ABILITIES: readonly AbilityMeta[] = [
  { id: "might",      name: "Might",      abbreviation: "MGT", kingdomId: "forge" },
  { id: "intellect",  name: "Intellect",  abbreviation: "INT", kingdomId: "athenaeum" },
  { id: "attunement", name: "Attunement", abbreviation: "ATN", kingdomId: "wellspring" },
  { id: "presence",   name: "Presence",   abbreviation: "PRS", kingdomId: "crossroads" },
  { id: "vigor",      name: "Vigor",      abbreviation: "VIG", kingdomId: "hearth" },
  { id: "finesse",    name: "Finesse",    abbreviation: "FIN", kingdomId: null },
];

export const MIN_SCORE = 8;
export const MAX_SCORE = 20;

/** Points a kingdom must reach for the "veteran" 20 — one full step past the
 *  Stronghold tier (8000). Absolute, never relative to the user's other
 *  kingdoms, same discipline as the kingdom tiers. */
export const VETERAN_KINGDOM_POINTS = 20000;

/**
 * Classic D&D ability modifier: floor((score - 10) / 2). With the score ladder
 * below this yields a clean +mod per tier: 8→-1, 10→0, 12→+1, 14→+2, 16→+3,
 * 18→+4, 20→+5 — the "+N" a player reads next to each ability.
 */
export function abilityModifier(score: number): number {
  return Math.floor((score - 10) / 2);
}

/**
 * Kingdom lifetime points → an ability score in [8, 20], reusing the kingdom
 * tier bands so a Stronghold kingdom is a strong ability. `8 + 2·tier` maps the
 * six tiers (Wild…Stronghold) to 8…18; a veteran kingdom reaches 20.
 * Non-decreasing in points (kingdomTier is), so the score is monotonic.
 */
export function scoreForKingdomPoints(points: number): number {
  if (points >= VETERAN_KINGDOM_POINTS) return MAX_SCORE;
  const { tier } = kingdomTier(points);
  return MIN_SCORE + tier * 2;
}

/**
 * Finesse's source: lifetime completed focus intervals. Its own absolute band
 * ladder (no kingdom to borrow from), shaped to reach parity with a strong
 * kingdom only after sustained focus practice. Non-decreasing in intervals.
 */
const FINESSE_BANDS: { minIntervals: number; score: number }[] = [
  { minIntervals: 1200, score: 20 },
  { minIntervals: 500,  score: 18 },
  { minIntervals: 200,  score: 16 },
  { minIntervals: 75,   score: 14 },
  { minIntervals: 25,   score: 12 },
  { minIntervals: 1,    score: 10 },
  { minIntervals: 0,    score: 8  },
];

export function scoreForFocus(completedIntervals: number): number {
  for (const b of FINESSE_BANDS) {
    if (completedIntervals >= b.minIntervals) return b.score;
  }
  return MIN_SCORE;
}

/**
 * Sub-step progress toward the next ability point.
 *
 * The score only steps at a band boundary (a kingdom tier, or a focus band), so
 * a single completed quest almost never moves the integer score. `stepProgress`
 * exposes the *distance travelled inside the current band* so a client can show
 * a filling bar — the felt "that quest nudged my Might" loop — without inventing
 * a second, stored ability model. Purely derived from the same monotonic signal
 * the score reads.
 *
 * Anti-shame: within a band the fill only rises as the signal rises, and at the
 * top of the ladder the bar reads full (never "stuck" or empty). A step-up
 * resets the bar toward the next point, which is the intended reward, not a
 * regression — the score itself is monotonic (pinned by the tests).
 */
export interface AbilityProgress {
  /** Fill toward the next score point, 0..1. `1` once the ability is maxed. */
  fraction: number;
  /** Signal units still needed to reach the next point; `0` when maxed. */
  toNext: number;
  /** The score the next step reaches, or `null` when already at the max. */
  nextScore: number | null;
  /** True at the top of the ladder — no further point to climb toward. */
  atMax: boolean;
}

/** One rung of a score ladder: at `at` signal units the score becomes `score`.
 *  Ascending by `at`, first rung at 0. */
interface ScoreRung {
  at: number;
  score: number;
}

/** Kingdom-ability ladder — the KINGDOM_TIERS bands (`8 + 2·tier`) plus the
 *  veteran 20. A test pins every rung to `scoreForKingdomPoints` so it can never
 *  silently drift from the score function it mirrors. */
const KINGDOM_LADDER: readonly ScoreRung[] = [
  { at: 0, score: 8 },
  { at: 1, score: 10 },
  { at: 250, score: 12 },
  { at: 1000, score: 14 },
  { at: 3000, score: 16 },
  { at: 8000, score: 18 },
  { at: VETERAN_KINGDOM_POINTS, score: 20 },
];

/** Finesse ladder — derived from FINESSE_BANDS (reversed to ascending) so it
 *  stays the single source of truth with `scoreForFocus`. */
const FOCUS_LADDER: readonly ScoreRung[] = [...FINESSE_BANDS]
  .reverse()
  .map((b) => ({ at: b.minIntervals, score: b.score }));

/** Distance travelled inside the current band of an ascending score ladder. */
export function stepProgress(value: number, ladder: readonly ScoreRung[]): AbilityProgress {
  let i = 0;
  for (let k = 0; k < ladder.length; k++) {
    if (value >= ladder[k]!.at) i = k;
  }
  const cur = ladder[i]!;
  const next = ladder[i + 1];
  if (!next) {
    return { fraction: 1, toNext: 0, nextScore: null, atMax: true };
  }
  const span = next.at - cur.at;
  const into = Math.min(Math.max(value - cur.at, 0), span);
  const fraction = span > 0 ? into / span : 1;
  return { fraction, toNext: Math.max(next.at - value, 0), nextScore: next.score, atMax: false };
}

/**
 * Proficiency bonus, added to every skill check, drawn from the capital's tier
 * (0–11 → +2…+6). Classic D&D proficiency runs +2 to +6 across levels 1–20;
 * `2 + floor(tier / 2)` reaches +6 near the top of the capital ladder. The
 * capital is the realm's grand total, so proficiency rises with total life
 * built, not any single area. Non-decreasing in tier.
 */
export function proficiencyBonus(capitalTierValue: number): number {
  return Math.min(6, 2 + Math.floor(capitalTierValue / 2));
}

export interface AbilityScore {
  id: AbilityId;
  name: string;
  abbreviation: string;
  score: number;
  modifier: number;
  /** Source kingdom (null for finesse) — lets a client link the score to its
   *  place on the Kingdom map. */
  kingdomId: KingdomId | null;
  /** Fill toward the next ability point, so each qualifying quest visibly
   *  nudges the right ability even between whole-number steps. Derived. */
  progress: AbilityProgress;
}

export interface FocusDiscipline {
  /** Lifetime completed focus intervals across all sessions. Monotonic. */
  completedIntervals: number;
}

/** Compute the six ability scores from the raw persisted signals. Pure. */
export function abilityScores(args: {
  lifetimeByKingdom: Partial<Record<KingdomId, number>>;
  focus: FocusDiscipline;
}): AbilityScore[] {
  return ABILITIES.map((meta) => {
    const value = meta.kingdomId
      ? (args.lifetimeByKingdom[meta.kingdomId] ?? 0)
      : args.focus.completedIntervals;
    const score = meta.kingdomId ? scoreForKingdomPoints(value) : scoreForFocus(value);
    const progress = stepProgress(value, meta.kingdomId ? KINGDOM_LADDER : FOCUS_LADDER);
    return {
      id: meta.id,
      name: meta.name,
      abbreviation: meta.abbreviation,
      score,
      modifier: abilityModifier(score),
      kingdomId: meta.kingdomId,
      progress,
    };
  });
}

/** Look up one ability's modifier by the ability id — used by the roll engine
 *  (Phase 1) to add the right ability to a skill check. */
export function modifierForAbility(sheet: AbilityScore[], id: AbilityId): number {
  return sheet.find((a) => a.id === id)?.modifier ?? 0;
}

/** The ability a task's category rolls under, mirroring CATEGORY_TO_KINGDOM.
 *  Unknown / default categories (which map to the capital, not a kingdom) roll
 *  under finesse — the ability with no kingdom of its own. */
export function abilityForKingdom(kingdomId: KingdomId): AbilityId {
  const meta = ABILITIES.find((a) => a.kingdomId === kingdomId);
  return meta?.id ?? "finesse";
}

export interface CharacterSheet {
  abilities: AbilityScore[];
  proficiencyBonus: number;
  /** Passed through from the existing avatar/hero system, not computed here. */
  heroClass: string;
  level: number;
  battlePower: number;
}

/**
 * Assemble the full sheet. Ability scores and proficiency are derived here from
 * kingdom points + focus; class, level, and battle power are passed in from the
 * existing avatar system (this lib owns none of those). Pure and DB-free so the
 * route is a set of reads plus one call to this — same shape as kingdomStates.
 */
export function characterSheet(args: {
  lifetimeByKingdom: Partial<Record<KingdomId, number>>;
  focus: FocusDiscipline;
  heroClass: string;
  level: number;
  battlePower: number;
}): CharacterSheet {
  const capitalPoints = capitalLifetime(args.lifetimeByKingdom);
  return {
    abilities: abilityScores({ lifetimeByKingdom: args.lifetimeByKingdom, focus: args.focus }),
    proficiencyBonus: proficiencyBonus(capitalTier(capitalPoints).tier),
    heroClass: args.heroClass,
    level: args.level,
    battlePower: args.battlePower,
  };
}
