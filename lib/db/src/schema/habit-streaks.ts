import { pgTable, serial, integer, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { usersTable } from "./users";
import { recurringTasksTable } from "./recurring-tasks";

export const habitStreaksTable = pgTable("habit_streaks", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().references(() => usersTable.id),
  recurringTaskId: integer("recurring_task_id").notNull().references(() => recurringTasksTable.id),
  currentStreak: integer("current_streak").notNull().default(0),
  longestStreak: integer("longest_streak").notNull().default(0),
  totalCompletions: integer("total_completions").notNull().default(0),
  lastCompletedDate: text("last_completed_date"),
  // The cadence period the last completion belonged to ('2026-07' monthly,
  // '2026' yearly). NULL for weekly templates, which keep comparing calendar
  // days via lastCompletedDate.
  lastPeriodKey: text("last_period_key"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (t) => [
  uniqueIndex("habit_streaks_user_id_recurring_task_id_idx").on(t.userId, t.recurringTaskId),
]);

export type HabitStreak = typeof habitStreaksTable.$inferSelect;
