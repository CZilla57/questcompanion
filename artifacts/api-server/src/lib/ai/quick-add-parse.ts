import type { ParsedQuickAdd } from "@workspace/quick-add";
import { isValidDueDate, isValidDueTime } from "../task-datetime";

const PRIORITIES = new Set(["low", "medium", "high"]);

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

Respond with JSON only, no prose, in exactly this shape:
{"title": "...", "dueDate": "...", "dueTime": "...", "priority": "..."}`;
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
  return result;
}
