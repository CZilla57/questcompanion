export const DELETE_PHRASE = "delete my account";

/** Case/whitespace-forgiving match — deliberate friction without being a
 * typing test (anti-shame: the phrase slows you down, it doesn't punish you). */
export function confirmPhraseOk(input: string): boolean {
  return input.trim().toLowerCase() === DELETE_PHRASE;
}
