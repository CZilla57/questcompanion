import { Router, type IRouter } from "express";
import { eq, and, or, inArray, isNull } from "drizzle-orm";
import {
  db, usersTable, partnershipsTable, pushSubscriptionsTable, activityTable,
  bodyDoubleRoomsTable, bodyDoubleMembersTable, bodyDoubleSprintsTable,
  type BodyDoubleRoom,
} from "@workspace/db";
import { requireAcceptedPartnership, formatUserSummary } from "./accountability";
import { buildHeroLook } from "./avatar";
import { sendPushNotification } from "../lib/push-notifications";
import { logger } from "../lib/logger";
import {
  presenceOf, isSprintMinutes, sprintElapsedOk, sprintBonusXp,
  eligibleMembers, canWave, shouldSendInvitePush,
} from "../lib/body-double";

const router: IRouter = Router();

function parseId(raw: string | string[]): number | null {
  const s = Array.isArray(raw) ? raw[0] : raw;
  const n = parseInt(s, 10);
  return isNaN(n) ? null : n;
}

async function acceptedAllyIds(userId: number): Promise<number[]> {
  const rows = await db.select().from(partnershipsTable).where(
    and(
      eq(partnershipsTable.status, "accepted"),
      or(eq(partnershipsTable.requesterId, userId), eq(partnershipsTable.recipientId, userId)),
    ),
  );
  return rows.map((p) => (p.requesterId === userId ? p.recipientId : p.requesterId));
}

// Full room state — counts and states only, never tasks or in-room "output"
// (same privacy stance as ally progress).
async function buildRoomState(room: BodyDoubleRoom, viewerId: number) {
  const now = new Date();
  const memberRows = await db.select({ member: bodyDoubleMembersTable, user: usersTable })
    .from(bodyDoubleMembersTable)
    .innerJoin(usersTable, eq(bodyDoubleMembersTable.userId, usersTable.id))
    .where(and(eq(bodyDoubleMembersTable.roomId, room.id), isNull(bodyDoubleMembersTable.leftAt)))
    .orderBy(bodyDoubleMembersTable.joinedAt);
  const [live] = await db.select().from(bodyDoubleSprintsTable)
    .where(and(eq(bodyDoubleSprintsTable.roomId, room.id), isNull(bodyDoubleSprintsTable.completedAt)));
  const members = await Promise.all(memberRows.map(async ({ member, user }) => ({
    ...formatUserSummary(user),
    hero: await buildHeroLook(user.id),
    isHost: user.id === room.hostId,
    presence: presenceOf(member.lastSeenAt, now),
    joinedAt: member.joinedAt.toISOString(),
    waveAt: member.lastWaveAt ? member.lastWaveAt.toISOString() : null,
  })));
  return {
    id: room.id,
    hostId: room.hostId,
    status: room.status,
    createdAt: room.createdAt.toISOString(),
    endedAt: room.endedAt ? room.endedAt.toISOString() : null,
    isMine: room.hostId === viewerId,
    members,
    sprint: live ? {
      id: live.id,
      minutes: live.minutes,
      startedBy: live.startedBy,
      startedAt: live.startedAt.toISOString(),
    } : null,
    serverNow: now.toISOString(),
  };
}

/** One best-effort push per accepted ally on room open (D3, poke precedent). */
async function sendRoomInvites(hostId: number): Promise<void> {
  const now = new Date();
  const [host] = await db.select().from(usersTable).where(eq(usersTable.id, hostId));
  if (!host) return;
  const allyIds = await acceptedAllyIds(hostId);
  if (allyIds.length === 0) return;
  const allies = await db.select().from(usersTable).where(inArray(usersTable.id, allyIds));
  const title = `${host.username} opened a body-double room`;
  for (const ally of allies) {
    if (!shouldSendInvitePush(ally, now)) continue; // deep-night/quiet-hours courtesy
    const subs = await db.select().from(pushSubscriptionsTable)
      .where(eq(pushSubscriptionsTable.userId, ally.id));
    for (const sub of subs) {
      const ok = await sendPushNotification(
        { endpoint: sub.endpoint, p256dh: sub.p256dh, auth: sub.auth },
        { title, body: "Drop in and work alongside", tag: "bodydouble-invite", data: { url: "/focus" } },
      );
      if (!ok) {
        await db.delete(pushSubscriptionsTable).where(eq(pushSubscriptionsTable.endpoint, sub.endpoint));
      }
    }
  }
}

// My open room + open rooms of my accepted allies (list poll, ~30 s).
router.get("/body-double/rooms/open", async (req, res): Promise<void> => {
  if (!req.isAuthenticated()) { res.status(401).json({ error: "Unauthorized" }); return; }
  const userId = req.gameUserId;
  const allyIds = await acceptedAllyIds(userId);
  const rooms = await db.select({ room: bodyDoubleRoomsTable, host: usersTable })
    .from(bodyDoubleRoomsTable)
    .innerJoin(usersTable, eq(bodyDoubleRoomsTable.hostId, usersTable.id))
    .where(and(
      eq(bodyDoubleRoomsTable.status, "open"),
      inArray(bodyDoubleRoomsTable.hostId, [...allyIds, userId]),
    ))
    .orderBy(bodyDoubleRoomsTable.createdAt);
  const roomIds = rooms.map((r) => r.room.id);
  const members = roomIds.length > 0
    ? await db.select().from(bodyDoubleMembersTable)
        .where(and(inArray(bodyDoubleMembersTable.roomId, roomIds), isNull(bodyDoubleMembersTable.leftAt)))
    : [];
  res.json({
    rooms: rooms.map(({ room, host }) => ({
      id: room.id,
      host: formatUserSummary(host),
      isMine: room.hostId === userId,
      amMember: members.some((m) => m.roomId === room.id && m.userId === userId),
      memberCount: members.filter((m) => m.roomId === room.id).length,
      createdAt: room.createdAt.toISOString(),
    })),
  });
});

// Open a room. 409 with the existing room if I already host an open one.
router.post("/body-double/rooms", async (req, res): Promise<void> => {
  if (!req.isAuthenticated()) { res.status(401).json({ error: "Unauthorized" }); return; }
  const userId = req.gameUserId;

  type Outcome =
    | { status: "no_user" }
    | { status: "already_open"; existing: BodyDoubleRoom }
    | { status: "ok"; room: BodyDoubleRoom };

  const outcome = await db.transaction(async (tx): Promise<Outcome> => {
    // Lock the user row so concurrent creates can't both pass the open-room
    // check (same critical-section grammar as focus-session start).
    const [user] = await tx.select().from(usersTable).where(eq(usersTable.id, userId)).for("update");
    if (!user) return { status: "no_user" };
    const [existing] = await tx.select().from(bodyDoubleRoomsTable)
      .where(and(eq(bodyDoubleRoomsTable.hostId, userId), eq(bodyDoubleRoomsTable.status, "open")));
    if (existing) return { status: "already_open", existing };
    const [room] = await tx.insert(bodyDoubleRoomsTable).values({ hostId: userId }).returning();
    await tx.insert(bodyDoubleMembersTable).values({ roomId: room.id, userId });
    return { status: "ok", room };
  });

  if (outcome.status === "no_user") { res.status(404).json({ error: "User not found" }); return; }
  if (outcome.status === "already_open") {
    res.status(409).json({
      error: "You already have an open room",
      room: await buildRoomState(outcome.existing, userId),
    });
    return;
  }

  // Best-effort invites before responding (poke precedent) — failures never
  // block room creation.
  try {
    await sendRoomInvites(userId);
  } catch (err) {
    logger.error({ err, roomId: outcome.room.id }, "body-double invite push failed");
  }

  res.status(201).json(await buildRoomState(outcome.room, userId));
});

// Room state — THE 10 s poll. Viewing as an active member touches presence:
// the poll IS the heartbeat.
router.get("/body-double/rooms/:id", async (req, res): Promise<void> => {
  if (!req.isAuthenticated()) { res.status(401).json({ error: "Unauthorized" }); return; }
  const userId = req.gameUserId;
  const id = parseId(req.params.id);
  if (id === null) { res.status(400).json({ error: "Invalid id" }); return; }

  const [room] = await db.select().from(bodyDoubleRoomsTable).where(eq(bodyDoubleRoomsTable.id, id));
  if (!room) { res.status(404).json({ error: "Room not found" }); return; }

  const [myRow] = await db.select().from(bodyDoubleMembersTable)
    .where(and(eq(bodyDoubleMembersTable.roomId, id), eq(bodyDoubleMembersTable.userId, userId)));
  if (!myRow && room.hostId !== userId) {
    const partnership = await requireAcceptedPartnership(userId, room.hostId);
    if (!partnership) { res.status(403).json({ error: "Only the host's allies can view this room" }); return; }
  }

  if (myRow && myRow.leftAt === null && room.status === "open") {
    await db.update(bodyDoubleMembersTable).set({ lastSeenAt: new Date() })
      .where(eq(bodyDoubleMembersTable.id, myRow.id));
  }

  res.json(await buildRoomState(room, userId));
});

// Drop in. Rejoin clears left_at on the same row.
router.post("/body-double/rooms/:id/join", async (req, res): Promise<void> => {
  if (!req.isAuthenticated()) { res.status(401).json({ error: "Unauthorized" }); return; }
  const userId = req.gameUserId;
  const id = parseId(req.params.id);
  if (id === null) { res.status(400).json({ error: "Invalid id" }); return; }

  const [room] = await db.select().from(bodyDoubleRoomsTable).where(eq(bodyDoubleRoomsTable.id, id));
  if (!room) { res.status(404).json({ error: "Room not found" }); return; }
  if (room.status !== "open") { res.status(409).json({ error: "This room has wrapped up" }); return; }
  if (room.hostId !== userId) {
    const partnership = await requireAcceptedPartnership(userId, room.hostId);
    if (!partnership) { res.status(403).json({ error: "Only the host's allies can drop in" }); return; }
  }

  await db.insert(bodyDoubleMembersTable)
    .values({ roomId: id, userId })
    .onConflictDoUpdate({
      target: [bodyDoubleMembersTable.roomId, bodyDoubleMembersTable.userId],
      set: { leftAt: null, lastSeenAt: new Date() },
    });

  res.status(200).json(await buildRoomState(room, userId));
});

// Leave gracefully. Host leaving ends the room (D4). Idempotent.
router.post("/body-double/rooms/:id/leave", async (req, res): Promise<void> => {
  if (!req.isAuthenticated()) { res.status(401).json({ error: "Unauthorized" }); return; }
  const userId = req.gameUserId;
  const id = parseId(req.params.id);
  if (id === null) { res.status(400).json({ error: "Invalid id" }); return; }

  const [room] = await db.select().from(bodyDoubleRoomsTable).where(eq(bodyDoubleRoomsTable.id, id));
  if (!room) { res.status(404).json({ error: "Room not found" }); return; }
  const [myRow] = await db.select().from(bodyDoubleMembersTable)
    .where(and(eq(bodyDoubleMembersTable.roomId, id), eq(bodyDoubleMembersTable.userId, userId)));
  if (!myRow) { res.status(404).json({ error: "You're not in this room" }); return; }

  const now = new Date();
  if (myRow.leftAt === null) {
    await db.update(bodyDoubleMembersTable).set({ leftAt: now })
      .where(eq(bodyDoubleMembersTable.id, myRow.id));
  }

  let ended = room.status !== "open";
  if (room.hostId === userId && room.status === "open") {
    await db.update(bodyDoubleRoomsTable).set({ status: "ended", endedAt: now })
      .where(and(eq(bodyDoubleRoomsTable.id, id), eq(bodyDoubleRoomsTable.status, "open")));
    ended = true;
  }

  res.status(200).json({ left: true, ended });
});

// 👋 — soft-capped server-side; a rate-limited wave is a quiet 200, never an error.
router.post("/body-double/rooms/:id/wave", async (req, res): Promise<void> => {
  if (!req.isAuthenticated()) { res.status(401).json({ error: "Unauthorized" }); return; }
  const userId = req.gameUserId;
  const id = parseId(req.params.id);
  if (id === null) { res.status(400).json({ error: "Invalid id" }); return; }

  const [room] = await db.select().from(bodyDoubleRoomsTable).where(eq(bodyDoubleRoomsTable.id, id));
  if (!room) { res.status(404).json({ error: "Room not found" }); return; }
  const [myRow] = await db.select().from(bodyDoubleMembersTable)
    .where(and(eq(bodyDoubleMembersTable.roomId, id), eq(bodyDoubleMembersTable.userId, userId)));
  if (!myRow || myRow.leftAt !== null || room.status !== "open") {
    res.status(409).json({ error: "Join the room to wave" });
    return;
  }

  const now = new Date();
  if (!canWave(myRow.lastWaveAt, now)) { res.status(200).json({ waved: false }); return; }
  await db.update(bodyDoubleMembersTable).set({ lastWaveAt: now })
    .where(eq(bodyDoubleMembersTable.id, myRow.id));
  res.status(200).json({ waved: true });
});

// Start a shared sprint. The partial unique index makes the INSERT the
// one-live-sprint-per-room guard (insert-as-guard, world-boss grammar).
router.post("/body-double/rooms/:id/sprints", async (req, res): Promise<void> => {
  if (!req.isAuthenticated()) { res.status(401).json({ error: "Unauthorized" }); return; }
  const userId = req.gameUserId;
  const id = parseId(req.params.id);
  if (id === null) { res.status(400).json({ error: "Invalid id" }); return; }

  const minutes = (req.body as { minutes?: unknown }).minutes;
  if (!isSprintMinutes(minutes)) { res.status(400).json({ error: "minutes must be 15, 25, or 50" }); return; }

  const [room] = await db.select().from(bodyDoubleRoomsTable).where(eq(bodyDoubleRoomsTable.id, id));
  if (!room) { res.status(404).json({ error: "Room not found" }); return; }
  if (room.status !== "open") { res.status(409).json({ error: "This room has wrapped up" }); return; }
  const [myRow] = await db.select().from(bodyDoubleMembersTable)
    .where(and(eq(bodyDoubleMembersTable.roomId, id), eq(bodyDoubleMembersTable.userId, userId)));
  if (!myRow || myRow.leftAt !== null) { res.status(403).json({ error: "Join the room first" }); return; }

  const [sprint] = await db.insert(bodyDoubleSprintsTable)
    .values({ roomId: id, minutes, startedBy: userId })
    .onConflictDoNothing()
    .returning();
  if (!sprint) { res.status(409).json({ error: "A sprint is already running in this room" }); return; }

  res.status(201).json({
    id: sprint.id,
    minutes: sprint.minutes,
    startedBy: sprint.startedBy,
    startedAt: sprint.startedAt.toISOString(),
  });
});

// Finish a sprint: validated wall-clock, exactly-once payout via guarded claim.
// Any member's client may call it when the countdown hits zero; races are 200
// soft no-ops (anti-shame: never an error for showing up).
router.post("/body-double/rooms/:id/sprints/:sprintId/finish", async (req, res): Promise<void> => {
  if (!req.isAuthenticated()) { res.status(401).json({ error: "Unauthorized" }); return; }
  const userId = req.gameUserId;
  const roomId = parseId(req.params.id);
  const sprintId = parseId(req.params.sprintId);
  if (roomId === null || sprintId === null) { res.status(400).json({ error: "Invalid id" }); return; }

  const now = new Date();

  type Outcome =
    | { status: "not_found" }
    | { status: "not_member" }
    | { status: "too_early" }
    | { status: "already_done" }
    | { status: "ok"; xpEach: number; paidUserIds: number[] };

  const outcome = await db.transaction(async (tx): Promise<Outcome> => {
    const [sprint] = await tx.select().from(bodyDoubleSprintsTable)
      .where(and(eq(bodyDoubleSprintsTable.id, sprintId), eq(bodyDoubleSprintsTable.roomId, roomId)));
    if (!sprint) return { status: "not_found" };

    const [myRow] = await tx.select().from(bodyDoubleMembersTable)
      .where(and(eq(bodyDoubleMembersTable.roomId, roomId), eq(bodyDoubleMembersTable.userId, userId)));
    if (!myRow || myRow.leftAt !== null) return { status: "not_member" };

    if (sprint.completedAt) return { status: "already_done" };
    if (!sprintElapsedOk(sprint.startedAt, sprint.minutes, now)) return { status: "too_early" };

    // Exactly-once claim: the guarded UPDATE elects a single payer.
    const [claimed] = await tx.update(bodyDoubleSprintsTable)
      .set({ completedAt: now })
      .where(and(eq(bodyDoubleSprintsTable.id, sprint.id), isNull(bodyDoubleSprintsTable.completedAt)))
      .returning();
    if (!claimed) return { status: "already_done" };

    const memberRows = await tx.select().from(bodyDoubleMembersTable)
      .where(and(eq(bodyDoubleMembersTable.roomId, roomId), isNull(bodyDoubleMembersTable.leftAt)));
    const eligible = eligibleMembers(memberRows);
    // Company is the reward: a solo-completed sprint completes quietly — no
    // bonus, no sad copy.
    if (eligible.length < 2) return { status: "ok", xpEach: 0, paidUserIds: [] };

    const xpEach = sprintBonusXp(sprint.minutes);
    // Lock payee rows in deterministic id order to prevent deadlocks
    // (world-boss payout grammar).
    const payees = await tx.select().from(usersTable)
      .where(inArray(usersTable.id, eligible.map((m) => m.userId)))
      .orderBy(usersTable.id)
      .for("update");
    for (const p of payees) {
      await tx.update(usersTable).set({
        totalPoints: p.totalPoints + xpEach,
        weeklyPoints: p.weeklyPoints + xpEach,
      }).where(eq(usersTable.id, p.id));
      const others = payees.length - 1;
      await tx.insert(activityTable).values({
        userId: p.id,
        type: "body_double",
        description: `Sprint together · ${sprint.minutes} min with ${others === 1 ? "an ally" : `${others} allies`}`,
        points: xpEach,
      });
    }
    return { status: "ok", xpEach, paidUserIds: payees.map((p) => p.id) };
  });

  switch (outcome.status) {
    case "not_found": res.status(404).json({ error: "Sprint not found" }); return;
    case "not_member": res.status(403).json({ error: "Join the room first" }); return;
    case "too_early": res.status(409).json({ error: "The sprint isn't finished yet" }); return;
    case "already_done": res.status(200).json({ completed: true, xpAwarded: 0, membersPaid: 0 }); return;
    case "ok":
      res.status(200).json({
        completed: true,
        xpAwarded: outcome.paidUserIds.includes(userId) ? outcome.xpEach : 0,
        membersPaid: outcome.paidUserIds.length,
      });
      return;
  }
});

export default router;
