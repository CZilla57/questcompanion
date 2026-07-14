import { pgTable, serial, integer, text, timestamp } from "drizzle-orm/pg-core";
import { usersTable } from "./users";
import { tasksTable } from "./tasks";

// One row per taken rescue intervention — Act V training data. Fire-and-forget
// from the client; never surfaced back to the user as counts (anti-shame).
export const rescueEventsTable = pgTable("rescue_events", {
  id:           serial("id").primaryKey(),
  userId:       integer("user_id").notNull().references(() => usersTable.id),
  taskId:       integer("task_id").references(() => tasksTable.id, { onDelete: "set null" }),
  blocker:      text("blocker").notNull(),      // 'too_big' | 'cant_start' | 'overwhelmed' | 'wrong_quest'
  intervention: text("intervention").notNull(), // 'breakdown' | 'micro_start' | 'emergency_mode' | 'reroll'
  createdAt:    timestamp("created_at").notNull().defaultNow(),
});

export type RescueEvent = typeof rescueEventsTable.$inferSelect;
