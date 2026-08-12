import { Router, type IRouter } from "express";
import { eq, and } from "drizzle-orm";
import { db, deviceTokensTable } from "@workspace/db";

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

export default router;
