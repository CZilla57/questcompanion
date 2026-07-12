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

export function parseQuickAdd(input: string, opts: { now: Date }): ParsedQuickAdd {
  void opts; // dates/times added in later tasks
  const p = extractPriority(input);
  const h = extractHashtag(p.rest);

  const result: ParsedQuickAdd = { title: cleanTitle(h.rest) };
  if (p.value) result.priority = p.value;
  if (h.value) result.category = h.value;
  return result;
}
