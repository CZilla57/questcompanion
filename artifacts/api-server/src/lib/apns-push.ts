import jwt from "jsonwebtoken";
import http2 from "node:http2";
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

export interface ApnsConfig {
  authKey: string;
  keyId: string;
  teamId: string;
  bundleId: string;
  environment: "sandbox" | "production";
}

export function apnsConfigFromEnv(env: NodeJS.ProcessEnv = process.env): ApnsConfig | null {
  const authKey = env.APNS_AUTH_KEY, keyId = env.APNS_KEY_ID, teamId = env.APNS_TEAM_ID;
  const bundleId = env.APNS_BUNDLE_ID, environment = env.APNS_ENV;
  if (!authKey || !keyId || !teamId || !bundleId) return null;
  if (environment !== "sandbox" && environment !== "production") return null;
  return { authKey, keyId, teamId, bundleId, environment };
}

export function apnsHost(environment: "sandbox" | "production"): string {
  return environment === "sandbox" ? "api.sandbox.push.apple.com" : "api.push.apple.com";
}

export function buildProviderJwt(cfg: ApnsConfig, nowSec: number): string {
  return jwt.sign({ iss: cfg.teamId, iat: nowSec }, cfg.authKey, {
    algorithm: "ES256",
    header: { alg: "ES256", kid: cfg.keyId },
  });
}

// Provider JWT is reusable up to ~60 min; re-sign at 40 min. Cached per config.
let cachedJwt: { token: string; expiresSec: number } | null = null;
function providerJwt(cfg: ApnsConfig): string {
  const nowSec = Math.floor(Date.now() / 1000);
  if (cachedJwt && cachedJwt.expiresSec > nowSec) return cachedJwt.token;
  const token = buildProviderJwt(cfg, nowSec);
  cachedJwt = { token, expiresSec: nowSec + 40 * 60 };
  return token;
}

export function apnsHttpTransport(cfg: ApnsConfig): ApnsTransport {
  return async (requests) => {
    if (requests.length === 0) return [];
    const client = http2.connect(`https://${apnsHost(cfg.environment)}`);
    // A session-level connect failure (DNS, refused, etc.) emits 'error' on the
    // client; per-request streams surface it too (handled below), so this listener
    // only exists to stop Node's default "no listener" behavior from throwing an
    // uncaught exception and crashing the process. Transports must never throw.
    client.on("error", () => {});
    const auth = providerJwt(cfg);
    const send = (r: ApnsRequest): Promise<ApnsReceipt> =>
      new Promise((resolve) => {
        const stream = client.request({
          ":method": "POST",
          ":path": `/3/device/${r.token}`,
          authorization: `bearer ${auth}`,
          "content-type": "application/json",
          ...r.headers,
        });
        let status = 0, data = "";
        stream.on("response", (h) => { status = Number(h[":status"]); });
        stream.on("data", (c) => { data += c; });
        stream.on("end", () => {
          if (status === 200) return resolve({ status: "ok" });
          let reason: string | undefined;
          try { reason = JSON.parse(data).reason; } catch { /* non-JSON */ }
          resolve({ status: "error", reason });
        });
        stream.on("error", () => resolve({ status: "error" }));
        stream.end();
      });
    try {
      return await Promise.all(requests.map(send));
    } finally {
      client.close();
    }
  };
}
