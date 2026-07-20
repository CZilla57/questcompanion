import { Router, type IRouter } from "express";
import { eq, and } from "drizzle-orm";
import { db, pushSubscriptionsTable, usersTable } from "@workspace/db";
import { vapidPublicKey, isValidPushEndpoint } from "../lib/push-notifications";
import { validatePrefsBody } from "../lib/notification-envelope";

const router: IRouter = Router();

router.get("/notifications/vapid-key", (_req, res): void => {
  res.json({ publicKey: vapidPublicKey });
});

router.post("/notifications/subscribe", async (req, res): Promise<void> => {
  if (!req.isAuthenticated()) { res.status(401).json({ error: "Unauthorized" }); return; }
  const userId = req.gameUserId;

  const { endpoint, keys } = req.body as {
    endpoint?: string;
    keys?: { p256dh?: string; auth?: string };
  };

  if (!endpoint || !keys?.p256dh || !keys?.auth) {
    res.status(400).json({ error: "Invalid subscription object" });
    return;
  }

  if (!isValidPushEndpoint(endpoint)) {
    res.status(400).json({ error: "Invalid push endpoint" });
    return;
  }

  await db.delete(pushSubscriptionsTable).where(
    and(eq(pushSubscriptionsTable.userId, userId), eq(pushSubscriptionsTable.endpoint, endpoint)),
  );

  await db.insert(pushSubscriptionsTable).values({
    userId,
    endpoint,
    p256dh: keys.p256dh,
    auth: keys.auth,
  });

  res.status(201).json({ success: true });
});

router.delete("/notifications/subscribe", async (req, res): Promise<void> => {
  if (!req.isAuthenticated()) { res.status(401).json({ error: "Unauthorized" }); return; }
  const userId = req.gameUserId;

  const { endpoint } = req.body as { endpoint?: string };
  if (!endpoint) {
    res.status(400).json({ error: "endpoint is required" });
    return;
  }

  await db.delete(pushSubscriptionsTable).where(
    and(eq(pushSubscriptionsTable.userId, userId), eq(pushSubscriptionsTable.endpoint, endpoint)),
  );

  res.json({ success: true });
});

router.get("/notifications/subscribed", async (req, res): Promise<void> => {
  if (!req.isAuthenticated()) { res.status(401).json({ error: "Unauthorized" }); return; }
  const userId = req.gameUserId;

  const subs = await db.select().from(pushSubscriptionsTable)
    .where(eq(pushSubscriptionsTable.userId, userId));
  res.json({ subscribed: subs.length > 0, count: subs.length });
});

function prefsShape(u: {
  notifyProtection: boolean; notifyReminders: boolean; notifyReflection: boolean;
  notifyHero: boolean; quietHoursStart: number; quietHoursEnd: number;
}) {
  return {
    protection: u.notifyProtection,
    reminders: u.notifyReminders,
    reflection: u.notifyReflection,
    hero: u.notifyHero,
    quietHoursStart: u.quietHoursStart,
    quietHoursEnd: u.quietHoursEnd,
  };
}

router.get("/users/me/notification-prefs", async (req, res): Promise<void> => {
  if (!req.isAuthenticated()) { res.status(401).json({ error: "Unauthorized" }); return; }
  const [user] = await db.select().from(usersTable).where(eq(usersTable.id, req.gameUserId));
  if (!user) { res.status(401).json({ error: "Unauthorized" }); return; }
  res.json(prefsShape(user));
});

router.put("/users/me/notification-prefs", async (req, res): Promise<void> => {
  if (!req.isAuthenticated()) { res.status(401).json({ error: "Unauthorized" }); return; }
  const parsed = validatePrefsBody(req.body);
  if (!parsed.ok) { res.status(400).json({ error: parsed.error }); return; }
  const v = parsed.value;
  const [updated] = await db.update(usersTable)
    .set({
      notifyProtection: v.protection,
      notifyReminders: v.reminders,
      notifyReflection: v.reflection,
      notifyHero: v.hero,
      quietHoursStart: v.quietHoursStart,
      quietHoursEnd: v.quietHoursEnd,
    })
    .where(eq(usersTable.id, req.gameUserId))
    .returning();
  if (!updated) { res.status(401).json({ error: "Unauthorized" }); return; }
  res.json(prefsShape(updated));
});

export default router;
