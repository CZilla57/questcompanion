import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import { db, badgesTable, userBadgesTable } from "@workspace/db";

const router: IRouter = Router();

router.get("/badges", async (_req, res): Promise<void> => {
  const badges = await db.select().from(badgesTable);
  res.json(badges.map((b) => ({
    id: b.id,
    name: b.name,
    description: b.description,
    icon: b.icon,
    category: b.category,
    requirement: b.requirement,
  })));
});

export async function getEarnedBadges(userId: number) {
  const userBadges = await db.select({
    id: badgesTable.id,
    name: badgesTable.name,
    description: badgesTable.description,
    icon: badgesTable.icon,
    category: badgesTable.category,
    requirement: badgesTable.requirement,
    earnedAt: userBadgesTable.earnedAt,
  }).from(userBadgesTable)
    .innerJoin(badgesTable, eq(userBadgesTable.badgeId, badgesTable.id))
    .where(eq(userBadgesTable.userId, userId));

  return userBadges.map((ub) => ({
    badge: {
      id: ub.id,
      name: ub.name,
      description: ub.description,
      icon: ub.icon,
      category: ub.category,
      requirement: ub.requirement,
    },
    earnedAt: ub.earnedAt.toISOString(),
  }));
}

router.get("/users/me/badges", async (req, res): Promise<void> => {
  if (!req.isAuthenticated()) { res.status(401).json({ error: "Unauthorized" }); return; }
  res.json(await getEarnedBadges(req.gameUserId));
});

export default router;
