import type { PushPayload } from "./push-notifications";

export interface ExpoMessage {
  to: string;
  title: string;
  body: string;
  data?: Record<string, unknown>;
}

export type ExpoReceipt =
  | { status: "ok" }
  | { status: "error"; details?: { error?: string } };

export type ExpoTransport = (batch: ExpoMessage[]) => Promise<ExpoReceipt[]>;

export function buildExpoMessages(tokens: string[], payload: PushPayload): ExpoMessage[] {
  return tokens.map((to) => ({
    to,
    title: payload.title,
    body: payload.body,
    ...(payload.data ? { data: payload.data } : {}),
  }));
}

export function deadTokensFromReceipts(tokens: string[], receipts: ExpoReceipt[]): string[] {
  const dead: string[] = [];
  receipts.forEach((r, i) => {
    if (r.status === "error" && r.details?.error === "DeviceNotRegistered" && tokens[i]) {
      dead.push(tokens[i]);
    }
  });
  return dead;
}

export async function sendExpoPush(
  messages: ExpoMessage[],
  transport: ExpoTransport,
): Promise<ExpoReceipt[]> {
  if (messages.length === 0) return [];
  return transport(messages);
}

// Default transport posts to Expo's push API. Not exercised in unit tests.
export const expoHttpTransport: ExpoTransport = async (batch) => {
  const res = await fetch("https://exp.host/--/api/v2/push/send", {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify(batch),
  });
  const json = (await res.json()) as { data?: ExpoReceipt[] };
  return json.data ?? batch.map(() => ({ status: "error", details: { error: "NoReceipt" } }));
};
