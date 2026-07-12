// The 9 canonical category slugs (mirrors lib/db and the server's auto-points).
export const CATEGORY_SLUGS = [
  "health", "deep_work", "learning", "finance",
  "admin", "household", "social", "creative", "default",
] as const;

const SLUG_SET = new Set<string>(CATEGORY_SLUGS);

// #tag word (lower-case, no '#') -> canonical slug. Seeded with common synonyms
// so hashtags work without a full tags system. Each canonical slug maps to itself.
export const CATEGORY_ALIASES: Record<string, string> = {
  work: "deep_work", job: "deep_work", office: "deep_work", focus: "deep_work",
  chore: "household", chores: "household", home: "household", house: "household",
  gym: "health", workout: "health", run: "health", fitness: "health",
  money: "finance", bills: "finance", budget: "finance",
  study: "learning", read: "learning", reading: "learning", learn: "learning",
  errand: "admin", errands: "admin", paperwork: "admin",
  friends: "social", family: "social", call: "social",
  art: "creative", draw: "creative", music: "creative",
};

/** Resolve a hashtag word to a canonical category slug, or undefined if unknown. */
export function resolveHashtag(word: string): string | undefined {
  const w = word.toLowerCase();
  if (CATEGORY_ALIASES[w]) return CATEGORY_ALIASES[w];
  if (SLUG_SET.has(w)) return w;
  return undefined;
}
