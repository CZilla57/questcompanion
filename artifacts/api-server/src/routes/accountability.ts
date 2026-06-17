import { Router, type IRouter } from "express";
import { eq, or, and, desc } from "drizzle-orm";
import { db, usersTable, partnershipsTable, activityTable } from "@workspace/db";
import { getLevelInfo } from "../lib/gamification";

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
  if (existing.length > 0) {
    res.status(409).json({ error: "Partnership already exists" });
    return;
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
    .where(and(eq(partnershipsTable.id, id), eq(partnershipsTable.recipientId, userId)))
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

  const [p] = await db.update(partnershipsTable)
    .set({ status: "declined" })
    .where(and(
      eq(partnershipsTable.id, id),
      or(
        eq(partnershipsTable.requesterId, userId),
        eq(partnershipsTable.recipientId, userId),
      ),
    ))
    .returning();
  if (!p) { res.status(404).json({ error: "Partnership not found" }); return; }

  const partnerId = p.requesterId === userId ? p.recipientId : p.requesterId;
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

export default router;
