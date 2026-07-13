import type { GenerateJson } from "./task-breakdown";

export const MIN_QUESTS = 3;
export const MAX_QUESTS = 6;
export const MAX_QUEST_LENGTH = 120;
export const MAX_QUESTLINE_QUESTS = 12;

export class QuestlineQuestsParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "QuestlineQuestsParseError";
  }
}

export function buildQuestlineQuestsPrompt(goal: string): string {
  return `You help people with ADHD turn a big goal into a short quest line they can actually start. Break the goal below into ${MIN_QUESTS}-${MAX_QUESTS} concrete quests that move it forward.

Rules:
- Each quest is a single concrete action or milestone toward the goal, written as a short present-tense imperative phrase.
- Order them from the easiest starting move to later progress.
- The FIRST quest must be a tiny, no-decision starting action that still makes real progress.
- No comfort rituals, warm-ups, or filler (never "get motivated", "make a plan to plan", "take a deep breath").
- Never use vague verbs like "organize", "work on", "deal with", or "handle" — name the specific action.
- Do not restate the goal itself as a quest.
- Return between ${MIN_QUESTS} and ${MAX_QUESTS} quests.

Goal: ${goal}

Respond with JSON only, in this exact shape: {"quests": ["first quest", "second quest", "..."]}`;
}

export function parseQuestlineQuests(raw: unknown): string[] {
  if (
    !raw ||
    typeof raw !== "object" ||
    !Array.isArray((raw as { quests?: unknown }).quests)
  ) {
    throw new QuestlineQuestsParseError("Model output did not match { quests: string[] }");
  }

  const quests = ((raw as { quests: unknown[] }).quests)
    .filter((q): q is string => typeof q === "string")
    .map((q) => q.trim())
    .filter((q) => q.length > 0)
    .map((q) => (q.length > MAX_QUEST_LENGTH ? q.slice(0, MAX_QUEST_LENGTH) : q))
    .slice(0, MAX_QUESTS);

  if (quests.length < MIN_QUESTS) {
    throw new QuestlineQuestsParseError(`Expected at least ${MIN_QUESTS} quests, got ${quests.length}`);
  }
  return quests;
}

export async function suggestQuestlineQuests(
  goal: string,
  generate: GenerateJson,
): Promise<string[]> {
  const raw = await generate(buildQuestlineQuestsPrompt(goal));
  return parseQuestlineQuests(raw);
}

/** Title hygiene for the create-with-quests path: trim, drop empties, cap length + count. */
export function sanitizeQuestTitles(titles: string[], max = MAX_QUESTLINE_QUESTS): string[] {
  return titles
    .filter((t): t is string => typeof t === "string")
    .map((t) => t.trim())
    .filter((t) => t.length > 0)
    .map((t) => (t.length > MAX_QUEST_LENGTH ? t.slice(0, MAX_QUEST_LENGTH) : t))
    .slice(0, max);
}
