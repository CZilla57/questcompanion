import { Router, type IRouter } from "express";
import { eq, and, inArray } from "drizzle-orm";
import { db, deviceTokensTable, pushSubscriptionsTable } from "@workspace/db";
import { sendPushNotification, type PushPayload } from "../lib/push-notifications";
import { buildExpoMessages, sendExpoPush, expoHttpTransport } from "../lib/expo-push";
import { dispatchToUser, type DispatchDeps } from "../lib/device-dispatch";

const router: IRouter = Router();

router.post("/devices", async (req, res): Promise<void> => {
  if (!req.isAuthenticated()) { res.status(401).json({ error: "Unauthorized" }); return; }
  const userId = req.gameUserId;
  const { token, provider } = req.body as { token?: string; provider?: string };
  if (!token || (provider !== "expo" && provider !== "apns")) {
    res.status(400).json({ error: "token and provider ('expo'|'apns') are required" });
    return;
  }
  await db
    .insert(deviceTokensTable)
    .values({ userId, provider, token, platform: "ios" })
    .onConflictDoUpdate({
      target: [deviceTokensTable.provider, deviceTokensTable.token],
      set: { userId, lastSeenAt: new Date() },
    });
  res.status(201).json({ success: true });
});

router.delete("/devices/:token", async (req, res): Promise<void> => {
  if (!req.isAuthenticated()) { res.status(401).json({ error: "Unauthorized" }); return; }
  const userId = req.gameUserId;
  await db.delete(deviceTokensTable).where(
    and(eq(deviceTokensTable.userId, userId), eq(deviceTokensTable.token, req.params.token)),
  );
  res.json({ success: true });
});

function dispatchDeps(): DispatchDeps {
  return {
    async listExpoTokens(userId) {
      const rows = await db.select().from(deviceTokensTable).where(
        and(eq(deviceTokensTable.userId, userId), eq(deviceTokensTable.provider, "expo")),
      );
      return rows.map((r) => r.token);
    },
    async sendExpo(tokens, payload) {
      return sendExpoPush(buildExpoMessages(tokens, payload), expoHttpTransport);
    },
    async pruneTokens(tokens) {
      if (tokens.length === 0) return;
      await db.delete(deviceTokensTable).where(inArray(deviceTokensTable.token, tokens));
    },
    async sendWeb(userId, payload) {
      const subs = await db.select().from(pushSubscriptionsTable).where(
        eq(pushSubscriptionsTable.userId, userId),
      );
      let sent = 0;
      for (const s of subs) {
        if (await sendPushNotification(s, payload)) sent++;
      }
      return sent;
    },
  };
}

// TEMPORARY: G3 verification trigger. Remove before the phase closes (Task 10).
router.post("/devices/test-send", async (req, res): Promise<void> => {
  if (!req.isAuthenticated()) { res.status(401).json({ error: "Unauthorized" }); return; }
  const payload: PushPayload = {
    title: "FocusQuest",
    body: "Test notification from staging ✓",
    data: { url: "/" },
  };
  const result = await dispatchToUser(dispatchDeps(), req.gameUserId, payload);
  res.json(result);
});

export default router;
