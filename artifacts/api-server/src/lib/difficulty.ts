import type { RungContent, VariantLadder, DifficultyLevel, Task } from "@workspace/db";
import type { VariantsResult } from "./ai/difficulty-variants";
import type { BrainMode } from "./brain-mode";

export const OFFER_THRESHOLD = 3;
export const FROZEN_OFFER_THRESHOLD = 2;
export const PAST_DUE_CAP = 3;
export const SNOOZE_WINDOW_MS = 3 * 86_400_000;

/** Merge the user's medium snapshot with the LLM easy/hard drafts. */
export function assembleLadder(medium: RungContent, drafts: VariantsResult): VariantLadder {
  return { easy: drafts.easy, medium, hard: drafts.hard };
}

/** Capture the quest as-is as the medium rung (its own baseline). */
export function snapshotMedium(
  task: { title: string; estimatedMinutes: number | null },
  stepTexts: string[],
): RungContent {
  return { title: task.title, estimatedMinutes: task.estimatedMinutes, steps: stepTexts };
}

export interface OfferInput {
  completed: boolean;
  difficulty: string;
  struggleScore: number;
  dueDate: string | null;
  isAnchored: boolean;
  isDailyFocus: boolean;
  focusDate: string | null;
  difficultyOfferSnoozedAt: Date | null;
}

export interface OfferContext {
  now: Date;
  todayStr: string;
  mode: BrainMode;
}

/**
 * Maps a task row to the evaluator's input shape. The single source of truth
 * for that mapping — both GET /tasks and momentum surfacing call this instead
 * of hand-rolling the same field list, so the two call sites can't drift.
 */
export function toOfferInput(t: Task): OfferInput {
  return {
    completed: t.completed,
    difficulty: t.difficulty,
    struggleScore: t.struggleScore,
    dueDate: t.dueDate,
    isAnchored: t.isAnchored,
    isDailyFocus: t.isDailyFocus,
    focusDate: t.focusDate,
    difficultyOfferSnoozedAt: t.difficultyOfferSnoozedAt,
  };
}

function daysBetween(fromYmd: string, toYmd: string): number {
  return Math.floor((Date.parse(toYmd) - Date.parse(fromYmd)) / 86_400_000);
}

/**
 * Should the app gently offer a smaller version of this quest? Pure and silent:
 * combines the persisted struggle score with derived ambient signals. Never a
 * shame signal — easy is a floor, completed quests never qualify, and a recent
 * snooze suppresses it.
 */
export function evaluateDifficultyOffer(input: OfferInput, ctx: OfferContext): boolean {
  if (input.completed) return false;
  if (input.difficulty === "easy") return false;
  if (
    input.difficultyOfferSnoozedAt &&
    ctx.now.getTime() - input.difficultyOfferSnoozedAt.getTime() < SNOOZE_WINDOW_MS
  ) {
    return false;
  }

  let ambient = 0;
  if (input.dueDate && !input.isAnchored && input.dueDate < ctx.todayStr) {
    ambient += Math.min(daysBetween(input.dueDate, ctx.todayStr), PAST_DUE_CAP);
  }
  if (input.isDailyFocus && input.focusDate && input.focusDate < ctx.todayStr) {
    ambient += 1;
  }

  const threshold = ctx.mode === "frozen" ? FROZEN_OFFER_THRESHOLD : OFFER_THRESHOLD;
  return input.struggleScore + ambient >= threshold;
}

/** Forward reschedule of an incomplete quest is the "I keep avoiding this" signal. */
export function struggleDeltaOnReschedule(existingDueDate: string | null, newDueDate: string): number {
  return existingDueDate && newDueDate > existingDueDate ? 1 : 0;
}

/** A rescue on a quest; "too_big" is direct evidence it needs resizing. */
export function struggleDeltaOnRescue(blocker: string): number {
  return blocker === "too_big" ? 2 : 1;
}

/** First easier/harder use must draft the ladder; medium is the baseline (no draft). */
export function needsVariantGeneration(hasVariants: boolean, level: DifficultyLevel): boolean {
  return !hasVariants && level !== "medium";
}
