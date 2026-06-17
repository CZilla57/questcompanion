import { pgTable, serial, text, integer, boolean, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { usersTable } from "./users";

export const tasksTable = pgTable("tasks", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().references(() => usersTable.id),
  recurringTaskId: integer("recurring_task_id"),
  title: text("title").notNull(),
  description: text("description"),
  points: integer("points").notNull().default(10),

  // Snapshot written at completion time so uncomplete can reverse exactly what was granted.
  pointsAwarded: integer("points_awarded"),
  dailyBonusAwarded: boolean("daily_bonus_awarded").notNull().default(false),
  streakDaysBefore: integer("streak_days_before"),
  longestStreakBefore: integer("longest_streak_before"),
  lastActiveDateBefore: text("last_active_date_before"),
  freezeConsumedOnComplete: boolean("freeze_consumed_on_complete").notNull().default(false),
  badgesGrantedIds: text("badges_granted_ids"),
  habitStreakSnapshot: text("habit_streak_snapshot"),

  completed: boolean("completed").notNull().default(false),
  completedAt: timestamp("completed_at"),
  dueDate: text("due_date").notNull(),
  priority: text("priority").notNull().default("medium"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const insertTaskSchema = createInsertSchema(tasksTable).omit({ id: true, createdAt: true, completedAt: true, completed: true });
export type InsertTask = z.infer<typeof insertTaskSchema>;
export type Task = typeof tasksTable.$inferSelect;
