import { containsGuiltLanguage, type GenerateJson } from "./reflection";
import type { DmBeatFacts, DmBeatKind } from "@workspace/db";

// The Campaign — Phase 3: the Dungeon Master's narration seam. Mirrors
// ai/weekly-recap.ts — a prompt builder, a deterministic fallback, and a
// validator — but adds the DM's defining guardrail: NO-FABRICATION. The DM may
// only reference quests the user actually has; the validator rejects any quoted
// phrase that is not a real title, and the caller falls back silently.

export const MAX_BEAT_LENGTH = 320;

/** djb2 — the same stable tiny hash the other ai/ fallbacks use. */
function hashSeed(userId: number, key: string): number {
  const s = `${userId}:${key}`;
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0;
  return h;
}

function titleList(titles: string[]): string {
  return titles.map((t) => `"${t}"`).join(", ");
}

export function buildBeatPrompt(kind: DmBeatKind, facts: DmBeatFacts): string {
  const lines: string[] = [];
  if (facts.chapterBeat) lines.push(`Current campaign chapter: ${facts.chapterBeat}`);
  if (kind === "morning" && facts.plannedTitles.length > 0) {
    lines.push(`Quests the hero plans to face today: ${titleList(facts.plannedTitles)}`);
  }
  if (kind === "camp" && facts.completedTitles.length > 0) {
    lines.push(`Quests the hero completed today: ${titleList(facts.completedTitles)}`);
  }
  if (facts.kingdomGrowth.length > 0) lines.push(`Life areas that grew today: ${facts.kingdomGrowth.join("; ")}`);
  if (facts.focusMinutes > 0) lines.push(`Focused minutes today: ${facts.focusMinutes}`);
  if (facts.streakDays > 0) lines.push(`Day streak: ${facts.streakDays}`);

  const scene = kind === "morning"
    ? `You are a warm tabletop Dungeon Master opening the day's adventure — a "morning quest board". Frame today's planned quests as the day ahead. Invite, never pressure.`
    : `You are a warm tabletop Dungeon Master calling the party to "make camp" for the evening — a short rest after the day's adventuring. Honor what was done today.`;

  return `${scene}

Hard rules — every one is mandatory:
- Ground EVERY specific in the facts below. NEVER invent a quest, foe, place, or deed the facts don't state — no fabrication of any kind.
- When you name one of the hero's quests, quote its title EXACTLY as written, in double quotes. Do not paraphrase a title.
- ${kind === "morning" ? "These are invitations, not obligations. NEVER imply the hero must, should, or is behind." : "Celebrate only what was actually done. NEVER mention unfinished, remaining, or missed work — you know nothing beyond the facts."}
- Warm, grounded, tabletop-DM voice. 1-2 sentences. At most ${MAX_BEAT_LENGTH} characters. Plain prose, no lists, no emoji.
- Never use guilt words (should, didn't, missed, failed, behind, only, just).

Facts:
${lines.join("\n")}

Respond with JSON only, in this exact shape: {"beat": "..."}`;
}

const MORNING_OPENERS = [
  "The board is set for today.",
  "A new day's adventure begins.",
  "The road ahead is yours to walk.",
  "Dawn breaks over the quest board.",
];
// Openers deliberately avoid every word in the guilt regex (e.g. "behind").
const CAMP_OPENERS = [
  "The party makes camp.",
  "Time to rest by the fire.",
  "The day's road is walked.",
  "Camp is struck for the evening.",
];

/**
 * A deterministic, no-model beat that is still grounded — it only ever names
 * quests present in `facts`, so the fallback obeys the same no-fabrication
 * contract as the model path. Never blocks, never fabricates, never shames.
 */
export function fallbackBeat(
  kind: DmBeatKind,
  userId: number,
  localDate: string,
  facts: DmBeatFacts,
): string {
  const seed = hashSeed(userId, `${localDate}:${kind}`);
  if (kind === "morning") {
    const opener = MORNING_OPENERS[seed % MORNING_OPENERS.length]!;
    if (facts.plannedTitles.length > 0) {
      const first = facts.plannedTitles[0]!;
      const rest = facts.plannedTitles.length - 1;
      const tail = rest > 0 ? `, with ${rest} more quest${rest === 1 ? "" : "s"} on the board` : "";
      return `${opener} "${first}" awaits${tail}. Take it at your pace.`;
    }
    return `${opener} Whatever you choose to face, the road is yours.`;
  }
  const opener = CAMP_OPENERS[seed % CAMP_OPENERS.length]!;
  if (facts.completedTitles.length > 0) {
    const n = facts.completedTitles.length;
    const first = facts.completedTitles[0]!;
    const deed = n === 1 ? `You cleared "${first}"` : `You cleared "${first}" and ${n - 1} more`;
    const growth = facts.kingdomGrowth.length > 0 ? ` — ${facts.kingdomGrowth[0]}` : "";
    return `${opener} ${deed}${growth}. Rest well; it counts.`;
  }
  if (facts.kingdomGrowth.length > 0) {
    return `${opener} Today, ${facts.kingdomGrowth[0]}. Rest well; it counts.`;
  }
  return `${opener} You kept your quest alive today. Rest well.`;
}

/** Every double-quoted span in the narrative, unwrapped and trimmed. */
function quotedPhrases(text: string): string[] {
  const out: string[] = [];
  const re = /"([^"]+)"/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) out.push(m[1]!.trim());
  return out;
}

/**
 * Validate a model beat against the real facts. Rejects (→ fallback) on:
 * empty/over-length, guilt language, or FABRICATION — any quoted phrase that
 * is not one of the real quest titles the beat was allowed to reference. The
 * model is told to quote real titles verbatim, so a quoted phrase that matches
 * no title is a hallucinated quest and the whole beat is discarded.
 */
export function parseBeat(raw: unknown, facts: DmBeatFacts, kind: DmBeatKind): string {
  const val = (raw as Record<string, unknown> | null)?.beat;
  if (typeof val !== "string") throw new Error('Model output missing string "beat"');
  const text = val.trim();
  if (text.length === 0 || text.length > MAX_BEAT_LENGTH) {
    throw new Error(`"beat" empty or over ${MAX_BEAT_LENGTH} chars`);
  }
  if (containsGuiltLanguage(text)) throw new Error('"beat" contains guilt language');

  const realTitles = new Set(
    [...facts.completedTitles, ...facts.plannedTitles].map((t) => t.trim().toLowerCase()),
  );
  for (const phrase of quotedPhrases(text)) {
    if (!realTitles.has(phrase.toLowerCase())) {
      throw new Error(`"beat" quotes a fabricated title: ${phrase}`);
    }
  }
  return text;
}

export async function draftBeat(
  kind: DmBeatKind,
  facts: DmBeatFacts,
  userId: number,
  localDate: string,
  generate: GenerateJson | null,
): Promise<{ narrative: string; source: "ai" | "fallback" }> {
  if (generate) {
    try {
      return { narrative: parseBeat(await generate(buildBeatPrompt(kind, facts)), facts, kind), source: "ai" };
    } catch {
      // The DM never blocks a screen — fall through to the grounded fallback.
    }
  }
  return { narrative: fallbackBeat(kind, userId, localDate, facts), source: "fallback" };
}
