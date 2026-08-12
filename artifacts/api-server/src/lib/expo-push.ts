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

// Default transport posts to Expo's push API. It must never throw: a batch
// dispatcher relies on getting one receipt per message so it can prune dead
// tokens and surface per-message failures, so every failure mode (network
// error, non-2xx response, unparseable/absent body) maps to error receipts
// aligned 1:1 with the batch rather than propagating.
export const expoHttpTransport: ExpoTransport = async (batch) => {
  const errorReceipts = (error: string): ExpoReceipt[] =>
    batch.map(() => ({ status: "error", details: { error } }));

  let res: Response;
  try {
    res = await fetch("https://exp.host/--/api/v2/push/send", {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify(batch),
    });
  } catch {
    return errorReceipts("RequestFailed");
  }

  if (!res.ok) return errorReceipts(`HTTP ${res.status}`);

  let json: { data?: ExpoReceipt[] };
  try {
    json = (await res.json()) as { data?: ExpoReceipt[] };
  } catch {
    return errorReceipts("InvalidResponse");
  }

  return json.data ?? errorReceipts("NoReceipt");
};
