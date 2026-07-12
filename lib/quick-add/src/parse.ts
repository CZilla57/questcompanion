import type { ParsedQuickAdd, Priority } from "./types";
import { resolveHashtag } from "./categories";

const PRIORITY_ALIASES: Record<string, Priority> = {
  high: "high", hi: "high", h: "high",
  medium: "medium", med: "medium", m: "medium",
  low: "low", lo: "low", l: "low",
};

interface Field<T> { value?: T; rest: string; }

function extractPriority(text: string): Field<Priority> {
  let value: Priority | undefined;
  const rest = text.replace(/!([a-z]+)/gi, (whole, word: string) => {
    const p = PRIORITY_ALIASES[word.toLowerCase()];
    if (p) { value = p; return " "; } // last match wins
    return whole;                     // unknown !word stays in the title
  });
  return { value, rest };
}

function extractHashtag(text: string): Field<string> {
  let value: string | undefined;
  const rest = text.replace(/#(\w+)/g, (_whole, word: string) => {
    const slug = resolveHashtag(word);
    if (slug) value = slug;           // last known match wins; unknown still stripped
    return " ";
  });
  return { value, rest };
}

function cleanTitle(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function pad(n: number): string { return String(n).padStart(2, "0"); }

function extractTime(text: string): Field<string> {
  let value: string | undefined;
  let rest = text;

  // 12-hour: 3pm, 3:30pm, at 9 am
  rest = rest.replace(/\b(?:at\s+)?(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b/i,
    (whole, h: string, min: string | undefined, ap: string) => {
      let hour = parseInt(h, 10);
      if (hour < 1 || hour > 12) return whole;
      hour = hour % 12;
      if (ap.toLowerCase() === "pm") hour += 12;
      value = `${pad(hour)}:${pad(min ? parseInt(min, 10) : 0)}`;
      return " ";
    });

  // Word times
  if (value === undefined) {
    rest = rest.replace(/\b(noon|midnight)\b/i, (_whole, w: string) => {
      value = w.toLowerCase() === "noon" ? "12:00" : "00:00";
      return " ";
    });
  }

  // 24-hour: 15:00
  if (value === undefined) {
    rest = rest.replace(/\b(?:at\s+)?([01]?\d|2[0-3]):([0-5]\d)\b/,
      (_whole, h: string, min: string) => {
        value = `${pad(parseInt(h, 10))}:${min}`;
        return " ";
      });
  }

  return { value, rest };
}

export function parseQuickAdd(input: string, opts: { now: Date }): ParsedQuickAdd {
  void opts; // dates added in Task 4
  const p = extractPriority(input);
  const h = extractHashtag(p.rest);
  const t = extractTime(h.rest);

  const result: ParsedQuickAdd = { title: cleanTitle(t.rest) };
  if (t.value) result.dueTime = t.value;
  if (p.value) result.priority = p.value;
  if (h.value) result.category = h.value;
  return result;
}
