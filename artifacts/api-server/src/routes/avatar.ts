import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import { db, usersTable, gearItemsTable, userGearTable } from "@workspace/db";
import { getLevelInfo } from "../lib/gamification";
import {
  builds, skins, hairStyles, hairColors, faces, classes, colors,
  beardStyles, beardColors, glasses, earrings,
  ids, includesId,
} from "@workspace/hero-options";

const router: IRouter = Router();

function calcBattlePower(level: number, equippedPower: number): number {
  return 30 + level * 5 + equippedPower;
}

export async function buildHeroLook(userId: number) {
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
    avatarHairStyle:  user.avatarHairStyle  ?? "short",
    avatarHairColor:  user.avatarHairColor  ?? "brown",
    avatarBodyBuild:  user.avatarBodyBuild  ?? "male",
    avatarFace:       user.avatarFace       ?? "neutral",
    avatarBeardStyle: user.avatarBeardStyle ?? "none",
    avatarBeardColor: user.avatarBeardColor ?? "brown",
    avatarGlasses:    user.avatarGlasses    ?? "none",
    avatarEarrings:   user.avatarEarrings   ?? "none",
    level:            levelInfo.level,
    battlePower:      calcBattlePower(levelInfo.level, equippedPower),
    equippedGear:     equipped.map(g => ({
      id:        g.gear.id,
      name:      g.gear.name,
      slot:      g.gear.slot,
      rarity:    g.gear.rarity,
      statPower: g.gear.statPower,
      icon:      g.gear.icon,
      spriteId:  g.gear.spriteId ?? null,
    })),
  };
}

async function buildAvatarResponse(userId: number) {
  const hero = await buildHeroLook(userId);
  if (!hero) return null;
  return {
    ...hero,
    availableColors:  ids(colors),
    availableClasses: ids(classes),
    availableSkins:   ids(skins),
    availableHairStyles: ids(hairStyles),
    availableHairColors: ids(hairColors),
    availableBuilds:     ids(builds),
    availableFaces:      ids(faces),
    availableBeardStyles: ids(beardStyles),
    availableBeardColors: ids(beardColors),
    availableGlasses:     ids(glasses),
    availableEarrings:    ids(earrings),
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

  const { avatarColor, avatarClass, avatarSkin,
          avatarHairStyle, avatarHairColor, avatarBodyBuild, avatarFace,
          avatarBeardStyle, avatarBeardColor, avatarGlasses, avatarEarrings } = req.body as {
    avatarColor?: string; avatarClass?: string; avatarSkin?: string;
    avatarHairStyle?: string; avatarHairColor?: string;
    avatarBodyBuild?: string; avatarFace?: string;
    avatarBeardStyle?: string; avatarBeardColor?: string;
    avatarGlasses?: string; avatarEarrings?: string;
  };
  const updates: Partial<typeof usersTable.$inferInsert> = {};

  if (avatarColor != null) {
    if (!/^#[0-9A-Fa-f]{6}$/.test(avatarColor)) {
      res.status(400).json({ error: "Invalid color format" }); return;
    }
    updates.avatarColor = avatarColor;
  }
  if (avatarClass != null) {
    if (!includesId(classes, avatarClass)) {
      res.status(400).json({ error: "Invalid avatar class" }); return;
    }
    updates.avatarClass = avatarClass;
  }
  if (avatarSkin != null) {
    if (!includesId(skins, avatarSkin)) {
      res.status(400).json({ error: "Invalid avatar skin" }); return;
    }
    updates.avatarSkin = avatarSkin;
  }
  if (avatarHairStyle != null) {
    if (!includesId(hairStyles, avatarHairStyle)) {
      res.status(400).json({ error: "Invalid hair style" }); return;
    }
    updates.avatarHairStyle = avatarHairStyle;
  }
  if (avatarHairColor != null) {
    if (!includesId(hairColors, avatarHairColor)) {
      res.status(400).json({ error: "Invalid hair color" }); return;
    }
    updates.avatarHairColor = avatarHairColor;
  }
  if (avatarBodyBuild != null) {
    if (!includesId(builds, avatarBodyBuild)) {
      res.status(400).json({ error: "Invalid body build" }); return;
    }
    updates.avatarBodyBuild = avatarBodyBuild;
  }
  if (avatarFace != null) {
    if (!includesId(faces, avatarFace)) {
      res.status(400).json({ error: "Invalid face" }); return;
    }
    updates.avatarFace = avatarFace;
  }
  if (avatarBeardStyle != null) {
    if (!includesId(beardStyles, avatarBeardStyle)) { res.status(400).json({ error: "Invalid beard style" }); return; }
    updates.avatarBeardStyle = avatarBeardStyle;
  }
  if (avatarBeardColor != null) {
    if (!includesId(beardColors, avatarBeardColor)) { res.status(400).json({ error: "Invalid beard color" }); return; }
    updates.avatarBeardColor = avatarBeardColor;
  }
  if (avatarGlasses != null) {
    if (!includesId(glasses, avatarGlasses)) { res.status(400).json({ error: "Invalid glasses" }); return; }
    updates.avatarGlasses = avatarGlasses;
  }
  if (avatarEarrings != null) {
    if (!includesId(earrings, avatarEarrings)) { res.status(400).json({ error: "Invalid earrings" }); return; }
    updates.avatarEarrings = avatarEarrings;
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
