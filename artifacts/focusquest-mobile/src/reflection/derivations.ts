import type { Reflection, ReflectionAnswerRequest, ReflectionChip } from "@workspace/api-client-react";

/** The exact payload the answer mutation receives (blank free-text becomes undefined). */
export function buildReflectionAnswer(
  chips: ReflectionChip[], freeText: string, tz: string,
): ReflectionAnswerRequest {
  return { chips, freeText: freeText.trim() || undefined, tz };
}

/** Whether Done is enabled: at least one chip, or some non-blank free-text. */
export function canSubmitReflection(selectedCount: number, freeText: string): boolean {
  return selectedCount > 0 || freeText.trim().length > 0;
}

/** Whether to show the answered (read-only) view instead of the form. */
export function isAnswered(reflection: Reflection | null, editing: boolean): boolean {
  return reflection?.answeredAt != null && !editing;
}
