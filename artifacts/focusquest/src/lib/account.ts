import { DeleteAccountRequestConfirm } from "@workspace/api-client-react";

// Pinned to the OpenAPI enum via codegen — the server imports the same
// generated literal, so the phrase cannot drift between the two sides.
export const DELETE_PHRASE = DeleteAccountRequestConfirm.delete_my_account;

/** Case/whitespace-forgiving match — deliberate friction without being a
 * typing test (anti-shame: the phrase slows you down, it doesn't punish you). */
export function confirmPhraseOk(input: string): boolean {
  return input.trim().toLowerCase() === DELETE_PHRASE;
}
