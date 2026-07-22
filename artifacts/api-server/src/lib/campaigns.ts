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

/** Claimable only while running, holding at least one chapter, all chapters done,
 * and never already paid out. The last clause is belt-and-braces: canTransition
 * already stops a completed campaign from being reopened, but a campaign should
 * never be claimable twice even if that guard is ever bypassed or removed. */
export function isCampaignReadyToClaim(
  campaign: { status: string; rewardXpAwarded: number | null },
  progress: { total: number; done: number },
): boolean {
  return (
    campaign.status === "running" &&
    campaign.rewardXpAwarded == null &&
    progress.total >= 1 &&
    progress.done === progress.total
  );
}

const KNOWN_CAMPAIGN_STATUSES = new Set(["running", "set_aside", "completed"]);

/** Pure state-machine guard for PATCH /campaigns/:id. `completed` is TERMINAL —
 * once claimed, a campaign can never move to any other status again (that is
 * exactly the reopen-and-reclaim exploit this closes). `running` and
 * `set_aside` freely swap. A no-op (same status, including completed ->
 * completed) is always allowed, since editing title/premise/beat shouldn't be
 * blocked just because a status field happened to be echoed back unchanged.
 * Unknown statuses on either side are always rejected. */
export function canTransition(from: string, to: string): boolean {
  if (!KNOWN_CAMPAIGN_STATUSES.has(from) || !KNOWN_CAMPAIGN_STATUSES.has(to)) return false;
  if (from === to) return true;
  if (from === "completed") return false;
  return (from === "running" && to === "set_aside") || (from === "set_aside" && to === "running");
}

/** Trim and clamp a string to a max length, shared by every title/premise/beat
 * field so server limits agree with the OpenAPI contract in one place. */
export function clampString(value: string, maxLength: number): string {
  const trimmed = value.trim();
  return trimmed.length > maxLength ? trimmed.slice(0, maxLength) : trimmed;
}

export type StringOrNullResult = { ok: true; value: string | null } | { ok: false };

/** Validate+clamp an unknown request value that must be a string or null/absent
 * (arcPremise, endingBeat, chapter beat). Guards against the type-confusion bug
 * where a number or object silently reaches drizzle's text column, or throws
 * on `.trim()`. */
export function validateStringOrNull(value: unknown, maxLength: number): StringOrNullResult {
  if (value === undefined || value === null) return { ok: true, value: null };
  if (typeof value !== "string") return { ok: false };
  return { ok: true, value: clampString(value, maxLength) };
}

export type QuestlineIdsResult = { ok: true; ids: number[] } | { ok: false; error: string };

/** Validate the reorder-chapters payload: must be an array of positive integers,
 * capped at maxLength (the same MAX_CHAPTERS the create path already enforces).
 * `1.5` and unbounded arrays are both rejected here rather than silently
 * accepted into a huge in-transaction update loop. */
export function validateQuestlineIds(raw: unknown, maxLength: number): QuestlineIdsResult {
  if (!Array.isArray(raw)) {
    return { ok: false, error: "questlineIds must be an array of integers" };
  }
  if (raw.length > maxLength) {
    return { ok: false, error: `questlineIds cannot exceed ${maxLength} chapters` };
  }
  const ids: number[] = [];
  for (const v of raw) {
    if (typeof v !== "number" || !Number.isInteger(v) || v <= 0) {
      return { ok: false, error: "questlineIds must be an array of integers" };
    }
    ids.push(v);
  }
  return { ok: true, ids };
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

export type AttachDecision =
  | { ok: true }
  | { ok: false; reason: "different_campaign" }
  | { ok: false; reason: "completed_campaign" };

/** ATTACH guard for PATCH /questlines/:id — the second door into campaign
 * membership (the first is PATCH /campaigns/:id/chapters). One campaign per
 * questline, EVER: attaching is allowed only when the questline currently
 * belongs to no campaign (or is already in the target one — a no-op resend).
 * Attaching to a DIFFERENT campaign while already claimed by one is refused
 * so a completed questline can never be recycled through a second campaign
 * for unlimited XP. Attaching into a campaign that is itself already
 * COMPLETED is refused too, with no no-op exception — that mirrors
 * PATCH /campaigns/:id/chapters, which refuses to touch a completed
 * campaign's chapter list at all, so the two doors never disagree about
 * whether a paid chronicle entry can be edited. */
export function decideAttachToCampaign(
  currentCampaignId: number | null,
  targetCampaignId: number,
  targetCampaignStatus: string,
): AttachDecision {
  if (targetCampaignStatus === "completed") return { ok: false, reason: "completed_campaign" };
  if (currentCampaignId != null && currentCampaignId !== targetCampaignId) {
    return { ok: false, reason: "different_campaign" };
  }
  return { ok: true };
}

/** DETACH guard for PATCH /questlines/:id. Mirrors the same rule enforced on
 * PATCH /campaigns/:id/chapters: a completed campaign's chapters are part of
 * its record and may never be detached — that, together with the attach
 * guard above, means a claimed chapter can never be freed up to be claimed
 * again in a different campaign. */
export function canDetachFromCampaign(currentCampaignStatus: string): boolean {
  return currentCampaignStatus !== "completed";
}

export type ChapterOrderResult = { ok: true; value: number | null } | { ok: false };

/** Validate `chapterOrder` on PATCH /questlines/:id: a non-negative integer,
 * or null. Guards the same type-confusion 500 as the other validators here —
 * `1.5` or `"x"` reaching drizzle's integer column straight from the body. */
export function validateChapterOrder(value: unknown): ChapterOrderResult {
  if (value === null) return { ok: true, value: null };
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0) return { ok: false };
  return { ok: true, value };
}

/** True when the request both detaches (`campaignId: null`) and supplies an
 * explicit `chapterOrder` — a contradictory combination that used to leave a
 * stray order on a freshly-detached questline (the detach clear ran first,
 * then this unconditionally overwrote it). Rejected as a single 400 instead
 * of silently picking a winner. */
export function detachConflictsWithChapterOrder(
  campaignId: number | null | undefined,
  chapterOrder: number | null | undefined,
): boolean {
  return campaignId === null && chapterOrder !== undefined;
}

export type TitleResult = { ok: true; value: string } | { ok: false };

/** Type-check + trim a required title field (questline or campaign title).
 * Guards the same type-confusion 500 as validateStringOrNull — `.trim()` on
 * a non-string throws — for the one field that is required rather than
 * optional. */
export function validateTitle(value: unknown): TitleResult {
  if (typeof value !== "string") return { ok: false };
  const trimmed = value.trim();
  if (!trimmed) return { ok: false };
  return { ok: true, value: trimmed };
}

export type OptionalStringResult = { ok: true; value: string | null } | { ok: false };

/** Type-check (no length cap — the contract declares none for these fields)
 * an unknown value that must be a string or null/absent: questline
 * description and color. Same type-confusion guard as validateStringOrNull,
 * for fields with no declared max length to clamp to. */
export function validateOptionalString(value: unknown): OptionalStringResult {
  if (value === undefined || value === null) return { ok: true, value: null };
  if (typeof value !== "string") return { ok: false };
  return { ok: true, value };
}
