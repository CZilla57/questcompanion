import { pgTable, serial, text, integer, timestamp, unique } from "drizzle-orm/pg-core";
import { usersTable } from "./users";

export type BattleResult = "win" | "lose";

export const weeklyBattlesTable = pgTable("weekly_battles", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().references(() => usersTable.id),
  weekKey: text("week_key").notNull(),
  powerScore: integer("power_score").notNull(),
  bossPower: integer("boss_power").notNull(),
  roll: integer("roll").notNull(),
  result: text("result").$type<BattleResult>().notNull(),
  xpAwarded: integer("xp_awarded").notNull(),
  foughtAt: timestamp("fought_at").notNull().defaultNow(),
}, (t) => [
  // One battle per user per week — makes the /battle/enter insert the atomic
  // dedup so concurrent enters can't double-award XP/coins.
  unique("weekly_battles_user_week_unique").on(t.userId, t.weekKey),
]);

export type WeeklyBattle = typeof weeklyBattlesTable.$inferSelect;
