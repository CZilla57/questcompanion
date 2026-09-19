import type { PushPayload } from "./push-notifications";
import { deadTokensFromReceipts, type ExpoReceipt } from "./expo-push";
import { deadTokensFromApnsReceipts, type ApnsReceipt } from "./apns-push";

export interface DispatchDeps {
  listExpoTokens(userId: number): Promise<string[]>;
  sendExpo(tokens: string[], payload: PushPayload): Promise<ExpoReceipt[]>;
  listApnsTokens(userId: number): Promise<{ token: string; environment: "sandbox" | "production" | null }[]>;
  sendApns(
    tokens: { token: string; environment: "sandbox" | "production" | null }[],
    payload: PushPayload,
  ): Promise<ApnsReceipt[]>;
  pruneTokens(tokens: string[]): Promise<void>;
  sendWeb(userId: number, payload: PushPayload): Promise<number>;
}

export interface DispatchResult {
  webSent: number;
  expoSent: number;
  apnsSent: number;
  pruned: number;
}

export async function dispatchToUser(
  deps: DispatchDeps,
  userId: number,
  payload: PushPayload,
): Promise<DispatchResult> {
  const webSent = await deps.sendWeb(userId, payload);

  const expoTokens = await deps.listExpoTokens(userId);
  let expoSent = 0, expoDead: string[] = [];
  if (expoTokens.length > 0) {
    const receipts = await deps.sendExpo(expoTokens, payload);
    expoSent = receipts.filter((r) => r.status === "ok").length;
    expoDead = deadTokensFromReceipts(expoTokens, receipts);
  }

  const apnsTokens = await deps.listApnsTokens(userId);
  let apnsSent = 0, apnsDead: string[] = [];
  if (apnsTokens.length > 0) {
    const apnsReceipts = await deps.sendApns(apnsTokens, payload);
    apnsSent = apnsReceipts.filter((r) => r.status === "ok").length;
    apnsDead = deadTokensFromApnsReceipts(apnsTokens.map((t) => t.token), apnsReceipts);
  }

  const dead = [...expoDead, ...apnsDead];
  if (dead.length > 0) await deps.pruneTokens(dead);

  return { webSent, expoSent, apnsSent, pruned: dead.length };
}
