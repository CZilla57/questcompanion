import { Router, type IRouter } from "express";
import { db, usersTable, featActivationsTable, type User } from "@workspace/db";
import { and, eq } from "drizzle-orm";
import {
  getFeat,
  unlockedFeats,
  lockedFeats,
  type FeatDef,
} from "../lib/class-feats";
import { isFeatureUnlocked, effectiveLevel } from "../lib/feature-gates";
import {
  isBoostActive,
  nextBoostExpiry,
  canBuyStreakShield,
  MAX_STREAK_FREEZES,
  XP_BOOST_HOURS,
  FOCUS_BOOST_HOURS,
} from "../lib/stat-perks";
import { localDateKey } from "../lib/date-buckets";
import { resolveUserTimeZone } from "./patterns";

const router: IRouter = Router();

/** Gate: feats live inside the campaign layer — same unlock as the campaigns tab. */
function campaignsUnlocked(user: User): boolean {
  return isFeatureUnlocked(
    { totalPoints: user.totalPoints, highestLevel: user.highestLevel, unlockAll: user.unlockAll },
    "campaigns",
  );
}

/** Catalog entry + this user's live state. `readyToday`/`active` are active-only;
 *  a locked feat still lists its unlock level so a client can show "unlocks at N". */
function present(feat: FeatDef, ctx: { usedToday: Set<string>; user: User; now: Date }) {
  const base = {
    id: feat.id,
    heroClass: feat.heroClass,
    kind: feat.kind,
    unlockLevel: feat.unlockLevel,
    label: feat.label,
    emoji: feat.emoji,
    description: feat.description,
    grants: feat.grants ?? null,
    passiveKingdom: feat.passiveKingdom ?? null,
  };
  if (feat.kind !== "active") {
    return { ...base, readyToday: null, active: null, expiresAt: null, atMax: null };
  }
  const expiresAt =
    feat.grants === "focus_boost" ? ctx.user.focusBoostExpiresAt
    : feat.grants === "xp_boost" ? ctx.user.xpBoostExpiresAt
    : null;
  return {
    ...base,
    readyToday: !ctx.usedToday.has(feat.id),
    active: feat.grants === "streak_shield" ? null : isBoostActive(expiresAt, ctx.now),
    expiresAt: expiresAt ? expiresAt.toISOString() : null,
    atMax: feat.grants === "streak_shield" ? !canBuyStreakShield(ctx.user.streakFreezes) : null,
  };
}

router.get("/users/me/feats", async (req, res): Promise<void> => {
  if (!req.isAuthenticated()) { res.status(401).json({ error: "Unauthorized" }); return; }
  const userId = req.gameUserId!;
  const now = new Date();
  const [user] = await db.select().from(usersTable).where(eq(usersTable.id, userId));
  if (!user) { res.status(404).json({ error: "User not found" }); return; }

  // Locked behind the campaign era — an empty, non-error payload so a client
  // simply shows nothing (never a "you can't" nudge), same as the DM/party gates.
  if (!campaignsUnlocked(user)) { res.json({ unlocked: [], locked: [] }); return; }

  const timeZone = await resolveUserTimeZone(userId, req.query.tz);
  const today = localDateKey(now, timeZone);
  const level = effectiveLevel(user);

  const todaysRows = await db
    .select({ featId: featActivationsTable.featId })
    .from(featActivationsTable)
    .where(and(eq(featActivationsTable.userId, userId), eq(featActivationsTable.localDate, today)));
  const usedToday = new Set(todaysRows.map((r) => r.featId));

  const ctx = { usedToday, user, now };
  res.json({
    unlocked: unlockedFeats(user.avatarClass, level).map((f) => present(f, ctx)),
    locked: lockedFeats(user.avatarClass, level).map((f) => present(f, ctx)),
  });
});

router.post("/users/me/feats/:id/activate", async (req, res): Promise<void> => {
  if (!req.isAuthenticated()) { res.status(401).json({ error: "Unauthorized" }); return; }
  const userId = req.gameUserId!;
  const id = req.params.id!;
  const feat = getFeat(id);
  if (!feat || feat.kind !== "active") { res.status(404).json({ error: "Unknown feat" }); return; }

  const now = new Date();
  const timeZone = await resolveUserTimeZone(userId, req.body?.tz);
  const today = localDateKey(now, timeZone);

  type Outcome =
    | { status: "not_found" }
    | { status: "locked" }
    | { status: "on_cooldown" }
    | { status: "at_max" }
    | { status: "ok"; expiresAt: string | null; owned: number | null };

  const outcome = await db.transaction(async (tx): Promise<Outcome> => {
    // Lock the user: the unlock check, the once-a-day claim, and the grant must
    // be atomic so a double-tap can neither double-grant nor race the cooldown.
    const [user] = await tx.select().from(usersTable).where(eq(usersTable.id, userId)).for("update");
    if (!user) return { status: "not_found" };
    if (!campaignsUnlocked(user)) return { status: "locked" };
    if (feat.heroClass !== user.avatarClass || effectiveLevel(user) < feat.unlockLevel) {
      return { status: "locked" };
    }

    // Streak Shield at the cap is reassurance, not a spent turn — bail BEFORE
    // claiming the day so the free use isn't wasted on a no-op.
    if (feat.grants === "streak_shield" && !canBuyStreakShield(user.streakFreezes)) {
      return { status: "at_max" };
    }

    // The once-a-day claim: the (userId, featId, localDate) unique index makes
    // this the atomic gate. onConflictDoNothing → no row back means already used.
    const claimed = await tx
      .insert(featActivationsTable)
      .values({ userId, featId: feat.id, localDate: today })
      .onConflictDoNothing()
      .returning({ id: featActivationsTable.id });
    if (claimed.length === 0) return { status: "on_cooldown" };

    // Claimed — apply the earned grant, reusing the Stat Perk windows.
    if (feat.grants === "streak_shield") {
      const owned = user.streakFreezes + 1;
      await tx.update(usersTable).set({ streakFreezes: owned }).where(eq(usersTable.id, userId));
      return { status: "ok", expiresAt: null, owned };
    }
    const hours = feat.grants === "focus_boost" ? FOCUS_BOOST_HOURS : XP_BOOST_HOURS;
    const current = feat.grants === "focus_boost" ? user.focusBoostExpiresAt : user.xpBoostExpiresAt;
    const next = nextBoostExpiry(current, now, hours);
    const col = feat.grants === "focus_boost" ? { focusBoostExpiresAt: next } : { xpBoostExpiresAt: next };
    await tx.update(usersTable).set(col).where(eq(usersTable.id, userId));
    return { status: "ok", expiresAt: next.toISOString(), owned: null };
  });

  if (outcome.status === "not_found") { res.status(404).json({ error: "User not found" }); return; }
  // Everything else is HTTP 200 with a reason — a feat never reads as an error.
  if (outcome.status === "locked") {
    res.status(200).json({ activated: false, reason: "locked" }); return;
  }
  if (outcome.status === "on_cooldown") {
    res.status(200).json({ activated: false, reason: "on_cooldown" }); return;
  }
  if (outcome.status === "at_max") {
    res.status(200).json({ activated: false, reason: "at_max", owned: MAX_STREAK_FREEZES }); return;
  }
  res.status(200).json({
    activated: true, reason: "ok",
    expiresAt: outcome.expiresAt, owned: outcome.owned,
  });
});

export default router;
