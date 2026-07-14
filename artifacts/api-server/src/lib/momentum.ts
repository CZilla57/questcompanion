import { assignPoints, CATEGORY_LABELS, MORNING_FOCUS_CATEGORIES, EVENING_WINDDOWN_CATEGORIES } from "./auto-points";
import type { BrainMode } from "./brain-mode";

export interface MomentumTask {
  id: number;
  title: string;
  priority: string;
  category: string;
  estimatedMinutes: number | null;
  createdAt: Date;
  dueDate: string | null;
  isAnchored: boolean;
  isDailyFocus: boolean;
  focusDate: string | null;
  stepsDone: number;
  stepsOpen: number;
}

export interface MomentumContext {
  mode: BrainMode;
  /** Available minutes right now, when the user told us. */
  minutes?: number;
  now: Date;
  /** 0–23 in the user's timezone. */
  localHour: number;
  /** Local YYYY-MM-DD. */
  todayStr: string;
  completedTodayCategories: ReadonlySet<string>;
}

export interface MomentumScored {
  taskId: number;
  score: number;
  reason: string;
}

// Single tuning table. Change values only together with the tests that pin them.
export const WEIGHTS = {
  pinnedToday: 30,
  minutesFit: 25,
  minutesOvershoot: -40,
  minutesNoEstimate: -5,
  focusedHighPriority: 15,
  focusedMeaty: 5,
  distractedShort: 20,
  distractedTiny: 5,
  distractedRoutine: 5,
  frozenSmall: 25,
  frozenHasSteps: 10,
  frozenHighPriority: -10,
  hyperfocusInProgress: 25,
  hyperfocusColdBig: -10,
  morningCategory: 10,
  eveningCategory: 10,
  eveningShort: 5,
  queueAgePerDay: 2,
  queueAgeCapDays: 7,
  pastDue: 10,
  variety: 8,
} as const;

const ROUTINE_CATEGORIES = new Set(["self_care", "errands"]);

type Signal =
  | "pinned" | "minutes_fit" | "focused_priority" | "distracted_short"
  | "frozen_small" | "frozen_steps" | "hyperfocus_continue"
  | "morning" | "evening" | "age" | "past_due" | "variety";

// When two signals contribute equally, the earlier one here names the reason.
const DOMINANCE: Signal[] = [
  "pinned", "minutes_fit", "frozen_small", "frozen_steps", "hyperfocus_continue",
  "distracted_short", "focused_priority", "past_due", "age", "morning", "evening", "variety",
];

function reasonFor(signal: Signal, t: MomentumTask, ctx: MomentumContext, categoryLabel: string): string {
  switch (signal) {
    case "pinned":             return "You picked this one for today — still a good call.";
    case "minutes_fit":        return `Fits the ${ctx.minutes} minutes you've got.`;
    case "frozen_small":       return "Smallest thing on the list — one step, no pressure.";
    case "frozen_steps":       return "Already broken into steps — just the first one counts.";
    case "hyperfocus_continue": return "You're mid-flow on this one — ride it.";
    case "distracted_short":   return `Tiny win: about ${t.estimatedMinutes} minutes, easy to grab.`;
    case "focused_priority":   return "Brain's on — this one moves the needle.";
    case "past_due":           return "It's ready when you are — the date slipped by.";
    case "age":                return "This one's been waiting patiently.";
    case "morning":            return `A strong ${categoryLabel.toLowerCase()} quest to start the day.`;
    case "evening":            return "Light and doable for the evening.";
    case "variety":            return `A change of scenery — no ${categoryLabel.toLowerCase()} yet today.`;
  }
}

/** Stored category unless it's the legacy 'default', then keyword inference. */
function resolveCategory(t: MomentumTask): { category: string; label: string } {
  if (t.category && t.category !== "default") {
    return { category: t.category, label: CATEGORY_LABELS[t.category] ?? t.category.replace(/_/g, " ") };
  }
  const ap = assignPoints(t.title, t.priority);
  return { category: ap.category, label: ap.categoryLabel };
}

/**
 * A pinned-today quest loses its structural precedence (and its pin boost)
 * only when the context explicitly disqualifies it: it overshoots the stated
 * time budget, or the mode needs provably tiny wins and the pin isn't one.
 */
function pinDisqualified(t: MomentumTask, ctx: MomentumContext): boolean {
  const est = t.estimatedMinutes;
  if (ctx.minutes !== undefined && est !== null && est > ctx.minutes) return true;
  if (ctx.mode === "distracted" && (est === null || est > 15)) return true;
  if (ctx.mode === "frozen" && (est === null || est > 10)) return true;
  return false;
}

export function rankMomentum(tasks: MomentumTask[], ctx: MomentumContext): MomentumScored[] {
  const isMorning = ctx.localHour >= 6 && ctx.localHour < 11;
  const isEvening = ctx.localHour >= 17 && ctx.localHour < 21;

  const scored = tasks.map((t) => {
    const { category, label } = resolveCategory(t);
    const est = t.estimatedMinutes;
    let score = 0;
    const signals = new Map<Signal, number>();
    const add = (signal: Signal | null, points: number) => {
      score += points;
      if (signal && points > 0) signals.set(signal, (signals.get(signal) ?? 0) + points);
    };

    // Absorption guarantee (structural): an eligible pin takes rank precedence
    // over every non-pin; a disqualified pin gets no boost and competes as an
    // ordinary task. One predicate drives both, so the "pinned" reason can
    // never appear on a pin the context disqualified.
    const pinnedToday = t.isDailyFocus && t.focusDate === ctx.todayStr;
    const pinEligible = pinnedToday && !pinDisqualified(t, ctx);
    if (pinEligible) add("pinned", WEIGHTS.pinnedToday);

    // Available-time fit.
    if (ctx.minutes !== undefined) {
      if (est === null) add(null, WEIGHTS.minutesNoEstimate);
      else if (est <= ctx.minutes) add("minutes_fit", WEIGHTS.minutesFit);
      else add(null, WEIGHTS.minutesOvershoot);
    }

    // Mode weighting.
    switch (ctx.mode) {
      case "focused":
        if (t.priority === "high") add("focused_priority", WEIGHTS.focusedHighPriority);
        if (est !== null && est >= 25) add(null, WEIGHTS.focusedMeaty);
        break;
      case "distracted":
        if (est !== null && est <= 15) add("distracted_short", WEIGHTS.distractedShort);
        if (est !== null && est <= 5) add("distracted_short", WEIGHTS.distractedTiny);
        if (ROUTINE_CATEGORIES.has(category)) add(null, WEIGHTS.distractedRoutine);
        break;
      case "frozen":
        if (est !== null && est <= 10) add("frozen_small", WEIGHTS.frozenSmall);
        if (t.stepsOpen > 0) add("frozen_steps", WEIGHTS.frozenHasSteps);
        if (t.priority === "high") add(null, WEIGHTS.frozenHighPriority); // pressure off
        break;
      case "hyperfocus":
        if (t.stepsDone >= 1 && t.stepsOpen >= 1) add("hyperfocus_continue", WEIGHTS.hyperfocusInProgress);
        else if (t.stepsDone === 0 && est !== null && est >= 30) add(null, WEIGHTS.hyperfocusColdBig);
        break;
      case "neutral":
        break;
    }

    // Local time of day.
    if (isMorning && MORNING_FOCUS_CATEGORIES.has(category)) add("morning", WEIGHTS.morningCategory);
    if (isEvening) {
      if (EVENING_WINDDOWN_CATEGORIES.has(category)) add("evening", WEIGHTS.eveningCategory);
      if (est !== null && est <= 30) add("evening", WEIGHTS.eveningShort);
    }

    // Gentle queue-age boost.
    const daysOld = Math.floor((ctx.now.getTime() - t.createdAt.getTime()) / 86_400_000);
    if (daysOld >= 2) add("age", Math.min(daysOld, WEIGHTS.queueAgeCapDays) * WEIGHTS.queueAgePerDay);

    // Past due — never for anchored quests, and never alarmed.
    if (t.dueDate && !t.isAnchored && t.dueDate < ctx.todayStr) add("past_due", WEIGHTS.pastDue);

    // Category variety.
    if (!ctx.completedTodayCategories.has(category)) add("variety", WEIGHTS.variety);

    // Dominant positive signal names the reason.
    let reason = "A solid next step to keep things moving.";
    let best = 0;
    for (const signal of DOMINANCE) {
      const pts = signals.get(signal) ?? 0;
      if (pts > best) { best = pts; reason = reasonFor(signal, t, ctx, label); }
    }

    return { taskId: t.id, score, reason, createdAt: t.createdAt, pinEligible };
  });

  scored.sort((a, b) =>
    (b.pinEligible ? 1 : 0) - (a.pinEligible ? 1 : 0) ||
    b.score - a.score ||
    a.createdAt.getTime() - b.createdAt.getTime() ||
    a.taskId - b.taskId,
  );
  return scored.map(({ taskId, score, reason }) => ({ taskId, score, reason }));
}
