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
  completed: boolean("completed").notNull().default(false),
  completedAt: timestamp("completed_at"),
  dueDate: text("due_date").notNull(),
  priority: text("priority").notNull().default("medium"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const insertTaskSchema = createInsertSchema(tasksTable).omit({ id: true, createdAt: true, completedAt: true, completed: true });
export type InsertTask = z.infer<typeof insertTaskSchema>;
export type Task = typeof tasksTable.$inferSelect;
