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
  rest = rest.replace(/\b(?:at\s+)?(\d{1,2})(?::([0-5]\d))?\s*(am|pm)\b/i,
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

const WEEKDAYS: Record<string, number> = {
  sunday: 0, sun: 0, monday: 1, mon: 1, tuesday: 2, tues: 2, tue: 2,
  wednesday: 3, weds: 3, wed: 3, thursday: 4, thurs: 4, thur: 4, thu: 4,
  friday: 5, fri: 5, saturday: 6, sat: 6,
};

const MONTHS: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
  jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
};

function ymd(d: Date): string { return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; }
function atMidnight(now: Date): Date { return new Date(now.getFullYear(), now.getMonth(), now.getDate()); }
function addDays(base: Date, n: number): Date { const r = new Date(base); r.setDate(r.getDate() + n); return r; }
function isRealDate(y: number, m: number, d: number): boolean {
  const dt = new Date(y, m - 1, d);
  return dt.getFullYear() === y && dt.getMonth() === m - 1 && dt.getDate() === d;
}
// For M/D and month-name with no year: this year, or next year if already past.
function futureYear(base: Date, m: number, d: number): number {
  const y = base.getFullYear();
  return isRealDate(y, m, d) && new Date(y, m - 1, d) < base ? y + 1 : y;
}

function extractDate(text: string, now: Date): Field<string> {
  let value: string | undefined;
  let rest = text;
  const base = atMidnight(now);
  const set = (d: string) => { value = d; return " "; };

  // ISO YYYY-MM-DD
  rest = rest.replace(/\b(\d{4})-(\d{2})-(\d{2})\b/, (whole, y, mo, d) =>
    isRealDate(+y, +mo, +d) ? set(ymd(new Date(+y, +mo - 1, +d))) : whole);

  // Numeric M/D or M/D/Y
  if (value === undefined) {
    rest = rest.replace(/\b(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\b/, (whole, mo, d, y) => {
      const M = +mo, D = +d;
      const Y = y ? (+y < 100 ? 2000 + +y : +y) : futureYear(base, M, D);
      return isRealDate(Y, M, D) ? set(ymd(new Date(Y, M - 1, D))) : whole;
    });
  }

  // Month name before day: "Jul 15"
  if (value === undefined) {
    rest = rest.replace(/\b([a-z]{3,9})\s+(\d{1,2})\b/i, (whole, mon, d) => {
      const M = MONTHS[mon.slice(0, 3).toLowerCase()];
      if (!M) return whole;
      const D = +d, Y = futureYear(base, M, D);
      return isRealDate(Y, M, D) ? set(ymd(new Date(Y, M - 1, D))) : whole;
    });
  }
  // Day before month name: "15 Jul"
  if (value === undefined) {
    rest = rest.replace(/\b(\d{1,2})\s+([a-z]{3,9})\b/i, (whole, d, mon) => {
      const M = MONTHS[mon.slice(0, 3).toLowerCase()];
      if (!M) return whole;
      const D = +d, Y = futureYear(base, M, D);
      return isRealDate(Y, M, D) ? set(ymd(new Date(Y, M - 1, D))) : whole;
    });
  }

  // in N days / in N weeks
  if (value === undefined) {
    rest = rest.replace(/\bin\s+(\d+)\s+(days?|weeks?)\b/i, (_whole, n, unit) =>
      set(ymd(addDays(base, +n * (unit.toLowerCase().startsWith("week") ? 7 : 1)))));
  }

  // Relative words
  if (value === undefined) {
    rest = rest.replace(/\b(today|tonight|tomorrow|tmr|tmrw)\b/i, (_whole, w) => {
      const lw = w.toLowerCase();
      const n = lw === "tomorrow" || lw === "tmr" || lw === "tmrw" ? 1 : 0;
      return set(ymd(addDays(base, n)));
    });
  }

  // Weekday, optionally "next"
  if (value === undefined) {
    rest = rest.replace(
      /\b(next\s+)?(sunday|sun|saturday|sat|monday|mon|tuesday|tues|tue|wednesday|weds|wed|thursday|thurs|thur|thu|friday|fri)\b/i,
      (_whole, next, name) => {
        const target = WEEKDAYS[name.toLowerCase()];
        let delta = (target - base.getDay() + 7) % 7;
        if (delta === 0) delta = 7; // bare weekday excludes today
        if (next) delta += 7;       // "next <weekday>" = the following week
        return set(ymd(addDays(base, delta)));
      });
  }

  return { value, rest };
}

export function parseQuickAdd(input: string, opts: { now: Date }): ParsedQuickAdd {
  const p = extractPriority(input);
  const h = extractHashtag(p.rest);
  const d = extractDate(h.rest, opts.now);
  const t = extractTime(d.rest);

  const result: ParsedQuickAdd = { title: cleanTitle(t.rest) };
  if (d.value) result.dueDate = d.value;
  if (t.value) result.dueTime = t.value;
  if (p.value) result.priority = p.value;
  if (h.value) result.category = h.value;
  return result;
}
