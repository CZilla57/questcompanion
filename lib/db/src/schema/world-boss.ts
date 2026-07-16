import { pgTable, serial, text, integer, timestamp, unique } from "drizzle-orm/pg-core";
import { usersTable } from "./users";

// One shared boss per ISO week for the whole server. Created lazily on the first
// view/attack of a new week. `unique(weekKey)` makes lazy creation an atomic
// onConflictDoNothing insert.
export const worldBossWeeksTable = pgTable("world_boss_weeks", {
  id:          serial("id").primaryKey(),
  weekKey:     text("week_key").notNull().unique(), // e.g. "2026-W29"
  hp:          integer("hp").notNull(),             // snapshotted from the HP curve at creation
  totalDamage: integer("total_damage").notNull().default(0),
  defeatedAt:  timestamp("defeated_at"),            // null until felled
  createdAt:   timestamp("created_at").notNull().defaultNow(),
});

// One row per user per day: a single daily attack. `unique(userId, dayKey)` is the
// atomic once-per-day dedup — the insert IS the dedup (mirrors weekly_battles).
export const worldBossAttacksTable = pgTable("world_boss_attacks", {
  id:        serial("id").primaryKey(),
  userId:    integer("user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  weekKey:   text("week_key").notNull(),  // denormalized for cheap per-week aggregation
  dayKey:    text("day_key").notNull(),   // "YYYY-MM-DD" (UTC) — the dedup key
  damage:    integer("damage").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (t) => [
  unique("world_boss_attacks_user_day_unique").on(t.userId, t.dayKey),
]);

export type WorldBossWeek = typeof worldBossWeeksTable.$inferSelect;
export type WorldBossAttack = typeof worldBossAttacksTable.$inferSelect;
