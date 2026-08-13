import { eq, and, inArray } from "drizzle-orm";
import { db, pushSubscriptionsTable, deviceTokensTable } from "@workspace/db";
import { sendPushNotification, type PushPayload } from "./push-notifications";
import { buildExpoMessages, sendExpoPush, expoHttpTransport } from "./expo-push";
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
  };
}

/** Zero-config, best-effort push to all of a user's channels. */
export function pushToUser(userId: number, payload: PushPayload): Promise<void> {
  return bestEffortDispatch(userId, payload, buildDispatchDeps());
}
