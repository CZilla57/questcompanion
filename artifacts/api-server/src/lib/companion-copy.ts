// Curated companion voice. Deterministic, anti-shame by construction: rest reads
// as rest, returns are warm, never a word of guilt. Picked from (userId, 3h bucket)
// like hero-flavor vignettes — stable within a bucket, rotates on its own.
import { hashSeed } from "./hero-care";
import type { CompanionBeat } from "./companion";

const BUCKET_MS = 3 * 60 * 60 * 1000;

const WELCOME_BACK = [
  "There you are — I kept the campfire warm. 🔥",
  "Welcome back, friend. Ready when you are, no rush.",
  "Good to see you again. Let's pick up right where we left off.",
  "You're back! I saved the good stories for you.",
];

const REST_DAY = [
  "Resting up? Smart — even heroes need a quiet day.",
  "A well-earned breather. I'll be right here when you're ready.",
  "Taking it easy today. That's part of the journey too.",
];

const STREAK_MILESTONE = [
  "{n} days running — proud to adventure with you! 🔥",
  "{n}-day streak! We're unstoppable lately.",
  "That's {n} days in a row. Look at us go!",
];

// Ambient greeting warms with the bond tier (index = tier 0..4).
const AMBIENT_BY_TIER: string[][] = [
  ["Glad to be adventuring with you.", "Off to a good start, you and I."],
  ["Always good to have you around.", "You and me — a solid team."],
  ["We've been through a lot together, haven't we?", "Steady as ever, my friend."],
  ["Kindred spirits, you and I.", "I'd follow you on any quest."],
  ["Legends are written by pairs like us.", "After all this, we're the stuff of stories."],
];

function pick(pool: string[], userId: number, now: Date, salt: string): string {
  const bucket = Math.floor(now.getTime() / BUCKET_MS);
  return pool[hashSeed(`${userId}:${bucket}:${salt}`) % pool.length]!;
}

export function companionLine(beat: CompanionBeat, args: { userId: number; now: Date }): string {
  switch (beat.kind) {
    case "quiet":
      return "";
    case "welcome_back":
      return pick(WELCOME_BACK, args.userId, args.now, "welcome_back");
    case "rest_day":
      return pick(REST_DAY, args.userId, args.now, "rest_day");
    case "streak_milestone":
      return pick(STREAK_MILESTONE, args.userId, args.now, "streak").replace("{n}", String(beat.streakDays));
    case "ambient": {
      const tier = Math.min(Math.max(beat.bondTier, 0), AMBIENT_BY_TIER.length - 1);
      return pick(AMBIENT_BY_TIER[tier]!, args.userId, args.now, `ambient:${tier}`);
    }
  }
}

const BOND_TIER_UP = [
  "Our bond deepens — we're {tier} now. ❤️",
  "{tier}. After everything, that feels right.",
];
const LEVELED_UP = [
  "Level {n}! I always knew you had it in you.",
  "Level {n} — onward, together!",
];
// The companion cheering the roll's high band. Reserved for the rare crit so it
// stays a genuine spike, never routine.
const CRIT = [
  "A critical strike! I'll be retelling that one for weeks. ⚔️",
  "Now THAT was legendary — nailed it! ✨",
  "Perfect roll. You made that look easy.",
];
// The low band, reframed: affirms the quest is done in full, credits the effort,
// and never blames. Anti-shame by construction — no "fail", no guilt.
const FAIL = [
  "That one dug its heels in — and you finished it anyway. That's the real win.",
  "A stubborn quest. You saw it through all the same — I'm impressed.",
  "Tough going, but it's done. Catch your breath, then onward.",
];

export function companionReactionLine(
  kind: "bond_tier_up" | "leveled_up" | "crit" | "fail",
  args: { userId: number; now: Date; bondTierName?: string; newLevel?: number },
): string {
  switch (kind) {
    case "bond_tier_up":
      return pick(BOND_TIER_UP, args.userId, args.now, "tierup").replace("{tier}", args.bondTierName ?? "closer");
    case "leveled_up":
      return pick(LEVELED_UP, args.userId, args.now, "levelup").replace("{n}", String(args.newLevel ?? ""));
    case "crit":
      return pick(CRIT, args.userId, args.now, "crit");
    case "fail":
      return pick(FAIL, args.userId, args.now, "fail");
  }
}
