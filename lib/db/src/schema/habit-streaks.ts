import { pgTable, serial, integer, text, timestamp } from "drizzle-orm/pg-core";
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
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export type HabitStreak = typeof habitStreaksTable.$inferSelect;
