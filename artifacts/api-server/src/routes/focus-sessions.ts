import { Router, type IRouter } from "express";
import { eq, and, desc } from "drizzle-orm";
import { db, tasksTable, focusSessionsTable, type FocusSession } from "@workspace/db";
import { PRESETS, getPreset } from "../lib/focus-sessions";

const router: IRouter = Router();

function formatSession(s: FocusSession) {
  return {
    id: s.id,
    userId: s.userId,
    taskId: s.taskId ?? null,
    preset: s.preset,
    focusMinutes: s.focusMinutes,
    breakMinutes: s.breakMinutes,
    longBreakMinutes: s.longBreakMinutes,
    longBreakEvery: s.longBreakEvery,
    plannedCycles: s.plannedCycles,
    completedIntervals: s.completedIntervals,
    focusedSeconds: s.focusedSeconds,
    xpAwarded: s.xpAwarded,
    status: s.status,
    startedAt: s.startedAt.toISOString(),
    lastIntervalAt: s.lastIntervalAt ? s.lastIntervalAt.toISOString() : null,
    endedAt: s.endedAt ? s.endedAt.toISOString() : null,
    createdAt: s.createdAt.toISOString(),
  };
}

// Preset catalog — the client renders its picker and running timer from this so
// labels/durations never drift from the server.
router.get("/focus-sessions/presets", (_req, res): void => {
  res.json(Object.values(PRESETS).map((p) => ({
    key: p.key,
    label: p.label,
    focusMinutes: p.focusMinutes,
    breakMinutes: p.breakMinutes,
    longBreakMinutes: p.longBreakMinutes,
    longBreakEvery: p.longBreakEvery,
    plannedCycles: p.plannedCycles,
  })));
});

// The user's current active session, or null (drives resume-on-load).
router.get("/focus-sessions/active", async (req, res): Promise<void> => {
  if (!req.isAuthenticated()) { res.status(401).json({ error: "Unauthorized" }); return; }
  const userId = req.gameUserId;
  const [active] = await db.select().from(focusSessionsTable)
    .where(and(eq(focusSessionsTable.userId, userId), eq(focusSessionsTable.status, "active")))
    .orderBy(desc(focusSessionsTable.startedAt));
  res.json(active ? formatSession(active) : null);
});

// Start a session. 409s if one is already active (client should resume it).
router.post("/focus-sessions", async (req, res): Promise<void> => {
  if (!req.isAuthenticated()) { res.status(401).json({ error: "Unauthorized" }); return; }
  const userId = req.gameUserId;

  const { preset, taskId } = req.body as { preset?: string; taskId?: number };
  const config = preset ? getPreset(preset) : undefined;
  if (!config) { res.status(400).json({ error: "Unknown preset" }); return; }

  const [existingActive] = await db.select().from(focusSessionsTable)
    .where(and(eq(focusSessionsTable.userId, userId), eq(focusSessionsTable.status, "active")));
  if (existingActive) {
    res.status(409).json({ error: "A focus session is already active", session: formatSession(existingActive) });
    return;
  }

  if (taskId != null) {
    const [task] = await db.select().from(tasksTable)
      .where(and(eq(tasksTable.id, taskId), eq(tasksTable.userId, userId)));
    if (!task) { res.status(400).json({ error: "Task not found" }); return; }
    if (task.completed) { res.status(400).json({ error: "Cannot focus on a completed quest" }); return; }
  }

  const [session] = await db.insert(focusSessionsTable).values({
    userId,
    taskId: taskId ?? null,
    preset: config.key,
    focusMinutes: config.focusMinutes,
    breakMinutes: config.breakMinutes,
    longBreakMinutes: config.longBreakMinutes,
    longBreakEvery: config.longBreakEvery,
    plannedCycles: config.plannedCycles,
  }).returning();

  res.status(201).json(formatSession(session));
});

export default router;
