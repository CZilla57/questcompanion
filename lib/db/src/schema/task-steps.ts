import { pgTable, serial, integer, text, boolean, timestamp } from "drizzle-orm/pg-core";
import { usersTable } from "./users";
import { tasksTable } from "./tasks";

export const taskStepsTable = pgTable("task_steps", {
  id: serial("id").primaryKey(),
  // Steps are cascade-deleted with their parent quest.
  taskId: integer("task_id").notNull().references(() => tasksTable.id, { onDelete: "cascade" }),
  // Denormalized so ownership checks are a plain WHERE, matching focus_sessions.
  userId: integer("user_id").notNull().references(() => usersTable.id),
  text: text("text").notNull(),
  position: integer("position").notNull(), // stable 0-based ordering
  done: boolean("done").notNull().default(false),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export type TaskStep = typeof taskStepsTable.$inferSelect;
