import { Router, type IRouter } from "express";
import { eq, and, desc } from "drizzle-orm";
import { db, usersTable, tasksTable, activityTable, focusSessionsTable, type FocusSession } from "@workspace/db";
import { PRESETS, getPreset, computeIntervalXp, computePartialXp, expectedElapsedSeconds, FULL_SET_BONUS, GRACE_SECONDS } from "../lib/focus-sessions";
import { grantInitiationAwards } from "../lib/initiation-grant";
import type { InitiationXp } from "../lib/initiation";

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
  const tz = typeof req.query.tz === "string" ? req.query.tz : undefined;
  const config = preset ? getPreset(preset) : undefined;
  if (!config) { res.status(400).json({ error: "Unknown preset" }); return; }

  // ─── Critical section ────────────────────────────────────────────────────────
  // Lock the user row so the "check for an existing active session, then insert"
  // sequence is atomic. Without this, two concurrent starts from the same user
  // can both pass the existing-session check and each insert an active row.
  type TxOutcome =
    | { status: "no_user" }
    | { status: "already_active"; existing: FocusSession }
    | { status: "bad_task" }
    | { status: "completed_task" }
    | { status: "ok"; session: FocusSession; initiationXp: InitiationXp };

  const outcome = await db.transaction(async (tx): Promise<TxOutcome> => {
    const [user] = await tx.select().from(usersTable)
      .where(eq(usersTable.id, userId))
      .for("update");
    if (!user) return { status: "no_user" };

    const [existingActive] = await tx.select().from(focusSessionsTable)
      .where(and(eq(focusSessionsTable.userId, userId), eq(focusSessionsTable.status, "active")));
    if (existingActive) return { status: "already_active", existing: existingActive };

    let eventTask: { id: number; title: string; questlineId: number | null } | null = null;
    if (taskId != null) {
      const [task] = await tx.select().from(tasksTable)
        .where(and(eq(tasksTable.id, taskId), eq(tasksTable.userId, userId)));
      if (!task) return { status: "bad_task" };
      if (task.completed) return { status: "completed_task" };
      eventTask = { id: task.id, title: task.title, questlineId: task.questlineId ?? null };
    }

    const [session] = await tx.insert(focusSessionsTable).values({
      userId,
      taskId: taskId ?? null,
      preset: config.key,
      focusMinutes: config.focusMinutes,
      breakMinutes: config.breakMinutes,
      longBreakMinutes: config.longBreakMinutes,
      longBreakEvery: config.longBreakEvery,
      plannedCycles: config.plannedCycles,
    }).returning();

    const initiationXp = await grantInitiationAwards(
      tx, user, { type: "session_start", task: eventTask }, tz,
    );

    return { status: "ok", session, initiationXp };
  });
  // ─────────────────────────────────────────────────────────────────────────────

  if (outcome.status === "no_user") { res.status(404).json({ error: "User not found" }); return; }
  if (outcome.status === "already_active") {
    res.status(409).json({ error: "A focus session is already active", session: formatSession(outcome.existing) });
    return;
  }
  if (outcome.status === "bad_task") { res.status(400).json({ error: "Task not found" }); return; }
  if (outcome.status === "completed_task") { res.status(400).json({ error: "Cannot focus on a completed quest" }); return; }

  res.status(201).json({ ...formatSession(outcome.session), initiationXp: outcome.initiationXp });
});

// Credit the NEXT completed focus interval. Idempotent on intervalIndex; XP is
// server-computed from validated wall-clock elapsed.
router.post("/focus-sessions/:id/interval", async (req, res): Promise<void> => {
  if (!req.isAuthenticated()) { res.status(401).json({ error: "Unauthorized" }); return; }
  const userId = req.gameUserId;

  const raw = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const id = parseInt(raw, 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }

  const intervalIndex = Number((req.body as { intervalIndex?: number }).intervalIndex);
  if (!Number.isInteger(intervalIndex) || intervalIndex < 1) {
    res.status(400).json({ error: "intervalIndex must be a positive integer" });
    return;
  }

  const now = new Date();

  type Outcome =
    | { status: "not_found" }
    | { status: "not_active" }
    | { status: "duplicate"; session: FocusSession }
    | { status: "gap" }
    | { status: "too_early" }
    | { status: "ok"; session: FocusSession; xpDelta: number };

  const outcome = await db.transaction(async (tx): Promise<Outcome> => {
    // Lock the user row so concurrent credits can't read stale point totals.
    const [user] = await tx.select().from(usersTable).where(eq(usersTable.id, userId)).for("update");
    if (!user) return { status: "not_found" };

    const [session] = await tx.select().from(focusSessionsTable)
      .where(and(eq(focusSessionsTable.id, id), eq(focusSessionsTable.userId, userId)))
      .for("update");
    if (!session) return { status: "not_found" };
    if (session.status !== "active") return { status: "not_active" };

    // Ordering / idempotency.
    if (intervalIndex <= session.completedIntervals) return { status: "duplicate", session };
    if (intervalIndex !== session.completedIntervals + 1) return { status: "gap" };

    // Anti-cheat: breaks-excluded wall-clock lower bound.
    const requiredSec = expectedElapsedSeconds(session.focusMinutes, intervalIndex) - GRACE_SECONDS;
    const elapsedSec = Math.floor((now.getTime() - session.startedAt.getTime()) / 1000);
    if (elapsedSec < requiredSec) return { status: "too_early" };

    const intervalXp = computeIntervalXp(session.focusMinutes);
    const isFinal = intervalIndex === session.plannedCycles;
    const xpDelta = intervalXp + (isFinal ? FULL_SET_BONUS : 0);

    await tx.update(usersTable).set({
      totalPoints: user.totalPoints + xpDelta,
      weeklyPoints: user.weeklyPoints + xpDelta,
    }).where(eq(usersTable.id, userId));

    const [updated] = await tx.update(focusSessionsTable).set({
      completedIntervals: intervalIndex,
      focusedSeconds: session.focusedSeconds + session.focusMinutes * 60,
      xpAwarded: session.xpAwarded + xpDelta,
      lastIntervalAt: now,
      ...(isFinal ? { status: "completed", endedAt: now } : {}),
    }).where(eq(focusSessionsTable.id, id)).returning();

    // Roll the completed focus block into the linked task, if any.
    if (session.taskId != null) {
      const [task] = await tx.select().from(tasksTable)
        .where(and(eq(tasksTable.id, session.taskId), eq(tasksTable.userId, userId)));
      if (task) {
        await tx.update(tasksTable)
          .set({ actualMinutes: (task.actualMinutes ?? 0) + session.focusMinutes })
          .where(eq(tasksTable.id, session.taskId));
      }
    }

    // One activity row per interval keeps points and the feed in agreement even
    // if the session is later abandoned.
    await tx.insert(activityTable).values({
      userId,
      type: "focus_session",
      description: `Focused ${session.focusMinutes} min`,
      points: intervalXp,
    });
    if (isFinal) {
      await tx.insert(activityTable).values({
        userId,
        type: "focus_complete",
        description: `Completed focus session · ${session.plannedCycles} cycles`,
        points: FULL_SET_BONUS,
      });
    }

    return { status: "ok", session: updated, xpDelta };
  });

  switch (outcome.status) {
    case "not_found": res.status(404).json({ error: "Focus session not found" }); return;
    case "not_active": res.status(409).json({ error: "Focus session is not active" }); return;
    case "gap": res.status(409).json({ error: "Interval out of order" }); return;
    case "too_early": res.status(409).json({ error: "Interval not yet elapsed" }); return;
    case "duplicate": res.status(200).json({ session: formatSession(outcome.session), xpDelta: 0 }); return;
    case "ok": res.status(200).json({ session: formatSession(outcome.session), xpDelta: outcome.xpDelta }); return;
  }
});

// End a session early. Credits trailing partial focus time (clamped to wall-clock),
// then marks the session stopped. Idempotent on an already-ended session.
router.post("/focus-sessions/:id/complete", async (req, res): Promise<void> => {
  if (!req.isAuthenticated()) { res.status(401).json({ error: "Unauthorized" }); return; }
  const userId = req.gameUserId;

  const raw = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const id = parseInt(raw, 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }

  const partialClaimRaw = Number((req.body as { partialSeconds?: number }).partialSeconds ?? 0);
  const partialClaim = Number.isFinite(partialClaimRaw) && partialClaimRaw > 0 ? Math.floor(partialClaimRaw) : 0;
  const now = new Date();

  type Outcome =
    | { status: "not_found" }
    | { status: "ok"; session: FocusSession; xpDelta: number };

  const outcome = await db.transaction(async (tx): Promise<Outcome> => {
    const [user] = await tx.select().from(usersTable).where(eq(usersTable.id, userId)).for("update");
    if (!user) return { status: "not_found" };

    const [session] = await tx.select().from(focusSessionsTable)
      .where(and(eq(focusSessionsTable.id, id), eq(focusSessionsTable.userId, userId)))
      .for("update");
    if (!session) return { status: "not_found" };

    // Already ended: idempotent no-op.
    if (session.status !== "active") return { status: "ok", session, xpDelta: 0 };

    // Clamp claimed partial focus to [0, focusMinutes*60] and to real elapsed since last activity.
    const sinceRefSec = Math.floor((now.getTime() - (session.lastIntervalAt ?? session.startedAt).getTime()) / 1000);
    const cappedSeconds = Math.max(0, Math.min(partialClaim, session.focusMinutes * 60, sinceRefSec));
    const partialMinutes = Math.floor(cappedSeconds / 60);
    const xpDelta = computePartialXp(partialMinutes);

    if (xpDelta > 0) {
      await tx.update(usersTable).set({
        totalPoints: user.totalPoints + xpDelta,
        weeklyPoints: user.weeklyPoints + xpDelta,
      }).where(eq(usersTable.id, userId));

      if (session.taskId != null) {
        const [task] = await tx.select().from(tasksTable)
          .where(and(eq(tasksTable.id, session.taskId), eq(tasksTable.userId, userId)));
        if (task) {
          await tx.update(tasksTable)
            .set({ actualMinutes: (task.actualMinutes ?? 0) + partialMinutes })
            .where(eq(tasksTable.id, session.taskId));
        }
      }

      await tx.insert(activityTable).values({
        userId,
        type: "focus_session",
        description: `Focused ${partialMinutes} min`,
        points: xpDelta,
      });
    }

    const [updated] = await tx.update(focusSessionsTable).set({
      status: "stopped",
      endedAt: now,
      focusedSeconds: session.focusedSeconds + partialMinutes * 60,
      xpAwarded: session.xpAwarded + xpDelta,
    }).where(eq(focusSessionsTable.id, id)).returning();

    return { status: "ok", session: updated, xpDelta };
  });

  if (outcome.status === "not_found") { res.status(404).json({ error: "Focus session not found" }); return; }
  res.status(200).json({ session: formatSession(outcome.session), xpDelta: outcome.xpDelta });
});

// Recent sessions for the current user (history / insights surface).
router.get("/focus-sessions", async (req, res): Promise<void> => {
  if (!req.isAuthenticated()) { res.status(401).json({ error: "Unauthorized" }); return; }
  const userId = req.gameUserId;

  const limitRaw = Number(req.query.limit ?? 20);
  const limit = Number.isFinite(limitRaw) ? Math.min(Math.max(1, Math.floor(limitRaw)), 100) : 20;

  const sessions = await db.select().from(focusSessionsTable)
    .where(eq(focusSessionsTable.userId, userId))
    .orderBy(desc(focusSessionsTable.startedAt))
    .limit(limit);

  res.json(sessions.map(formatSession));
});

export default router;
