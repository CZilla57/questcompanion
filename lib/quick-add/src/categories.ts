// The 12 canonical category slugs (mirrors lib/db and the server's auto-points).
export const CATEGORY_SLUGS = [
  "health", "deep_work", "learning", "finance",
  "admin", "household", "social", "creative",
  "self_care", "errands", "travel", "default",
] as const;

const SLUG_SET = new Set<string>(CATEGORY_SLUGS);

// #tag word (lower-case, no '#') -> canonical slug. Seeded with common synonyms
// so hashtags work without a full tags system. Each canonical slug maps to itself.
export const CATEGORY_ALIASES: Record<string, string> = {
  work: "deep_work", job: "deep_work", office: "deep_work", focus: "deep_work", code: "deep_work",
  chore: "household", chores: "household", home: "household", house: "household", clean: "household",
  gym: "health", workout: "health", run: "health", fitness: "health",
  money: "finance", bills: "finance", bill: "finance", budget: "finance",
  study: "learning", read: "learning", reading: "learning", learn: "learning",
  errand: "errands", errands: "errands", groceries: "errands", grocery: "errands", shopping: "errands", shop: "errands",
  paperwork: "admin", email: "admin", admin: "admin",
  friends: "social", family: "social", call: "social",
  art: "creative", draw: "creative", music: "creative",
  selfcare: "self_care", meditate: "self_care", meditation: "self_care", journal: "self_care", mindfulness: "self_care", wellness: "self_care",
  travel: "travel", trip: "travel", flight: "travel", vacation: "travel", holiday: "travel",
};

/** Resolve a hashtag word to a canonical category slug, or undefined if unknown. */
export function resolveHashtag(word: string): string | undefined {
  const w = word.toLowerCase();
  if (CATEGORY_ALIASES[w]) return CATEGORY_ALIASES[w];
  if (SLUG_SET.has(w)) return w;
  return undefined;
}
