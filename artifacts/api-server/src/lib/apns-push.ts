import type { PushPayload } from "./push-notifications";

export interface ApnsRequest {
  token: string;
  headers: Record<string, string>;
  body: string;
}

export type ApnsReceipt = { status: "ok" } | { status: "error"; reason?: string };
export type ApnsTransport = (requests: ApnsRequest[]) => Promise<ApnsReceipt[]>;

// Apple reasons that mean "this token will never work again" → prune it.
const DEAD_REASONS = new Set(["Unregistered", "BadDeviceToken", "DeviceTokenNotForTopic"]);

export function buildApnsRequests(
  tokens: string[],
  payload: PushPayload,
  bundleId: string,
): ApnsRequest[] {
  return tokens.map((token) => ({
    token,
    headers: {
      "apns-topic": bundleId,
      "apns-push-type": "alert",
      "apns-priority": "10",
    },
    body: JSON.stringify({
      aps: { alert: { title: payload.title, body: payload.body }, sound: "default" },
      ...(payload.data ?? {}),
    }),
  }));
}

export function deadTokensFromApnsReceipts(
  tokens: string[],
  receipts: ApnsReceipt[],
): string[] {
  const dead: string[] = [];
  receipts.forEach((r, i) => {
    if (r.status === "error" && r.reason && DEAD_REASONS.has(r.reason) && tokens[i]) {
      dead.push(tokens[i]);
    }
  });
  return dead;
}

export async function sendApnsPush(
  requests: ApnsRequest[],
  transport: ApnsTransport,
): Promise<ApnsReceipt[]> {
  if (requests.length === 0) return [];
  return transport(requests);
}
