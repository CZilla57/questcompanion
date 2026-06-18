import { eq, sql } from "drizzle-orm";
import { db, usersTable, activityTable } from "@workspace/db";
import { awardStreakGear, type GearRewardInfo } from "./gear-rewards.js";
import type { GearRarity } from "@workspace/db";

export type SurpriseRewardResult =
  | { type: "xp";   xpAmount: number }
  | { type: "gear"; gear: GearRewardInfo }
  | null;

// 12 % trigger chance — sporadic enough to feel like a genuine surprise
const TRIGGER_CHANCE = 0.12;
const XP_MIN = 75;
const XP_MAX = 250;

// 40 % gear drop, 60 % XP — both feel meaningful at these amounts
const GEAR_CHANCE = 0.4;

const RARITY_WEIGHTS: { rarity: GearRarity; weight: number }[] = [
  { rarity: "common",    weight: 55 },
  { rarity: "rare",      weight: 30 },
  { rarity: "epic",      weight: 12 },
  { rarity: "legendary", weight:  3 },
];

function pickGearRarity(): GearRarity {
  const total = RARITY_WEIGHTS.reduce((s, r) => s + r.weight, 0);
  let roll = Math.random() * total;
  for (const { rarity, weight } of RARITY_WEIGHTS) {
    if (roll < weight) return rarity;
    roll -= weight;
  }
  return "common";
}

async function awardSurpriseXp(userId: number): Promise<{ type: "xp"; xpAmount: number }> {
  const xpAmount = XP_MIN + Math.floor(Math.random() * (XP_MAX - XP_MIN + 1));
  await db.update(usersTable).set({
    totalPoints:  sql`${usersTable.totalPoints}  + ${xpAmount}`,
    weeklyPoints: sql`${usersTable.weeklyPoints} + ${xpAmount}`,
  }).where(eq(usersTable.id, userId));
  await db.insert(activityTable).values({
    userId,
    type: "surprise_reward",
    description: `Lucky surprise! Bonus ${xpAmount} XP dropped from the quest.`,
    points: xpAmount,
  });
  return { type: "xp", xpAmount };
}

/**
 * Roll for a random surprise reward on task completion.
 * ~12% chance triggers; result is either bonus XP (60%) or a free gear drop (40%).
 * Gear falls back to XP if the user already owns all qualifying items.
 */
export async function rollSurpriseReward(
  userId: number,
  userLevel: number,
): Promise<SurpriseRewardResult> {
  if (Math.random() >= TRIGGER_CHANCE) return null;

  if (Math.random() < GEAR_CHANCE) {
    const rarity = pickGearRarity();
    const gear = await awardStreakGear(userId, userLevel, rarity, "surprise drop");
    if (gear) return { type: "gear", gear };
    // All qualifying gear already owned — fall back to XP
  }

  return awardSurpriseXp(userId);
}
