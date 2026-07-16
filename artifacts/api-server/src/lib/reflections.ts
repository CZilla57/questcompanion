import { ReflectionHelpedChip, ReflectionHinderedChip } from "@workspace/api-zod";

export const REFLECTION_XP = 5;
export const MAX_FREE_TEXT = 500;

const ALL_CHIPS = new Set<string>([
  ...Object.values(ReflectionHelpedChip),
  ...Object.values(ReflectionHinderedChip),
]);

export function isReflectionChip(x: unknown): boolean {
  return typeof x === "string" && ALL_CHIPS.has(x);
}

export type AnswerValidation =
  | { ok: true; chips: string[]; freeText: string | null }
  | { ok: false; error: string };

export function validateAnswer(body: unknown): AnswerValidation {
  const chips = (body as { chips?: unknown } | null)?.chips;
  if (!Array.isArray(chips)) return { ok: false, error: "chips must be an array" };
  for (const c of chips) {
    if (!isReflectionChip(c)) return { ok: false, error: `Unknown chip: ${String(c)}` };
  }
  const rawText = (body as { freeText?: unknown }).freeText;
  if (rawText != null && typeof rawText !== "string") return { ok: false, error: "freeText must be a string" };
  const trimmed = typeof rawText === "string" ? rawText.trim() : "";
  if (trimmed.length > MAX_FREE_TEXT) return { ok: false, error: `freeText over ${MAX_FREE_TEXT} chars` };

  const unique = [...new Set(chips as string[])];
  const freeText = trimmed.length > 0 ? trimmed : null;
  if (unique.length === 0 && freeText === null) return { ok: false, error: "Empty answer" };
  return { ok: true, chips: unique, freeText };
}

/**
 * The whole evening-push decision, pure. The scheduler may pre-gate on the
 * cheap fields to skip queries, but this function is the authority (and the
 * only place the rules are tested).
 */
export function shouldPromptReflection(i: {
  localHour: number;
  promptedToday: boolean;
  answeredToday: boolean;
  hadSignalToday: boolean;
  hasTimezone: boolean;
}): boolean {
  return (
    i.hasTimezone &&
    i.localHour >= 19 && i.localHour < 22 &&
    !i.promptedToday &&
    !i.answeredToday &&
    i.hadSignalToday // zero-signal day ⇒ silence (anti-shame)
  );
}
