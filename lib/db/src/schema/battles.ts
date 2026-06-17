import { pgTable, serial, text, integer, timestamp } from "drizzle-orm/pg-core";
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
});

export type WeeklyBattle = typeof weeklyBattlesTable.$inferSelect;
