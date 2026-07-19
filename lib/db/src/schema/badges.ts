import { pgTable, serial, text, integer, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { usersTable } from "./users";

export const badgesTable = pgTable("badges", {
  id: serial("id").primaryKey(),
  name: text("name").notNull().unique(),
  description: text("description").notNull(),
  icon: text("icon").notNull(),
  // Presentation grouping shown in the UI (`streak` | `tasks` | `points` |
  // `social` | `level` | `habit_streak`).
  category: text("category").notNull(),
  // Which counter `requirement` is compared against.  Most categories map 1:1 to
  // a single metric, but `social` spans several (allies, nudges_sent,
  // boss_attacks), so the metric — not the category — drives awarding.
  // Server-side only; deliberately not exposed on the API.
  metric: text("metric").notNull(),
  requirement: integer("requirement").notNull(),
});

export const userBadgesTable = pgTable("user_badges", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().references(() => usersTable.id),
  badgeId: integer("badge_id").notNull().references(() => badgesTable.id),
  earnedAt: timestamp("earned_at").notNull().defaultNow(),
}, (t) => [
  uniqueIndex("user_badges_user_id_badge_id_idx").on(t.userId, t.badgeId),
]);

export type Badge = typeof badgesTable.$inferSelect;
export type UserBadge = typeof userBadgesTable.$inferSelect;
