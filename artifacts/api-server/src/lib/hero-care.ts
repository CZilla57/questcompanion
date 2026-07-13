// Hero care: hunger derived from time since the user's last completed quest.
// Stage is computed at read time from users.lastFedAt — never stored — so there
// is no state machine to corrupt and revival is automatic on the next feed.

export type HungerStage = "well_fed" | "peckish" | "hungry" | "starving" | "fainted";

const HOUR_MS = 60 * 60 * 1000;

// Half-open lower bounds in hours since lastFedAt, checked most-severe first.
const STAGE_BOUNDS: { stage: HungerStage; minHours: number }[] = [
  { stage: "fainted", minHours: 168 },
  { stage: "starving", minHours: 120 },
  { stage: "hungry", minHours: 72 },
  { stage: "peckish", minHours: 24 },
];

export function hungerStage(lastFedAt: Date, now: Date): HungerStage {
  const hours = (now.getTime() - lastFedAt.getTime()) / HOUR_MS;
  for (const { stage, minHours } of STAGE_BOUNDS) {
    if (hours >= minHours) return stage;
  }
  return "well_fed";
}

const MOOD_TEXT: Record<HungerStage, string> = {
  well_fed: "Content and ready for adventure",
  peckish: "Could use a hot meal",
  hungry: "Stomach growling loudly",
  starving: "Too weak to travel",
  fainted: "Has succumbed to hunger…",
};

export function moodFor(stage: HungerStage): string {
  return MOOD_TEXT[stage];
}

/** Deterministic 32-bit FNV-1a hash (always >= 0). Seeds vignette rotation and flavor-push timing. */
export function hashSeed(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

const WARNINGS: Partial<Record<HungerStage, { title: string; body: string }>> = {
  hungry: {
    title: "Your hero is hungry",
    body: "Their stomach is growling. Complete a quest to feed them!",
  },
  starving: {
    title: "Your hero is starving!",
    body: "Too weak to travel. One completed quest is a meal.",
  },
  fainted: {
    title: "Your hero has fainted 💫",
    body: "They've succumbed to hunger… Complete any quest to revive them.",
  },
};

/**
 * Push payload for a hunger warning, or null when none is due. Warns exactly
 * once per stage per hunger episode: `notifiedStage` is the stage last pushed
 * (users.hungerNotifiedStage), cleared when the hero is fed.
 */
export function hungerWarning(
  stage: HungerStage,
  notifiedStage: string | null,
): { title: string; body: string; tag: string } | null {
  const w = WARNINGS[stage];
  if (!w) return null;
  if (notifiedStage === stage) return null;
  return { ...w, tag: "hero-hunger" };
}

export const FLAVOR_MIN_GAP_MS = 48 * HOUR_MS;

/**
 * The one minute of this local day when a flavor push may fire for this user.
 * Seeded so the time feels organic but is stable for dedup. Hours 9..20.
 */
export function flavorCandidateMinute(userId: number, dateKey: string): { hour: number; minute: number } {
  const h = hashSeed(`${userId}:${dateKey}:flavor`);
  return { hour: 9 + (h % 12), minute: Math.floor(h / 12) % 60 };
}

/**
 * Ambient flavor pushes go only to heroes with a life to report (well_fed /
 * peckish — hungrier stages get warning pushes instead), at most one per 48h,
 * only on the seeded candidate minute. Uses server-local time like the rest of
 * the scheduler. Cadence ≈ every 2–3 days.
 */
export function shouldSendFlavorPush(args: {
  userId: number;
  stage: HungerStage;
  lastFlavorPushAt: Date | null;
  now: Date;
}): boolean {
  if (args.stage !== "well_fed" && args.stage !== "peckish") return false;
  if (args.lastFlavorPushAt && args.now.getTime() - args.lastFlavorPushAt.getTime() < FLAVOR_MIN_GAP_MS) {
    return false;
  }
  const y = args.now.getFullYear();
  const m = String(args.now.getMonth() + 1).padStart(2, "0");
  const d = String(args.now.getDate()).padStart(2, "0");
  const { hour, minute } = flavorCandidateMinute(args.userId, `${y}-${m}-${d}`);
  return args.now.getHours() === hour && args.now.getMinutes() === minute;
}
