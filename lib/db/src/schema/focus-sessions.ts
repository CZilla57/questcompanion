import { pgTable, serial, integer, text, timestamp } from "drizzle-orm/pg-core";
import { usersTable } from "./users";
import { tasksTable } from "./tasks";

export const focusSessionsTable = pgTable("focus_sessions", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().references(() => usersTable.id),
  // Optional link to a quest; focused minutes roll up into the task's actualMinutes.
  taskId: integer("task_id").references(() => tasksTable.id, { onDelete: "set null" }),
  preset: text("preset").notNull(), // 'classic' | 'deep' | 'short'
  // Config snapshotted at start so a later preset change never shifts an in-flight session.
  focusMinutes: integer("focus_minutes").notNull(),
  breakMinutes: integer("break_minutes").notNull(),
  longBreakMinutes: integer("long_break_minutes").notNull(),
  longBreakEvery: integer("long_break_every").notNull(),
  plannedCycles: integer("planned_cycles").notNull(),
  completedIntervals: integer("completed_intervals").notNull().default(0),
  focusedSeconds: integer("focused_seconds").notNull().default(0), // server-derived
  xpAwarded: integer("xp_awarded").notNull().default(0),            // audit only
  status: text("status").notNull().default("active"),              // 'active' | 'completed' | 'stopped'
  startedAt: timestamp("started_at").notNull().defaultNow(),
  lastIntervalAt: timestamp("last_interval_at"),
  endedAt: timestamp("ended_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export type FocusSession = typeof focusSessionsTable.$inferSelect;
