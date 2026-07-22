// Act VI Quest Campaigns: the tier above questlines. Pure — no I/O.
// Mirrors lib/questlines.ts in style and in its central rule: readiness is
// DERIVED from the chapters, never stored on the row.

/** 50 XP per chapter, capped at 5 chapters. Deliberately modest: the same work
 * already pays per-quest XP and a per-questline claim (up to 200). */
export const CAMPAIGN_XP_PER_CHAPTER = 50;
export const CAMPAIGN_XP_CHAPTER_CAP = 5;

/** Roll up chapter (questline) completion counts for a campaign. */
export function computeCampaignProgress(
  chapters: { status: string }[],
): { total: number; done: number } {
  const total = chapters.length;
  const done = chapters.reduce((n, c) => n + (c.status === "completed" ? 1 : 0), 0);
  return { total, done };
}

/** Claimable only while running, holding at least one chapter, all chapters done. */
export function isCampaignReadyToClaim(
  campaign: { status: string },
  progress: { total: number; done: number },
): boolean {
  return campaign.status === "running" && progress.total >= 1 && progress.done === progress.total;
}

/** One-time payout. Clamped at zero — XP monotonicity is a standing guard. */
export function computeCampaignRewardXp(chapterCount: number): number {
  const chapters = Math.max(0, Math.min(chapterCount, CAMPAIGN_XP_CHAPTER_CAP));
  return chapters * CAMPAIGN_XP_PER_CHAPTER;
}

/** The "current chapter" pointer: first not-completed chapter in story order.
 * Chapters with a null order sort last so an unordered adoptee never hijacks it.
 * This drives display only — chapters are ORDERED BUT NEVER GATED. */
export function nextChapter<T extends { status: string; chapterOrder: number | null }>(
  chapters: T[],
): T | null {
  const pending = chapters.filter((c) => c.status !== "completed");
  if (pending.length === 0) return null;
  const sorted = [...pending].sort((a, b) => {
    const ao = a.chapterOrder ?? Number.MAX_SAFE_INTEGER;
    const bo = b.chapterOrder ?? Number.MAX_SAFE_INTEGER;
    return ao - bo;
  });
  return sorted[0] ?? null;
}

/** Normalize an ordered id list to dense zero-based positions. Used by reorder,
 * detach, and delete so two rows can never disagree about position. */
export function renumber(orderedIds: number[]): { id: number; chapterOrder: number }[] {
  const seen = new Set<number>();
  const unique = orderedIds.filter((id) => (seen.has(id) ? false : (seen.add(id), true)));
  return unique.map((id, i) => ({ id, chapterOrder: i }));
}
