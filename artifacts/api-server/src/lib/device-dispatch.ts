import type { PushPayload } from "./push-notifications";
import { deadTokensFromReceipts, type ExpoReceipt } from "./expo-push";

export interface DispatchDeps {
  listExpoTokens(userId: number): Promise<string[]>;
  sendExpo(tokens: string[], payload: PushPayload): Promise<ExpoReceipt[]>;
  pruneTokens(tokens: string[]): Promise<void>;
  sendWeb(userId: number, payload: PushPayload): Promise<number>;
}

export interface DispatchResult {
  webSent: number;
  expoSent: number;
  pruned: number;
}

export async function dispatchToUser(
  deps: DispatchDeps,
  userId: number,
  payload: PushPayload,
): Promise<DispatchResult> {
  const webSent = await deps.sendWeb(userId, payload);

  const tokens = await deps.listExpoTokens(userId);
  if (tokens.length === 0) return { webSent, expoSent: 0, pruned: 0 };

  const receipts = await deps.sendExpo(tokens, payload);
  const okCount = receipts.filter((r) => r.status === "ok").length;
  const dead = deadTokensFromReceipts(tokens, receipts);
  if (dead.length > 0) await deps.pruneTokens(dead);

  return { webSent, expoSent: okCount, pruned: dead.length };
}
