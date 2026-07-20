// Act VII One Voice: the single decision point for every push notification.
// Producers offer candidates; this module picks at most one per user per tick.
// Pure — all state comes in via EnvelopeState so the rules are exhaustively testable.

export const DAILY_PUSH_BUDGET = 3;
export const PUSH_SPACING_MIN = 90;
// Absolute floor, matching lib/hyperfocus.ts DEEP_NIGHT_START/MORNING — no push
// of any class in [2,7) local, and it is not user-configurable.
export const DEEP_NIGHT_START = 2;
export const DEEP_NIGHT_END = 7;

export type NotificationCategory = "protection" | "reminders" | "reflection" | "hero";
export type CandidateClass = "critical" | "reminder" | "reflection" | "milestone" | "ambient";

export type CandidateKind =
  | "hyperfocus"
  | "hunger_warning"
  | "context_nudge"
  | "reflection_prompt"
  | "companion_milestone"
  | "hero_flavor";

export interface KindMeta { category: NotificationCategory; klass: CandidateClass }

// Category = which user pref toggle governs it. Class = when it may fire and
// how it ranks. hunger_warning is a care warning, but it keeps daytime manners
// (reminder class) — only hyperfocus protection may speak at night, because
// bedtime nudges exist to fire at 23:00+.
export const KIND_META: Record<CandidateKind, KindMeta> = {
  hyperfocus:          { category: "protection", klass: "critical" },
  hunger_warning:      { category: "hero",       klass: "reminder" },
  context_nudge:       { category: "reminders",  klass: "reminder" },
  reflection_prompt:   { category: "reflection", klass: "reflection" },
  companion_milestone: { category: "hero",       klass: "milestone" },
  hero_flavor:         { category: "hero",       klass: "ambient" },
};

const CLASS_RANK: Record<CandidateClass, number> = {
  critical: 0, reminder: 1, reflection: 2, milestone: 3, ambient: 4,
};

// Local-hour windows per class. Critical has no window here — the deep-night
// floor above is its only constraint. Reminder starts at 7 to preserve the
// context-nudge envelope (ENVELOPE_START = 7); ambient/milestone start at 8,
// carrying hero-care's old daytime intent into the user's own timezone.
const CLASS_WINDOW: Record<Exclude<CandidateClass, "critical">, [number, number]> = {
  reminder:   [7, 22],
  reflection: [7, 22],
  milestone:  [8, 22],
  ambient:    [8, 22],
};

export interface PushCandidate {
  kind: CandidateKind;
  title: string;
  body: string;
  tag: string;
  url?: string;
}

export interface EnvelopePrefs {
  protection: boolean;
  reminders: boolean;
  reflection: boolean;
  hero: boolean;
  quietHoursStart: number;
  quietHoursEnd: number;
}

export interface EnvelopeState {
  localHour: number;
  localToday: string;
  prefs: EnvelopePrefs;
  pushesSentDate: string | null;
  pushesSentCount: number;
  lastPushAt: Date | null;
  now: Date;
}

/** Quiet window is [start→end) and may wrap midnight; start === end means none. */
export function inQuietHours(hour: number, start: number, end: number): boolean {
  if (start === end) return false;
  if (start < end) return hour >= start && hour < end;
  return hour >= start || hour < end;
}

export function selectPush(candidates: PushCandidate[], state: EnvelopeState): PushCandidate | null {
  const { localHour, prefs } = state;

  if (localHour >= DEEP_NIGHT_START && localHour < DEEP_NIGHT_END) return null;

  if (state.lastPushAt) {
    const elapsedMin = (state.now.getTime() - state.lastPushAt.getTime()) / 60_000;
    if (elapsedMin < PUSH_SPACING_MIN) return null;
  }

  const sentToday = state.pushesSentDate === state.localToday ? state.pushesSentCount : 0;
  if (sentToday >= DAILY_PUSH_BUDGET) return null;

  const allowed = candidates.filter((c) => {
    const meta = KIND_META[c.kind];
    if (!prefs[meta.category]) return false;
    if (meta.klass !== "critical") {
      const [start, end] = CLASS_WINDOW[meta.klass];
      if (localHour < start || localHour >= end) return false;
      if (inQuietHours(localHour, prefs.quietHoursStart, prefs.quietHoursEnd)) return false;
    }
    return true;
  });
  if (allowed.length === 0) return null;

  // Stable: sort is by class rank only, and Array.prototype.sort is stable,
  // so ties keep producer order (first offered wins).
  return [...allowed].sort((a, b) => CLASS_RANK[KIND_META[a.kind].klass] - CLASS_RANK[KIND_META[b.kind].klass])[0];
}

export type PrefsValidation = { ok: true; value: EnvelopePrefs } | { ok: false; error: string };

export function validatePrefsBody(body: unknown): PrefsValidation {
  if (body === null || typeof body !== "object") return { ok: false, error: "Body must be an object" };
  const b = body as Record<string, unknown>;
  for (const key of ["protection", "reminders", "reflection", "hero"] as const) {
    if (typeof b[key] !== "boolean") return { ok: false, error: `${key} must be a boolean` };
  }
  for (const key of ["quietHoursStart", "quietHoursEnd"] as const) {
    const v = b[key];
    if (typeof v !== "number" || !Number.isInteger(v) || v < 0 || v > 23) {
      return { ok: false, error: `${key} must be an integer between 0 and 23` };
    }
  }
  return {
    ok: true,
    value: {
      protection: b.protection as boolean,
      reminders: b.reminders as boolean,
      reflection: b.reflection as boolean,
      hero: b.hero as boolean,
      quietHoursStart: b.quietHoursStart as number,
      quietHoursEnd: b.quietHoursEnd as number,
    },
  };
}
