import { DeleteAccountRequestConfirm } from "@workspace/api-client-react";

// Pinned to the OpenAPI enum via codegen — the server imports the same
// generated literal, so the phrase cannot drift between the two sides.
export const DELETE_PHRASE = DeleteAccountRequestConfirm.delete_my_account;

/** Case/whitespace-forgiving match — deliberate friction without being a
 * typing test (anti-shame: the phrase slows you down, it doesn't punish you). */
export function confirmPhraseOk(input: string): boolean {
  return input.trim().toLowerCase() === DELETE_PHRASE;
}

export function exportFileName(now: Date): string {
  return `focusquest-export-${now.toISOString().slice(0, 10)}.json`;
}

/** How to hand the export file over. The standalone webview has no browser
 * chrome: navigating to the JSON (or blob-anchoring on iOS) shows the raw
 * file with no way back — restart-the-app territory. The share sheet is the
 * only exit that can't trap, so it wins whenever standalone supports it.
 * In a real browser tab the plain blob download is the least ceremony. */
export function exportStrategy(env: { standalone: boolean; canShareFiles: boolean }): "share" | "download" {
  return env.standalone && env.canShareFiles ? "share" : "download";
}
