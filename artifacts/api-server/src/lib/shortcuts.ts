import { parseQuickAdd } from "@workspace/quick-add";
import { assignPoints, VALID_CATEGORIES } from "./auto-points";
import { localDateKey, resolveTimeZone } from "./date-buckets";

export const CAPTURE_MAX_LEN = 500;
export const TODAY_LIST_CAP = 25;
// Anti-shame: an empty list is an all-clear, never an emptiness.
export const ALL_CLEAR_MESSAGE = "Nothing waiting on you today 🌤";

export interface CaptureFields {
  title: string;
  /** Always set: the parsed date, else the user's local today (spec D5). */
  dueDate: string;
  dueTime: string | null;
  priority: string;
  category: string;
  points: number;
  /** Notification-ready confirmation for the Shortcut to display. */
  message: string;
}

/**
 * Insert-ready fields for a Pocket Gate capture. Deterministic parse only —
 * no LLM in the one-tap loop (spec D5) — anchored to the user's local
 * calendar so "tomorrow" and dateless captures land on the right day.
 */
export function buildCaptureFields(
  text: string,
  opts: { timezone: string | null; now: Date },
): CaptureFields {
  const tz = resolveTimeZone(opts.timezone);
  const todayKey = localDateKey(opts.now, tz);
  // Noon avoids DST edges — mirrors POST /tasks/parse.
  const parsed = parseQuickAdd(text, { now: new Date(`${todayKey}T12:00:00`) });
  const title = parsed.title || text.trim();
  const priority = parsed.priority ?? "medium";
  const auto = assignPoints(title, priority);
  const category =
    parsed.category && VALID_CATEGORIES.has(parsed.category) ? parsed.category : auto.category;
  const dueDate = parsed.dueDate ?? todayKey;
  return {
    title,
    dueDate,
    dueTime: parsed.dueTime ?? null,
    priority,
    category,
    points: auto.points,
    message: `Added ${dueDatePhrase(dueDate, todayKey)}: "${title}" ⚔️`,
  };
}

/** "for today" / "for tomorrow" / "for Fri, Jul 24" — phrased against the
 * user's local today, day math on UTC anchors so zones can't shift it. */
function dueDatePhrase(dueDate: string, todayKey: string): string {
  if (dueDate === todayKey) return "for today";
  const diffDays = Math.round(
    (Date.parse(`${dueDate}T00:00:00Z`) - Date.parse(`${todayKey}T00:00:00Z`)) / 86_400_000,
  );
  if (diffDays === 1) return "for tomorrow";
  const label = new Date(`${dueDate}T00:00:00Z`).toLocaleDateString("en-US", {
    weekday: "short", month: "short", day: "numeric", timeZone: "UTC",
  });
  return `for ${label}`;
}

export interface TodayPayload {
  count: number;
  message: string;
  /** title → task id, shaped for Shortcuts' native Choose from List (spec D6). */
  quests: Record<string, number>;
}

export function buildTodayPayload(rows: { id: number; title: string }[]): TodayPayload {
  const capped = rows.slice(0, TODAY_LIST_CAP);
  const quests: Record<string, number> = {};
  for (const row of capped) {
    // Duplicate titles get " (2)"-style suffixes; the while-loop also dodges
    // rows whose real title already ends in " (2)".
    let key = row.title;
    for (let n = 2; Object.hasOwn(quests, key); n++) key = `${row.title} (${n})`;
    quests[key] = row.id;
  }
  const message =
    capped.length === 0
      ? ALL_CLEAR_MESSAGE
      : rows.length > TODAY_LIST_CAP
        ? `Pick a quest to mark done (showing ${TODAY_LIST_CAP} of ${rows.length})`
        : "Pick a quest to mark done";
  return { count: capped.length, message, quests };
}
