// Curated companion voice. Deterministic, anti-shame by construction: rest reads
// as rest, returns are warm, never a word of guilt. Picked from (userId, 3h bucket)
// like hero-flavor vignettes — stable within a bucket, rotates on its own.
import { hashSeed } from "./hero-care";
import type { CompanionBeat } from "./companion";

const BUCKET_MS = 3 * 60 * 60 * 1000;

// Act III (Living World): the companion's disposition flavors its voice.
// `warm` is the original tone and the default, so every existing user reads
// exactly as before; `wry` and `stoic` are opt-in personalities. Disposition
// only recolors the personality moments (ambient greeting + crit/fail) — the
// situational lines (welcome-back, rest, milestones, tier/level) stay shared.
export type Disposition = "warm" | "wry" | "stoic";
export const DISPOSITIONS: readonly Disposition[] = ["warm", "wry", "stoic"];

export function isDisposition(v: unknown): v is Disposition {
  return typeof v === "string" && (DISPOSITIONS as readonly string[]).includes(v);
}

/** Fall back to the warm default for a null/unknown disposition. */
function asDisposition(v: string | null | undefined): Disposition {
  return isDisposition(v) ? v : "warm";
}

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

// Ambient greeting (warm) warms with the bond tier (index = tier 0..4).
const AMBIENT_BY_TIER: string[][] = [
  ["Glad to be adventuring with you.", "Off to a good start, you and I."],
  ["Always good to have you around.", "You and me — a solid team."],
  ["We've been through a lot together, haven't we?", "Steady as ever, my friend."],
  ["Kindred spirits, you and I.", "I'd follow you on any quest."],
  ["Legends are written by pairs like us.", "After all this, we're the stuff of stories."],
];
// Wry / stoic ambient: flat pools (tone over tier). Teasing but never at the
// user's expense; spare but never cold.
const AMBIENT_WRY = [
  "You again. Good — I was getting bored.",
  "Two of us against that to-do list. Poor list.",
  "Let's go make the calendar nervous.",
];
const AMBIENT_STOIC = [
  "Steady. One thing, then the next.",
  "I'm here. Take the next step when you're ready.",
  "The path holds. Let's walk it.",
];

function pick(pool: string[], userId: number, now: Date, salt: string): string {
  const bucket = Math.floor(now.getTime() / BUCKET_MS);
  return pool[hashSeed(`${userId}:${bucket}:${salt}`) % pool.length]!;
}

export function companionLine(
  beat: CompanionBeat,
  args: { userId: number; now: Date; disposition?: string | null },
): string {
  const disposition = asDisposition(args.disposition);
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
      if (disposition === "wry") return pick(AMBIENT_WRY, args.userId, args.now, "ambient:wry");
      if (disposition === "stoic") return pick(AMBIENT_STOIC, args.userId, args.now, "ambient:stoic");
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
// stays a genuine spike, never routine. `warm` is the original wording.
const CRIT_BY_DISPOSITION: Record<Disposition, string[]> = {
  warm: [
    "A critical strike! I'll be retelling that one for weeks. ⚔️",
    "Now THAT was legendary — nailed it! ✨",
    "Perfect roll. You made that look easy.",
  ],
  wry: [
    "Oh, showing off now? A critical hit. Noted. ✨",
    "A nat-20-shaped flex. I'll allow it.",
    "Critical. Try not to let it go to your head — actually, do.",
  ],
  stoic: [
    "A clean strike. Well struck.",
    "That landed true. Onward.",
    "Precision. That's what the practice buys.",
  ],
};
// The low band, reframed: affirms the quest is done in full, credits the effort,
// and never blames. Anti-shame by construction — no "fail", no guilt. Every
// disposition keeps that contract; only the tone shifts.
const FAIL_BY_DISPOSITION: Record<Disposition, string[]> = {
  warm: [
    "That one dug its heels in — and you finished it anyway. That's the real win.",
    "A stubborn quest. You saw it through all the same — I'm impressed.",
    "Tough going, but it's done. Catch your breath, then onward.",
  ],
  wry: [
    "That one bared its teeth. You did it anyway — typical.",
    "Rolled low, finished high. The dice clearly weren't paying attention.",
    "Ugly roll, clean finish. We don't talk about the dice.",
  ],
  stoic: [
    "The dice ran cold. The work still stands — that's what counts.",
    "A hard roll. You finished it. That is enough.",
    "Fortune wavered; you did not. Done is done.",
  ],
};

export function companionReactionLine(
  kind: "bond_tier_up" | "leveled_up" | "crit" | "fail",
  args: { userId: number; now: Date; bondTierName?: string; newLevel?: number; disposition?: string | null },
): string {
  const disposition = asDisposition(args.disposition);
  switch (kind) {
    case "bond_tier_up":
      return pick(BOND_TIER_UP, args.userId, args.now, "tierup").replace("{tier}", args.bondTierName ?? "closer");
    case "leveled_up":
      return pick(LEVELED_UP, args.userId, args.now, "levelup").replace("{n}", String(args.newLevel ?? ""));
    case "crit":
      return pick(CRIT_BY_DISPOSITION[disposition], args.userId, args.now, `crit:${disposition}`);
    case "fail":
      return pick(FAIL_BY_DISPOSITION[disposition], args.userId, args.now, `fail:${disposition}`);
  }
}
