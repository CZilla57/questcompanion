// The Campaign — Phase 3: the Dungeon Master. This module is the PURE,
// anti-shame boundary — it turns raw rows into the strengths-only `DmBeatFacts`
// the narration is grounded on. Like ai/reflection.ts buildDaySummary, the
// output shape has NO channel for missed, overdue, or unfinished work, so no
// prompt or fallback downstream can leak guilt fuel or fabricate a foe.
//
// The AI seam (prompt, validation, fallback) lives in ai/dungeon-master.ts;
// this file has no I/O and no model calls, so it is exhaustively unit-testable.
import { kingdomTier, KINGDOMS, type KingdomId } from "./kingdoms";
import type { DmBeatFacts } from "@workspace/db";

/** Cap the titles fed to the model — grounding, not an inventory dump. */
const MAX_TITLES = 6;

export interface DmFactInputs {
  /** Quests completed today, most-recent-last. */
  completedToday: { title: string; category: string }[];
  /** Open quests planned for today (due today, not yet done). */
  plannedToday: { title: string }[];
  /**
   * Lifetime kingdom points BEFORE today and the points added today, per
   * kingdom. A kingdom "grew" for the beat only when today's points pushed it
   * across a tier boundary — a real, visible advance, never invented.
   */
  lifetimeBeforeToday: Partial<Record<KingdomId, number>>;
  pointsToday: Partial<Record<KingdomId, number>>;
  focusMinutes: number;
  streakDays: number;
  /** The user's active campaign chapter beat, or null when none is running. */
  chapterBeat: string | null;
}

/** Sentence-case a kingdom advance the DM can lean on, e.g.
 * "the Forge reached Outpost". Only emitted when a tier boundary was actually
 * crossed today, so the DM never claims growth that did not happen. */
function growthLines(
  before: Partial<Record<KingdomId, number>>,
  today: Partial<Record<KingdomId, number>>,
): string[] {
  const lines: string[] = [];
  for (const k of KINGDOMS) {
    const added = today[k.id] ?? 0;
    if (added <= 0) continue;
    const beforeTier = kingdomTier(before[k.id] ?? 0);
    const afterTier = kingdomTier((before[k.id] ?? 0) + added);
    if (afterTier.tier > beforeTier.tier) {
      lines.push(`the ${k.name} reached ${afterTier.name}`);
    }
  }
  return lines;
}

/**
 * Assemble the grounded facts for a beat. Strengths-only by construction:
 * planned quests are the day's *intentions* (never "unfinished"), completed
 * quests are wins, and kingdom growth is only reported when it truly occurred.
 */
export function buildBeatFacts(input: DmFactInputs): DmBeatFacts {
  return {
    completedTitles: input.completedToday.slice(-MAX_TITLES).map((t) => t.title),
    plannedTitles: input.plannedToday.slice(0, MAX_TITLES).map((t) => t.title),
    kingdomGrowth: growthLines(input.lifetimeBeforeToday, input.pointsToday),
    focusMinutes: input.focusMinutes,
    streakDays: input.streakDays,
    chapterBeat: input.chapterBeat,
  };
}

/** True when a beat has literally nothing real to narrate — the DM stays quiet
 * rather than inventing a scene (a morning with no plans, an evening with no
 * wins). Kind-specific: mornings lean on plans, evenings on completions. */
export function beatHasSubstance(kind: "morning" | "camp", facts: DmBeatFacts): boolean {
  const anchor = kind === "morning" ? facts.plannedTitles : facts.completedTitles;
  return anchor.length > 0 || facts.kingdomGrowth.length > 0
    || facts.focusMinutes > 0 || facts.chapterBeat != null;
}
