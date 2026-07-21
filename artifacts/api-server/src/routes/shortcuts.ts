import { Router, type IRouter } from "express";
import { and, desc, eq, or } from "drizzle-orm";
import { db, tasksTable, usersTable } from "@workspace/db";
import { buildCaptureFields, buildTodayPayload, CAPTURE_MAX_LEN } from "../lib/shortcuts";
import { captureCooldown, todayCooldown } from "../lib/shortcut-cooldowns";
import { localDateKey, resolveTimeZone } from "../lib/date-buckets";

const router: IRouter = Router();

// Pocket Gate endpoints (spec §7): consumed by the two iPhone Shortcuts, not
// the web client. The middleware owns session-vs-token auth; these handlers
// only ever see isAuthenticated(). Completion deliberately has no endpoint
// here — the Shortcut calls the real POST /tasks/:id/complete (spec D7).

router.post("/shortcuts/capture", async (req, res): Promise<void> => {
  if (!req.isAuthenticated()) { res.status(401).json({ error: "Unauthorized" }); return; }
  const userId = req.gameUserId;

  const text = typeof req.body?.text === "string" ? req.body.text.trim() : "";
  if (!text) { res.status(400).json({ error: "text is required" }); return; }
  if (text.length > CAPTURE_MAX_LEN) { res.status(400).json({ error: "text is too long" }); return; }
  if (!captureCooldown.tryAcquire(userId)) {
    res.status(429).json({ error: "Slow down a moment before capturing again." });
    return;
  }

  const [user] = await db.select({ timezone: usersTable.timezone }).from(usersTable)
    .where(eq(usersTable.id, userId));
  const fields = buildCaptureFields(text, { timezone: user?.timezone ?? null, now: new Date() });

  const [task] = await db.insert(tasksTable).values({
    userId,
    title: fields.title,
    points: fields.points,
    dueDate: fields.dueDate,
    dueTime: fields.dueTime,
    priority: fields.priority,
    category: fields.category,
    isAnchored: false, // D5: capture never auto-anchors
    questlineId: null,
  }).returning();
  if (!task) { res.status(500).json({ error: "Task insert failed" }); return; }

  res.status(201).json({
    ok: true, id: task.id, title: task.title, dueDate: task.dueDate, message: fields.message,
  });
});

router.get("/shortcuts/today", async (req, res): Promise<void> => {
  if (!req.isAuthenticated()) { res.status(401).json({ error: "Unauthorized" }); return; }
  const userId = req.gameUserId;

  if (!todayCooldown.tryAcquire(userId)) {
    res.status(429).json({ error: "Slow down a moment." });
    return;
  }

  const [user] = await db.select({ timezone: usersTable.timezone }).from(usersTable)
    .where(eq(usersTable.id, userId));
  const tz = resolveTimeZone(user?.timezone);
  const todayKey = localDateKey(new Date(), tz);

  // Same buckets as the app's today view (GET /tasks?date=…): quests dated
  // local-today plus incomplete anchored quests, incomplete only, app order.
  const rows = await db.select({ id: tasksTable.id, title: tasksTable.title }).from(tasksTable)
    .where(and(
      eq(tasksTable.userId, userId),
      eq(tasksTable.completed, false),
      or(eq(tasksTable.dueDate, todayKey), eq(tasksTable.isAnchored, true)),
    ))
    .orderBy(desc(tasksTable.isAnchored), desc(tasksTable.createdAt));

  res.json(buildTodayPayload(rows));
});

export default router;
