import { Router, type IRouter } from "express";
import { eq, and } from "drizzle-orm";
import { db, pushSubscriptionsTable } from "@workspace/db";
import { vapidPublicKey } from "../lib/push-notifications";

const router: IRouter = Router();
const DEFAULT_USER_ID = 1;

router.get("/notifications/vapid-key", (_req, res): void => {
  res.json({ publicKey: vapidPublicKey });
});

router.post("/notifications/subscribe", async (req, res): Promise<void> => {
  const { endpoint, keys } = req.body as {
    endpoint?: string;
    keys?: { p256dh?: string; auth?: string };
  };

  if (!endpoint || !keys?.p256dh || !keys?.auth) {
    res.status(400).json({ error: "Invalid subscription object" });
    return;
  }

  // Upsert — delete existing and re-insert
  await db.delete(pushSubscriptionsTable).where(
    and(eq(pushSubscriptionsTable.userId, DEFAULT_USER_ID), eq(pushSubscriptionsTable.endpoint, endpoint)),
  );

  await db.insert(pushSubscriptionsTable).values({
    userId: DEFAULT_USER_ID,
    endpoint,
    p256dh: keys.p256dh,
    auth: keys.auth,
  });

  res.status(201).json({ success: true });
});

router.delete("/notifications/subscribe", async (req, res): Promise<void> => {
  const { endpoint } = req.body as { endpoint?: string };
  if (!endpoint) {
    res.status(400).json({ error: "endpoint is required" });
    return;
  }

  await db.delete(pushSubscriptionsTable).where(
    and(eq(pushSubscriptionsTable.userId, DEFAULT_USER_ID), eq(pushSubscriptionsTable.endpoint, endpoint)),
  );

  res.json({ success: true });
});

router.get("/notifications/subscribed", async (_req, res): Promise<void> => {
  const subs = await db.select().from(pushSubscriptionsTable)
    .where(eq(pushSubscriptionsTable.userId, DEFAULT_USER_ID));
  res.json({ subscribed: subs.length > 0, count: subs.length });
});

export default router;
