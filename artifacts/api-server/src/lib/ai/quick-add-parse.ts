import type { ParsedQuickAdd, ParsedRecurrence, Frequency, MonthlyMode } from "@workspace/quick-add";
import { isValidDueDate, isValidDueTime } from "../task-datetime";

const PRIORITIES = new Set(["low", "medium", "high"]);

const FREQUENCIES = new Set<Frequency>(["weekly", "monthly", "yearly"]);
const MONTHLY_MODES = new Set<MonthlyMode>(["day_of_month", "nth_weekday"]);

function inRangeInt(n: unknown, lo: number, hi: number): n is number {
  return typeof n === "number" && Number.isInteger(n) && n >= lo && n <= hi;
}

/** Validate a model-produced recurrence; return undefined (distrust the whole
 *  thing) if any field is malformed, matching the per-field posture elsewhere. */
function validateRecurrence(raw: unknown): ParsedRecurrence | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const o = raw as Record<string, unknown>;
  if (typeof o.frequency !== "string" || !FREQUENCIES.has(o.frequency as Frequency)) return undefined;
  const r: ParsedRecurrence = { frequency: o.frequency as Frequency };

  if (o.daysOfWeek !== undefined) {
    if (!Array.isArray(o.daysOfWeek) || !o.daysOfWeek.every((n) => inRangeInt(n, 0, 6))) return undefined;
    if (o.daysOfWeek.length) r.daysOfWeek = Array.from(new Set(o.daysOfWeek as number[])).sort((a, b) => a - b);
  }
  if (o.monthlyMode !== undefined) {
    if (typeof o.monthlyMode !== "string" || !MONTHLY_MODES.has(o.monthlyMode as MonthlyMode)) return undefined;
    r.monthlyMode = o.monthlyMode as MonthlyMode;
  }
  if (o.dayOfMonth !== undefined) {
    if (!inRangeInt(o.dayOfMonth, 1, 31)) return undefined;
    r.dayOfMonth = o.dayOfMonth;
  }
  if (o.weekOfMonth !== undefined) {
    if (!inRangeInt(o.weekOfMonth, 1, 4)) return undefined;
    r.weekOfMonth = o.weekOfMonth;
  }
  if (o.monthOfYear !== undefined) {
    if (!inRangeInt(o.monthOfYear, 1, 12)) return undefined;
    r.monthOfYear = o.monthOfYear;
  }
  return r;
}

export class QuickAddParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "QuickAddParseError";
  }
}

function isoDate(now: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}`;
}

const WEEKDAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

export function buildQuickAddPrompt(text: string, opts: { now: Date }): string {
  const today = isoDate(opts.now);
  const weekday = WEEKDAY_NAMES[opts.now.getDay()];
  return `You convert one line of natural language into a structured to-do task.
Today is ${today} (${weekday}) in the user's local time. Resolve relative phrases like "next week" or "friday" against that.

The user's line:
"${text}"

Extract these fields, omitting any you cannot confidently determine:
- title: the task itself, with date/time/hashtag/priority words removed
- dueDate: YYYY-MM-DD, if any date is implied
- dueTime: HH:mm 24-hour, if a time of day is implied
- priority: one of low, medium, high, if implied
- recurrence: only if the task repeats. An object {frequency, daysOfWeek, monthlyMode, dayOfMonth, weekOfMonth, monthOfYear}. frequency is one of weekly, monthly, yearly (there is no "daily" — a daily task is weekly with daysOfWeek [0,1,2,3,4,5,6]). daysOfWeek uses 0=Sunday..6=Saturday. For a monthly rule use monthlyMode "day_of_month" with dayOfMonth 1-31, or "nth_weekday" with weekOfMonth 1-4 and a single entry in daysOfWeek. For yearly also set monthOfYear 1-12. Omit recurrence entirely for one-off tasks.

Respond with JSON only, no prose, in exactly this shape:
{"title": "...", "dueDate": "...", "dueTime": "...", "priority": "...", "recurrence": {"frequency": "..."}}`;
}

export function parseQuickAddResult(raw: unknown, fallback: { text: string }): ParsedQuickAdd {
  if (!raw || typeof raw !== "object") {
    throw new QuickAddParseError("Model output was not a JSON object");
  }
  const o = raw as Record<string, unknown>;

  const title =
    typeof o.title === "string" && o.title.trim() ? o.title.trim() : fallback.text.trim();
  const result: ParsedQuickAdd = { title };

  if (typeof o.dueDate === "string" && isValidDueDate(o.dueDate)) result.dueDate = o.dueDate;
  if (typeof o.dueTime === "string" && isValidDueTime(o.dueTime)) result.dueTime = o.dueTime;
  if (typeof o.priority === "string" && PRIORITIES.has(o.priority)) {
    result.priority = o.priority as ParsedQuickAdd["priority"];
  }
  const recurrence = validateRecurrence(o.recurrence);
  if (recurrence) result.recurrence = recurrence;
  return result;
}
