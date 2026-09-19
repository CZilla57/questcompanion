import { eq, and, inArray } from "drizzle-orm";
import { db, pushSubscriptionsTable, deviceTokensTable } from "@workspace/db";
import { sendPushNotification, type PushPayload } from "./push-notifications";
import { buildExpoMessages, sendExpoPush, expoHttpTransport } from "./expo-push";
import {
  apnsConfigFromEnv, apnsHttpTransport, buildApnsRequests, sendApnsPush, type ApnsReceipt,
} from "./apns-push";
import type { DispatchDeps } from "./device-dispatch";
import { sendWebToUser, bestEffortDispatch, type WebPushDeps } from "./push-dispatch";

const webDeps: WebPushDeps = {
  listSubscriptions: (userId) =>
    db.select().from(pushSubscriptionsTable).where(eq(pushSubscriptionsTable.userId, userId)),
  send: (sub, payload) => sendPushNotification(sub, payload),
  remove: (endpoint) =>
    db
      .delete(pushSubscriptionsTable)
      .where(eq(pushSubscriptionsTable.endpoint, endpoint))
      .then(() => undefined),
};

/** Assemble the real fan-out deps: web subs + Expo device tokens. */
export function buildDispatchDeps(): DispatchDeps {
  return {
    listExpoTokens: async (userId) => {
      const rows = await db
        .select({ token: deviceTokensTable.token })
        .from(deviceTokensTable)
        .where(
          and(
            eq(deviceTokensTable.userId, userId),
            eq(deviceTokensTable.provider, "expo"),
          ),
        );
      return rows.map((r) => r.token);
    },
    sendExpo: (tokens, payload) =>
      sendExpoPush(buildExpoMessages(tokens, payload), expoHttpTransport),
    pruneTokens: async (tokens) => {
      if (tokens.length === 0) return;
      await db.delete(deviceTokensTable).where(inArray(deviceTokensTable.token, tokens));
    },
    sendWeb: (userId, payload) => sendWebToUser(userId, payload, webDeps),
    listApnsTokens: async (userId) => {
      const rows = await db
        .select({ token: deviceTokensTable.token, environment: deviceTokensTable.environment })
        .from(deviceTokensTable)
        .where(and(
          eq(deviceTokensTable.userId, userId),
          eq(deviceTokensTable.provider, "apns"),
        ));
      return rows.map((r) => ({
        token: r.token,
        environment: r.environment as "sandbox" | "production" | null,
      }));
    },
    sendApns: async (tokens, payload) => {
      const cfg = apnsConfigFromEnv();
      if (!cfg) return []; // unconfigured: no-op, no fake receipts (see Minor #6 below)

      // Route each token to its own registered environment; fall back to the
      // server's configured environment only for pre-migration rows with no
      // stored value. Keep receipts aligned to the ORIGINAL token order — the
      // caller correlates tokens[i] with receipts[i].
      const receipts: ApnsReceipt[] = new Array(tokens.length);
      const buckets = new Map<"sandbox" | "production", number[]>();
      tokens.forEach((t, i) => {
        const env = t.environment ?? cfg.environment;
        if (!buckets.has(env)) buckets.set(env, []);
        buckets.get(env)!.push(i);
      });

      await Promise.all(
        Array.from(buckets.entries()).map(async ([environment, indices]) => {
          const bucketCfg = { ...cfg, environment };
          const bucketTokens = indices.map((i) => tokens[i].token);
          const bucketReceipts = await sendApnsPush(
            buildApnsRequests(bucketTokens, payload, bucketCfg.bundleId),
            apnsHttpTransport(bucketCfg),
          );
          indices.forEach((i, j) => { receipts[i] = bucketReceipts[j]; });
        }),
      );
      return receipts;
    },
  };
}

/** Zero-config, best-effort push to all of a user's channels. */
export function pushToUser(userId: number, payload: PushPayload): Promise<void> {
  return bestEffortDispatch(userId, payload, buildDispatchDeps());
}
