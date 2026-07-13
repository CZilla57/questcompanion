import { Router, type IRouter } from "express";
import { eq, or, and, desc, inArray, gte } from "drizzle-orm";
import { db, usersTable, partnershipsTable, activityTable, tasksTable, allyNudgesTable } from "@workspace/db";
import { getLevelInfo } from "../lib/gamification";
import { resolvePartnerRequest } from "../lib/partnerships";
import { buildHeroLook } from "./avatar";
import { getEarnedBadges } from "./badges";
import { MILESTONE_TYPES } from "../lib/ally-milestones";
import { resolveTimeZone, localDateKey } from "../lib/date-buckets";

const router: IRouter = Router();

function formatUserSummary(u: typeof usersTable.$inferSelect) {
  const lvl = getLevelInfo(u.totalPoints);
  return {
    id: u.id,
    username: u.username,
    displayName: u.displayName,
    avatarColor: u.avatarColor,
    currentLevel: lvl.level,
    levelName: lvl.name,
    totalPoints: u.totalPoints,
    streakDays: u.streakDays,
  };
}

/**
 * Returns the accepted partnership row linking `userId` and `otherId` (in either
 * direction), or null if there is none / it is not accepted.
 */
async function requireAcceptedPartnership(userId: number, otherId: number) {
  const [p] = await db.select().from(partnershipsTable).where(
    and(
      eq(partnershipsTable.status, "accepted"),
      or(
        and(eq(partnershipsTable.requesterId, userId), eq(partnershipsTable.recipientId, otherId)),
        and(eq(partnershipsTable.requesterId, otherId), eq(partnershipsTable.recipientId, userId)),
      ),
    ),
  );
  return p ?? null;
}

/** Count today's sent nudges of each kind for a sender→recipient pair. */
async function sentTodayFlags(senderId: number, recipientId: number, dayStart: Date) {
  const rows = await db.select().from(allyNudgesTable).where(
    and(
      eq(allyNudgesTable.senderId, senderId),
      eq(allyNudgesTable.recipientId, recipientId),
      gte(allyNudgesTable.createdAt, dayStart),
    ),
  );
  return {
    sentTodayPoke:  rows.some((r) => r.kind === "poke"),
    sentTodayCheer: rows.some((r) => r.kind === "cheer"),
  };
}

router.get("/accountability/partners", async (req, res): Promise<void> => {
  if (!req.isAuthenticated()) { res.status(401).json({ error: "Unauthorized" }); return; }
  const userId = req.gameUserId;

  const partnerships = await db.select().from(partnershipsTable)
    .where(or(
      eq(partnershipsTable.requesterId, userId),
      eq(partnershipsTable.recipientId, userId),
    ));

  const result = await Promise.all(partnerships.map(async (p) => {
    const partnerId = p.requesterId === userId ? p.recipientId : p.requesterId;
    const [partner] = await db.select().from(usersTable).where(eq(usersTable.id, partnerId));
    return {
      id: p.id,
      requesterId: p.requesterId,
      recipientId: p.recipientId,
      status: p.status,
      partner: partner ? formatUserSummary(partner) : null,
      createdAt: p.createdAt.toISOString(),
    };
  }));

  res.json(result);
});

router.post("/accountability/partners", async (req, res): Promise<void> => {
  if (!req.isAuthenticated()) { res.status(401).json({ error: "Unauthorized" }); return; }
  const userId = req.gameUserId;

  const { recipientId } = req.body as { recipientId?: number };
  if (!recipientId) {
    res.status(400).json({ error: "recipientId is required" });
    return;
  }

  if (recipientId === userId) {
    res.status(400).json({ error: "Cannot send a partnership request to yourself" });
    return;
  }

  const existing = await db.select().from(partnershipsTable).where(
    or(
      and(eq(partnershipsTable.requesterId, userId), eq(partnershipsTable.recipientId, recipientId)),
      and(eq(partnershipsTable.requesterId, recipientId), eq(partnershipsTable.recipientId, userId)),
    )
  );

  const decision = resolvePartnerRequest(existing);
  if (decision.action === "reject") {
    res.status(409).json({ error: decision.reason });
    return;
  }
  if (decision.action === "reactivate") {
    // Clear stale declined rows so a fresh request isn't blocked as a duplicate.
    await db.delete(partnershipsTable).where(inArray(partnershipsTable.id, decision.staleIds));
  }

  const [p] = await db.insert(partnershipsTable).values({
    requesterId: userId,
    recipientId,
    status: "pending",
  }).returning();

  const [partner] = await db.select().from(usersTable).where(eq(usersTable.id, recipientId));
  res.status(201).json({
    id: p.id,
    requesterId: p.requesterId,
    recipientId: p.recipientId,
    status: p.status,
    partner: partner ? formatUserSummary(partner) : null,
    createdAt: p.createdAt.toISOString(),
  });
});

router.post("/accountability/partners/:id/accept", async (req, res): Promise<void> => {
  if (!req.isAuthenticated()) { res.status(401).json({ error: "Unauthorized" }); return; }
  const userId = req.gameUserId;

  const raw = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const id = parseInt(raw, 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }

  const [p] = await db.update(partnershipsTable)
    .set({ status: "accepted" })
    .where(and(
      eq(partnershipsTable.id, id),
      eq(partnershipsTable.recipientId, userId),
      eq(partnershipsTable.status, "pending"),
    ))
    .returning();
  if (!p) { res.status(404).json({ error: "Partnership not found" }); return; }

  const partnerId = p.requesterId;
  const [partner] = await db.select().from(usersTable).where(eq(usersTable.id, partnerId));
  res.json({
    id: p.id,
    requesterId: p.requesterId,
    recipientId: p.recipientId,
    status: p.status,
    partner: partner ? formatUserSummary(partner) : null,
    createdAt: p.createdAt.toISOString(),
  });
});

router.post("/accountability/partners/:id/decline", async (req, res): Promise<void> => {
  if (!req.isAuthenticated()) { res.status(401).json({ error: "Unauthorized" }); return; }
  const userId = req.gameUserId;

  const raw = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const id = parseInt(raw, 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }

  // First, look up the named row to identify the other party.
  const [target] = await db.select().from(partnershipsTable)
    .where(and(
      eq(partnershipsTable.id, id),
      or(
        eq(partnershipsTable.requesterId, userId),
        eq(partnershipsTable.recipientId, userId),
      ),
    ));
  if (!target) { res.status(404).json({ error: "Partnership not found" }); return; }

  const partnerId = target.requesterId === userId ? target.recipientId : target.requesterId;

  // Revoke ALL rows between these two users to prevent duplicate-row access bypass.
  await db.update(partnershipsTable)
    .set({ status: "declined" })
    .where(
      or(
        and(eq(partnershipsTable.requesterId, userId), eq(partnershipsTable.recipientId, partnerId)),
        and(eq(partnershipsTable.requesterId, partnerId), eq(partnershipsTable.recipientId, userId)),
      )
    );

  const [partner] = await db.select().from(usersTable).where(eq(usersTable.id, partnerId));
  res.json({
    id: target.id,
    requesterId: target.requesterId,
    recipientId: target.recipientId,
    status: "declined",
    partner: partner ? formatUserSummary(partner) : null,
    createdAt: target.createdAt.toISOString(),
  });
});

router.get("/accountability/partners/:id/feed", async (req, res): Promise<void> => {
  if (!req.isAuthenticated()) { res.status(401).json({ error: "Unauthorized" }); return; }
  const userId = req.gameUserId;

  const raw = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const id = parseInt(raw, 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }

  const [partnership] = await db.select().from(partnershipsTable)
    .where(and(
      eq(partnershipsTable.id, id),
      or(
        eq(partnershipsTable.requesterId, userId),
        eq(partnershipsTable.recipientId, userId),
      )
    ));
  if (!partnership) { res.status(404).json({ error: "Partnership not found" }); return; }

  if (partnership.status !== "accepted") {
    res.status(403).json({ error: "Partnership is not active" });
    return;
  }

  const partnerId = partnership.requesterId === userId ? partnership.recipientId : partnership.requesterId;
  const [partner] = await db.select().from(usersTable).where(eq(usersTable.id, partnerId));

  const activity = await db.select().from(activityTable)
    .where(eq(activityTable.userId, partnerId))
    .orderBy(desc(activityTable.createdAt))
    .limit(20);

  res.json(activity.map((a) => ({
    id: a.id,
    userId: a.userId,
    username: partner?.username ?? "Unknown",
    type: a.type,
    description: a.description,
    points: a.points,
    createdAt: a.createdAt.toISOString(),
  })));
});

router.get("/accountability/partners/:id/detail", async (req, res): Promise<void> => {
  if (!req.isAuthenticated()) { res.status(401).json({ error: "Unauthorized" }); return; }
  const userId = req.gameUserId;

  const raw = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const partnerId = parseInt(raw, 10);
  if (isNaN(partnerId)) { res.status(400).json({ error: "Invalid id" }); return; }
  if (partnerId === userId) { res.status(400).json({ error: "Cannot view yourself as an ally" }); return; }

  const partnership = await requireAcceptedPartnership(userId, partnerId);
  if (!partnership) { res.status(403).json({ error: "Not an active ally" }); return; }

  const [partner] = await db.select().from(usersTable).where(eq(usersTable.id, partnerId));
  if (!partner) { res.status(404).json({ error: "Partner not found" }); return; }

  const timeZone = resolveTimeZone(typeof req.query.tz === "string" ? req.query.tz : undefined);
  const now = new Date();
  const today = localDateKey(now, timeZone);
  const dayStart = new Date(today + "T00:00:00Z");

  const todayTasks = await db.select().from(tasksTable)
    .where(and(eq(tasksTable.userId, partnerId), eq(tasksTable.dueDate, today)));
  const questsDueToday = todayTasks.length;
  const questsCompletedToday = todayTasks.filter((t) => t.completed).length;

  const hero = await buildHeroLook(partnerId);
  const badges = await getEarnedBadges(partnerId);

  const milestones = await db.select().from(activityTable)
    .where(and(
      eq(activityTable.userId, partnerId),
      inArray(activityTable.type, [...MILESTONE_TYPES]),
    ))
    .orderBy(desc(activityTable.createdAt))
    .limit(20);

  const flags = await sentTodayFlags(userId, partnerId, dayStart);

  res.json({
    partner: formatUserSummary(partner),
    progress: {
      questsDueToday,
      questsCompletedToday,
      allDoneToday: questsDueToday > 0 && questsCompletedToday === questsDueToday,
    },
    hero,
    badges,
    milestones: milestones.map((a) => ({
      id: a.id,
      userId: a.userId,
      type: a.type,
      description: a.description,
      points: a.points,
      createdAt: a.createdAt.toISOString(),
    })),
    ...flags,
  });
});

export default router;
