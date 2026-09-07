import { containsGuiltLanguage, type GenerateJson } from "./reflection";
import { chipLabel } from "../chip-labels";
import type { WeekStats } from "@workspace/db";

export const MAX_NARRATIVE_LENGTH = 600;

const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

export function buildRecapPrompt(stats: WeekStats): string {
  const facts: string[] = [];
  if (stats.questsCompleted > 0) {
    const sample = stats.sampleQuestTitles.length > 0
      ? ` (e.g. ${stats.sampleQuestTitles.map((t) => `"${t}"`).join(", ")})`
      : "";
    facts.push(`Quests completed: ${stats.questsCompleted}${sample}`);
  }
  if (stats.focusMinutes > 0) facts.push(`Focused minutes: ${stats.focusMinutes} across ${stats.focusSessions} session(s)`);
  if (stats.xpEarned > 0) facts.push(`XP earned: ${stats.xpEarned}`);
  if (stats.coinsEarned > 0) facts.push(`Coins earned: ${stats.coinsEarned}`);
  if (stats.initiations > 0) facts.push(`Times they got themselves started (the hardest part with ADHD): ${stats.initiations}`);
  if (stats.levelUps > 0) facts.push(`Level-ups: ${stats.levelUps}`);
  if (stats.badges.length > 0) facts.push(`Badges earned: ${stats.badges.join(", ")}`);
  if (stats.questlinesCompleted.length > 0) facts.push(`Questlines completed: ${stats.questlinesCompleted.join(", ")}`);
  if (stats.boss) {
    facts.push(`World Boss: dealt ${stats.boss.damage} damage in ${stats.boss.attacks} attack(s)${stats.boss.defeated ? " — the boss FELL this week" : ""}`);
  }
  if (stats.rhythms) {
    if (stats.rhythms.powerHours.length > 0) facts.push(`Historically strong hours (24h local): ${stats.rhythms.powerHours.join(", ")}`);
    if (stats.rhythms.bestDay != null) facts.push(`Historically strongest day: ${DAY_NAMES[stats.rhythms.bestDay]}`);
    if (stats.rhythms.topHelpers.length > 0) facts.push(`Things that usually help them: ${stats.rhythms.topHelpers.map(chipLabel).join(", ")}`);
  }

  return `You are a warm tabletop Dungeon Master writing a SHORT "session summary" — the past week of this player's campaign, in 2-3 sentences — for a person with ADHD, based on last week's wins below.

Hard rules — every one is mandatory:
- Celebrate what they DID, in a grounded tabletop-adventure voice. NEVER mention unfinished, remaining, missed, or planned work — you know nothing beyond the facts below, and you never invent a quest, foe, or deed the facts don't state.
- NEVER compare this week to any other week — no trend language of any kind.
- Warm, specific, zero pressure, no advice, no praise inflation. DM flavor, never purple prose.
- At most ${MAX_NARRATIVE_LENGTH} characters. Plain prose, no lists, no emoji.
- Never use guilt words (should, didn't, missed, failed, behind, only, just).

Last week's facts:
${facts.join("\n")}

Respond with JSON only, in this exact shape: {"narrative": "..."}`;
}

// DM "session summary" openers/closers — deliberately avoid every word in the
// guilt regex, matching the recap's Dungeon-Master voice (Campaign Phase 3).
const OPENERS = [
  "This week's session, chronicled:",
  "Your campaign log for the week:",
  "The party's week, on the record:",
  "The week's adventure, recounted:",
];
const CLOSERS = [
  "The session ends; the campaign continues. 🗺️",
  "Rest up, adventurer — the next chapter is yours. ✨",
  "Your pace, your quest. Onward. 🗡️",
  "Every bit of that was you showing up. 🌟",
];

/** djb2 — same stable hash family as ai/reflection.ts. */
function hashSeed(userId: number, weekKey: string): number {
  const s = `${userId}:${weekKey}`;
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0;
  return h;
}

export function fallbackNarrative(userId: number, weekKey: string, stats: WeekStats): string {
  const seed = hashSeed(userId, weekKey);
  const wins: string[] = [];
  if (stats.questsCompleted > 0) wins.push(`you cleared ${stats.questsCompleted} quest${stats.questsCompleted === 1 ? "" : "s"}`);
  if (stats.focusMinutes > 0) wins.push(`logged ${stats.focusMinutes} focused minute${stats.focusMinutes === 1 ? "" : "s"}`);
  if (stats.initiations > 0) wins.push(`got yourself started ${stats.initiations} time${stats.initiations === 1 ? "" : "s"}`);
  if (stats.boss && stats.boss.damage > 0) wins.push(`dealt ${stats.boss.damage} damage to the World Boss${stats.boss.defeated ? " (it fell!)" : ""}`);
  const winsLine = wins.length > 0
    ? `${wins[0]!.charAt(0).toUpperCase()}${wins.join(", ").slice(1)}.`
    : "You kept your quest alive.";
  return `${OPENERS[seed % OPENERS.length]} ${winsLine} ${CLOSERS[seed % CLOSERS.length]}`;
}

function parseNarrative(raw: unknown): string {
  const val = (raw as Record<string, unknown> | null)?.narrative;
  if (typeof val !== "string") throw new Error('Model output missing string "narrative"');
  const text = val.trim();
  if (text.length === 0 || text.length > MAX_NARRATIVE_LENGTH) {
    throw new Error(`"narrative" empty or over ${MAX_NARRATIVE_LENGTH} chars`);
  }
  if (containsGuiltLanguage(text)) throw new Error('"narrative" contains guilt language');
  return text;
}

export async function draftNarrative(
  stats: WeekStats,
  userId: number,
  weekKey: string,
  generate: GenerateJson | null,
): Promise<{ narrative: string; source: "ai" | "fallback" }> {
  if (generate) {
    try {
      return { narrative: parseNarrative(await generate(buildRecapPrompt(stats))), source: "ai" };
    } catch {
      // fall through — the pass never blocks on the model
    }
  }
  return { narrative: fallbackNarrative(userId, weekKey, stats), source: "fallback" };
}
