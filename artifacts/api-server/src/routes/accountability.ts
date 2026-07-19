import { Router, type IRouter } from "express";
import { eq, or, and, desc, inArray, gte, isNull } from "drizzle-orm";
import { db, usersTable, partnershipsTable, activityTable, tasksTable, allyNudgesTable, pushSubscriptionsTable } from "@workspace/db";
import { getLevelInfo } from "../lib/gamification";
import { resolvePartnerRequest } from "../lib/partnerships";
import { buildHeroLook } from "./avatar";
import { getEarnedBadges } from "./badges";
import { MILESTONE_TYPES, hasFreshMilestone } from "../lib/ally-milestones";
import { resolveTimeZone, localDateKey, localDayStartUtc } from "../lib/date-buckets";
import { sendPushNotification } from "../lib/push-notifications";
import { isValidKind, isValidReaction, reactionLabel, canSendNudge, type NudgeKind } from "../lib/nudges";
import { awardSocialBadges } from "../lib/badge-awards";

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

  const timeZone = resolveTimeZone(typeof req.query.tz === "string" ? req.query.tz : undefined);
  const now = new Date();
  const today = localDateKey(now, timeZone);
  const dayStart = localDayStartUtc(today, timeZone);

  const partnerships = await db.select().from(partnershipsTable)
    .where(or(
      eq(partnershipsTable.requesterId, userId),
      eq(partnershipsTable.recipientId, userId),
    ));

  const result = await Promise.all(partnerships.map(async (p) => {
    const partnerId = p.requesterId === userId ? p.recipientId : p.requesterId;
    const [partner] = await db.select().from(usersTable).where(eq(usersTable.id, partnerId));

    let progress: { questsDueToday: number; questsCompletedToday: number; allDoneToday: boolean } | null = null;
    let freshMilestone = false;
    let sentTodayPoke = false;
    let sentTodayCheer = false;

    if (p.status === "accepted") {
      const todayTasks = await db.select().from(tasksTable)
        .where(and(eq(tasksTable.userId, partnerId), eq(tasksTable.dueDate, today)));
      const due = todayTasks.length;
      const done = todayTasks.filter((t) => t.completed).length;
      progress = { questsDueToday: due, questsCompletedToday: done, allDoneToday: due > 0 && done === due };

      const recentActivity = await db.select().from(activityTable)
        .where(and(
          eq(activityTable.userId, partnerId),
          inArray(activityTable.type, [...MILESTONE_TYPES]),
        ))
        .orderBy(desc(activityTable.createdAt))
        .limit(10);
      freshMilestone = hasFreshMilestone(recentActivity, now, 48);

      const flags = await sentTodayFlags(userId, partnerId, dayStart);
      sentTodayPoke = flags.sentTodayPoke;
      sentTodayCheer = flags.sentTodayCheer;
    }

    return {
      id: p.id,
      requesterId: p.requesterId,
      recipientId: p.recipientId,
      status: p.status,
      partner: partner ? formatUserSummary(partner) : null,
      createdAt: p.createdAt.toISOString(),
      progress,
      hasFreshMilestone: freshMilestone,
      sentTodayPoke,
      sentTodayCheer,
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
  // Both sides gained an ally, so both may have crossed a social badge tier.
  await Promise.all([awardSocialBadges(userId), awardSocialBadges(partnerId)]);

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

// NOTE: here :id is the ally's userId (unlike /accept|/decline|/feed, where it is a partnership id).
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
  const dayStart = localDayStartUtc(today, timeZone);

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

// NOTE: here :id is the ally's userId (unlike /accept|/decline|/feed, where it is a partnership id).
router.post("/accountability/partners/:id/nudge", async (req, res): Promise<void> => {
  if (!req.isAuthenticated()) { res.status(401).json({ error: "Unauthorized" }); return; }
  const userId = req.gameUserId;

  const raw = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const recipientId = parseInt(raw, 10);
  if (isNaN(recipientId)) { res.status(400).json({ error: "Invalid id" }); return; }
  if (recipientId === userId) { res.status(400).json({ error: "Cannot nudge yourself" }); return; }

  const { kind, reaction, contextType } = req.body as {
    kind?: string; reaction?: string; contextType?: string;
  };
  if (!kind || !isValidKind(kind)) { res.status(400).json({ error: "Invalid nudge kind" }); return; }
  if (!reaction || !isValidReaction(kind, reaction)) {
    res.status(400).json({ error: "Invalid reaction" }); return;
  }

  const partnership = await requireAcceptedPartnership(userId, recipientId);
  if (!partnership) { res.status(403).json({ error: "Not an active ally" }); return; }

  // Rate limit: one nudge of this kind per recipient per local day.
  const timeZone = resolveTimeZone(typeof req.query.tz === "string" ? req.query.tz : undefined);
  const dayStart = localDayStartUtc(localDateKey(new Date(), timeZone), timeZone);
  const priorToday = await db.select().from(allyNudgesTable).where(
    and(
      eq(allyNudgesTable.senderId, userId),
      eq(allyNudgesTable.recipientId, recipientId),
      eq(allyNudgesTable.kind, kind),
      gte(allyNudgesTable.createdAt, dayStart),
    ),
  );
  if (!canSendNudge(priorToday.length)) {
    res.status(429).json({
      error: kind === "poke" ? "You've already poked this ally today." : "You've already cheered this ally today.",
    });
    return;
  }

  const [nudge] = await db.insert(allyNudgesTable).values({
    senderId: userId,
    recipientId,
    kind,
    reaction,
    contextType: typeof contextType === "string" ? contextType : null,
  }).returning();

  await awardSocialBadges(userId);

  // Best-effort push to the recipient; never blocks persistence.
  const [sender] = await db.select().from(usersTable).where(eq(usersTable.id, userId));
  const label = reactionLabel(kind as NudgeKind, reaction) ?? "";
  const title = `${sender?.username ?? "An ally"} ${kind === "poke" ? "poked" : "cheered"} you`;
  const subs = await db.select().from(pushSubscriptionsTable)
    .where(eq(pushSubscriptionsTable.userId, recipientId));
  for (const sub of subs) {
    const ok = await sendPushNotification(
      { endpoint: sub.endpoint, p256dh: sub.p256dh, auth: sub.auth },
      { title, body: label, tag: `nudge-${kind}` },
    );
    if (!ok) {
      await db.delete(pushSubscriptionsTable).where(eq(pushSubscriptionsTable.endpoint, sub.endpoint));
    }
  }

  res.status(201).json({
    id: nudge.id,
    kind: nudge.kind,
    reaction: nudge.reaction,
    createdAt: nudge.createdAt.toISOString(),
  });
});

router.get("/accountability/nudges", async (req, res): Promise<void> => {
  if (!req.isAuthenticated()) { res.status(401).json({ error: "Unauthorized" }); return; }
  const userId = req.gameUserId;

  const limitRaw = Number(req.query.limit ?? 50);
  const limit = Number.isFinite(limitRaw) ? Math.min(Math.max(1, Math.floor(limitRaw)), 100) : 50;
  const offsetRaw = Number(req.query.offset ?? 0);
  const offset = Number.isFinite(offsetRaw) ? Math.max(0, Math.floor(offsetRaw)) : 0;

  const rows = await db.select().from(allyNudgesTable)
    .where(eq(allyNudgesTable.recipientId, userId))
    .orderBy(desc(allyNudgesTable.createdAt))
    .limit(limit)
    .offset(offset);

  const senderIds = [...new Set(rows.map((r) => r.senderId))];
  const senders = senderIds.length
    ? await db.select().from(usersTable).where(inArray(usersTable.id, senderIds))
    : [];
  const senderById = new Map(senders.map((s) => [s.id, s]));

  res.json(rows.map((r) => {
    const sender = senderById.get(r.senderId);
    return {
      id: r.id,
      kind: r.kind,
      reaction: r.reaction,
      reactionLabel: isValidKind(r.kind) ? reactionLabel(r.kind, r.reaction) : null,
      contextType: r.contextType,
      sender: sender ? formatUserSummary(sender) : null,
      createdAt: r.createdAt.toISOString(),
      readAt: r.readAt ? r.readAt.toISOString() : null,
    };
  }));
});

router.post("/accountability/nudges/read", async (req, res): Promise<void> => {
  if (!req.isAuthenticated()) { res.status(401).json({ error: "Unauthorized" }); return; }
  const userId = req.gameUserId;

  const { ids } = req.body as { ids?: number[] };
  const now = new Date();

  const scope = Array.isArray(ids) && ids.length > 0
    ? and(
        eq(allyNudgesTable.recipientId, userId),
        inArray(allyNudgesTable.id, ids.filter((n) => Number.isInteger(n))),
      )
    : eq(allyNudgesTable.recipientId, userId);

  const updated = await db.update(allyNudgesTable)
    .set({ readAt: now })
    .where(and(scope, isNull(allyNudgesTable.readAt)))
    .returning({ id: allyNudgesTable.id });

  res.json({ success: true, updated: updated.length });
});

export default router;
