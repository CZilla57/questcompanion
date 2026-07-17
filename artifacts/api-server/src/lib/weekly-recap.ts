import { getWeekKey } from "./week-key";
import { localDateKey, localHour } from "./date-buckets";
import type { PatternSummary } from "./patterns";
import type { WeekStats } from "@workspace/db";

/** Sends may start at 8am local Monday and retry until local midnight — a
 * cron/host outage over the morning delays the email, never kills the week. */
export const RECAP_START_HOUR = 8;

export interface LocalWeek {
  weekKey: string;              // ISO week key of the recapped (closed) week
  startDateKey: string;         // its Monday, YYYY-MM-DD (inclusive)
  endDateKeyExclusive: string;  // the following Monday, YYYY-MM-DD (exclusive)
}

/** The most recently CLOSED local Mon..Sun week as of `now` in `timeZone`.
 * Day arithmetic on a UTC-noon anchor of the local date, so DST can't shift it. */
export function previousLocalWeek(now: Date, timeZone: string): LocalWeek {
  const anchor = new Date(localDateKey(now, timeZone) + "T12:00:00Z");
  const daysSinceMonday = (anchor.getUTCDay() + 6) % 7;
  const thisMonday = new Date(anchor);
  thisMonday.setUTCDate(thisMonday.getUTCDate() - daysSinceMonday);
  const prevMonday = new Date(thisMonday);
  prevMonday.setUTCDate(prevMonday.getUTCDate() - 7);
  return {
    weekKey: getWeekKey(prevMonday),
    startDateKey: prevMonday.toISOString().split("T")[0]!,
    endDateKeyExclusive: thisMonday.toISOString().split("T")[0]!,
  };
}

export function inRecapWindow(now: Date, timeZone: string): boolean {
  const dow = new Date(localDateKey(now, timeZone) + "T12:00:00Z").getUTCDay();
  return dow === 1 && localHour(now, timeZone) >= RECAP_START_HOUR;
}

/** Raw rows loaded by the cron pass; buildWeekStats is the pure summarizer.
 * Structurally strengths-only: there is no field for open/missed/overdue work. */
export interface WeekStatsInputs {
  weekKey: string;
  completions: { title: string; completedAt: Date }[];
  focusSessions: { focusedSeconds: number }[];
  xpEarned: number;      // sum of positive activity points in the window
  levelUps: number;      // count of activity rows with type "level_up"
  coinsEarned: number;   // sum of positive coin_transactions amounts
  initiations: number;   // initiation_awards rows in the window
  badges: string[];      // badge names earned in the window
  questlinesCompleted: string[];
  bossAttacks: { damage: number }[]; // this user's attacks for weekKey (UTC ISO week)
  bossDefeated: boolean;
  patterns: PatternSummary; // 28d derivePatterns output, computed at recap time
}

export function buildWeekStats(inputs: WeekStatsInputs): WeekStats {
  const sorted = [...inputs.completions].sort((a, b) => a.completedAt.getTime() - b.completedAt.getTime());
  return {
    weekKey: inputs.weekKey,
    questsCompleted: inputs.completions.length,
    sampleQuestTitles: sorted.slice(0, 5).map((c) => c.title),
    focusSessions: inputs.focusSessions.length,
    focusMinutes: Math.round(inputs.focusSessions.reduce((s, f) => s + f.focusedSeconds, 0) / 60),
    xpEarned: inputs.xpEarned,
    coinsEarned: inputs.coinsEarned,
    initiations: inputs.initiations,
    levelUps: inputs.levelUps,
    badges: inputs.badges,
    questlinesCompleted: inputs.questlinesCompleted,
    boss: inputs.bossAttacks.length > 0
      ? {
          damage: inputs.bossAttacks.reduce((s, a) => s + a.damage, 0),
          attacks: inputs.bossAttacks.length,
          defeated: inputs.bossDefeated,
        }
      : null,
    // Same threshold the insights rhythms card treats as a full read.
    rhythms: inputs.patterns.confidence === "ok"
      ? {
          powerHours: inputs.patterns.powerHours.map((p) => p.hour),
          bestDay: inputs.patterns.bestDay,
          topHelpers: inputs.patterns.topHelpers,
        }
      : null,
  };
}

/** A zero-signal week gets total silence — no email, no "quiet week" message.
 * Rhythms alone (historical data) never justify a recap. */
export function isZeroSignal(stats: WeekStats): boolean {
  return stats.questsCompleted === 0
    && stats.focusSessions === 0
    && stats.xpEarned === 0
    && stats.coinsEarned === 0
    && stats.initiations === 0
    && stats.levelUps === 0
    && stats.badges.length === 0
    && stats.questlinesCompleted.length === 0
    && stats.boss === null;
}

/** Deterministic, never LLM-written. Leads with the strongest signal. */
export function recapSubject(stats: WeekStats): string {
  if (stats.questsCompleted > 0) {
    return `Your FocusQuest week — ${stats.questsCompleted} quest${stats.questsCompleted === 1 ? "" : "s"} cleared ⚔️`;
  }
  if (stats.focusMinutes > 0) {
    return `Your FocusQuest week — ${stats.focusMinutes} focused minute${stats.focusMinutes === 1 ? "" : "s"} 🎯`;
  }
  if (stats.boss && stats.boss.damage > 0) {
    return `Your FocusQuest week — ${stats.boss.damage} damage to the World Boss 🐉`;
  }
  return "Your FocusQuest week in review ✨";
}

export type RecapAction = "done" | "generate" | "send";

/** Where a claimed row resumes: crash between claim and content → regenerate;
 * content present but unsent → retry the send only. */
export function recapAction(row: { skipped: boolean; sentAt: Date | null; narrative: string | null }): RecapAction {
  if (row.skipped || row.sentAt) return "done";
  if (!row.narrative) return "generate";
  return "send";
}

/** Login-time email capture. Returns the users-table updates to apply, or null
 * when nothing needs writing. The unsubscribe token is per-user, generated once
 * and kept stable across email changes so old links stay valid. */
export function resolveEmailCapture(
  claimEmail: unknown,
  current: { email: string | null; recapUnsubscribeToken: string | null },
  newToken: () => string,
): { email: string; recapUnsubscribeToken?: string } | null {
  if (typeof claimEmail !== "string" || !claimEmail.includes("@")) return null;
  const needsEmail = current.email !== claimEmail;
  const needsToken = current.recapUnsubscribeToken == null;
  if (!needsEmail && !needsToken) return null;
  const updates: { email: string; recapUnsubscribeToken?: string } = { email: claimEmail };
  if (needsToken) updates.recapUnsubscribeToken = newToken();
  return updates;
}
