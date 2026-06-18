import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import { db, usersTable, gearItemsTable, userGearTable } from "@workspace/db";
import { getLevelInfo } from "../lib/gamification";

const router: IRouter = Router();

const AVATAR_CLASSES = ["fighter", "mage", "ranger", "healer"] as const;
const AVATAR_SKINS   = ["light", "tan", "brown", "dark", "green", "blue"] as const;
const AVATAR_COLORS  = ["#00FFFF", "#A855F7", "#F97316", "#22C55E", "#EC4899", "#EAB308", "#6366F1", "#F43F5E"];

function calcBattlePower(level: number, equippedPower: number): number {
  return 30 + level * 5 + equippedPower;
}

async function buildAvatarResponse(userId: number) {
  const [user] = await db.select().from(usersTable).where(eq(usersTable.id, userId));
  if (!user) return null;

  const ownedGear = await db
    .select({ gear: gearItemsTable, userGear: userGearTable })
    .from(userGearTable)
    .innerJoin(gearItemsTable, eq(userGearTable.gearItemId, gearItemsTable.id))
    .where(eq(userGearTable.userId, userId));

  const equipped = ownedGear.filter(g => g.userGear.equipped);
  const equippedPower = equipped.reduce((sum, g) => sum + g.gear.statPower, 0);
  const levelInfo = getLevelInfo(user.totalPoints);

  return {
    avatarColor:      user.avatarColor,
    avatarClass:      user.avatarClass,
    avatarSkin:       user.avatarSkin ?? "light",
    level:            levelInfo.level,
    battlePower:      calcBattlePower(levelInfo.level, equippedPower),
    equippedGear:     equipped.map(g => ({
      id:        g.gear.id,
      name:      g.gear.name,
      slot:      g.gear.slot,
      rarity:    g.gear.rarity,
      statPower: g.gear.statPower,
      icon:      g.gear.icon,
    })),
    availableColors:  AVATAR_COLORS,
    availableClasses: [...AVATAR_CLASSES],
    availableSkins:   [...AVATAR_SKINS],
  };
}

router.get("/avatar", async (req, res): Promise<void> => {
  if (!req.isAuthenticated()) { res.status(401).json({ error: "Unauthorized" }); return; }
  const result = await buildAvatarResponse(req.gameUserId);
  if (!result) { res.status(404).json({ error: "User not found" }); return; }
  res.json(result);
});

router.patch("/avatar", async (req, res): Promise<void> => {
  if (!req.isAuthenticated()) { res.status(401).json({ error: "Unauthorized" }); return; }
  const userId = req.gameUserId;

  const { avatarColor, avatarClass, avatarSkin } = req.body as {
    avatarColor?: string;
    avatarClass?: string;
    avatarSkin?: string;
  };
  const updates: Partial<typeof usersTable.$inferInsert> = {};

  if (avatarColor != null) {
    if (!/^#[0-9A-Fa-f]{6}$/.test(avatarColor)) {
      res.status(400).json({ error: "Invalid color format" }); return;
    }
    updates.avatarColor = avatarColor;
  }
  if (avatarClass != null) {
    if (!(AVATAR_CLASSES as readonly string[]).includes(avatarClass)) {
      res.status(400).json({ error: "Invalid avatar class" }); return;
    }
    updates.avatarClass = avatarClass;
  }
  if (avatarSkin != null) {
    if (!(AVATAR_SKINS as readonly string[]).includes(avatarSkin)) {
      res.status(400).json({ error: "Invalid avatar skin" }); return;
    }
    updates.avatarSkin = avatarSkin;
  }

  if (Object.keys(updates).length === 0) {
    res.status(400).json({ error: "Nothing to update" }); return;
  }

  await db.update(usersTable).set(updates).where(eq(usersTable.id, userId));

  const result = await buildAvatarResponse(userId);
  if (!result) { res.status(404).json({ error: "User not found" }); return; }
  res.json(result);
});

export { calcBattlePower };
export default router;
