import { localHour } from "../date-buckets";
import { blockOfHour, type DayBlock, type PatternSummary } from "../patterns";

export const MAX_QUESTION_LENGTH = 140;
export const MAX_ACK_LENGTH = 120;

// The same provider-agnostic seam as task-breakdown.ts.
export type GenerateJson = (prompt: string) => Promise<unknown>;

export interface DaySummary {
  completedQuests: { title: string; category: string }[];
  focusMinutes: number;
  modesSeen: { mode: string; block: DayBlock }[];
  rescueCount: number;
  streakDays: number;
}

/**
 * Anti-shame at the data boundary: this shape has NO channel for unfinished,
 * missed, or overdue work — callers pass completed rows only, so no prompt
 * mistake downstream can leak guilt fuel into the LLM context.
 */
export function buildDaySummary(input: {
  completedToday: { title: string; category: string; completedAt: Date }[];
  focusSecondsToday: number;
  checkinsToday: { mode: string; createdAt: Date }[];
  rescueCountToday: number;
  streakDays: number;
  timeZone: string;
}): DaySummary {
  return {
    completedQuests: input.completedToday.slice(0, 6).map((t) => ({ title: t.title, category: t.category })),
    focusMinutes: Math.round(input.focusSecondsToday / 60),
    modesSeen: input.checkinsToday.map((c) => ({
      mode: c.mode,
      block: blockOfHour(localHour(c.createdAt, input.timeZone)),
    })),
    rescueCount: input.rescueCountToday,
    streakDays: input.streakDays,
  };
}

// Word-boundary regex; curly apostrophes normalized first. Deliberately
// conservative — a false positive just means a curated fallback line.
const GUILT_RE = /\b(should have|didn't|missed|failed|behind|only|just)\b/i;

export function containsGuiltLanguage(text: string): boolean {
  return GUILT_RE.test(text.replace(/'/g, "'"));
}

export const FALLBACK_QUESTIONS: readonly string[] = [
  "What made starting easier today?",
  "When did today feel lightest?",
  "What's one thing that worked in your favor today?",
  "Which moment today would you like more of tomorrow?",
  "What helped you get moving when you did?",
  "What did your energy want to do today?",
  "If today had a soundtrack, when was it in a groove?",
  "What small thing quietly helped today?",
  "When did time feel like it was on your side?",
  "What would past-you be glad you did today?",
  "Which win today felt bigger than it looked?",
  "What's worth remembering about how today went?",
];

const FALLBACK_ACKS: readonly string[] = [
  "Noted for your rhythms — rest well 🌙",
  "Logged. Your future self says thanks.",
  "Got it — every note teaches the map of you.",
  "Saved. That's useful signal, not homework.",
  "Noted. Tomorrow gets a slightly smarter app.",
  "Thanks for the read on today — sleep easy.",
];

/** djb2 — stable tiny hash for deterministic per-day rotation. */
function hashSeed(userId: number, localDate: string): number {
  const s = `${userId}:${localDate}`;
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0;
  return h;
}

export function fallbackQuestion(userId: number, localDate: string): string {
  return FALLBACK_QUESTIONS[hashSeed(userId, localDate) % FALLBACK_QUESTIONS.length]!;
}

export function fallbackAck(userId: number, localDate: string): string {
  return FALLBACK_ACKS[hashSeed(userId, localDate) % FALLBACK_ACKS.length]!;
}

export function buildReflectionQuestionPrompt(day: DaySummary, patterns: PatternSummary): string {
  const facts: string[] = [];
  if (day.completedQuests.length > 0) {
    facts.push(`Quests completed today: ${day.completedQuests.map((q) => `"${q.title}" (${q.category})`).join(", ")}`);
  }
  if (day.focusMinutes > 0) facts.push(`Focused minutes today: ${day.focusMinutes}`);
  if (day.modesSeen.length > 0) {
    facts.push(`Brain check-ins today: ${day.modesSeen.map((m) => `${m.mode} in the ${m.block}`).join(", ")}`);
  }
  if (day.rescueCount > 0) facts.push(`They unblocked themselves ${day.rescueCount} time(s) using a rescue tool.`);
  if (day.streakDays > 0) facts.push(`Current streak: ${day.streakDays} day(s).`);
  if (patterns.confidence !== "none" && patterns.powerHours.length > 0) {
    facts.push(`Historically strong hours (24h local): ${patterns.powerHours.map((p) => p.hour).join(", ")}`);
  }
  if (patterns.topHelpers.length > 0) facts.push(`Things that usually help them: ${patterns.topHelpers.join(", ")}`);

  return `You write ONE short end-of-day reflection question for a person with ADHD, based on today's wins below.

Hard rules — every one is mandatory:
- Ask about PROCESS (what helped, what got in the way, how it felt) — NEVER about output, productivity, or amounts.
- NEVER mention unfinished, remaining, missed, or planned work. You only know about what they DID.
- Warm and curious, zero pressure, no advice, no praise inflation.
- One single question, at most ${MAX_QUESTION_LENGTH} characters, ends with a question mark.
- Never use guilt words (should, didn't, missed, failed, behind, only, just).

Today's facts:
${facts.length > 0 ? facts.join("\n") : "A quiet day — no logged events."}

Respond with JSON only, in this exact shape: {"question": "..."}`;
}

function buildAckPrompt(chips: string[], freeText: string | null): string {
  return `A person with ADHD just answered an end-of-day reflection. They tapped: ${chips.length > 0 ? chips.join(", ") : "(none)"}${freeText ? `; and wrote: "${freeText}"` : ""}.

Write ONE warm closing line (max ${MAX_ACK_LENGTH} characters) acknowledging what they shared. No advice, no questions, no praise inflation, no guilt words (should, didn't, missed, failed, behind, only, just).

Respond with JSON only, in this exact shape: {"ack": "..."}`;
}

function parseLine(raw: unknown, key: "question" | "ack", maxLen: number): string {
  const val = (raw as Record<string, unknown> | null)?.[key];
  if (typeof val !== "string") throw new Error(`Model output missing string "${key}"`);
  const text = val.trim();
  if (text.length === 0 || text.length > maxLen) throw new Error(`"${key}" empty or over ${maxLen} chars`);
  if (containsGuiltLanguage(text)) throw new Error(`"${key}" contains guilt language`);
  return text;
}

export async function draftQuestion(
  day: DaySummary, patterns: PatternSummary,
  userId: number, localDate: string,
  generate: GenerateJson | null,
): Promise<{ question: string; source: "ai" | "fallback" }> {
  if (generate) {
    try {
      const raw = await generate(buildReflectionQuestionPrompt(day, patterns));
      return { question: parseLine(raw, "question", MAX_QUESTION_LENGTH), source: "ai" };
    } catch {
      // fall through — the flow never blocks on the model
    }
  }
  return { question: fallbackQuestion(userId, localDate), source: "fallback" };
}

export async function draftAck(
  chips: string[], freeText: string | null,
  userId: number, localDate: string,
  generate: GenerateJson | null,
): Promise<string> {
  if (generate) {
    try {
      return parseLine(await generate(buildAckPrompt(chips, freeText)), "ack", MAX_ACK_LENGTH);
    } catch {
      // fall through
    }
  }
  return fallbackAck(userId, localDate);
}
