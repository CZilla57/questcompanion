import { pgTable, serial, integer, text, timestamp, index } from "drizzle-orm/pg-core";
import { usersTable } from "./users";

// One row per one-tap check-in. Mode is always DERIVED from the newest row
// (4h TTL + local-day bound) — never stored as user state. Never written to
// the activity feed (anti-shame: modes must not leak into ally surfaces).
export const brainCheckinsTable = pgTable("brain_checkins", {
  id:        serial("id").primaryKey(),
  userId:    integer("user_id").notNull().references(() => usersTable.id),
  mode:      text("mode").notNull(),   // 'focused' | 'distracted' | 'frozen' | 'hyperfocus' | 'neutral'
  source:    text("source").notNull().default("tap"), // 'tap' | 'daily_prompt' | 'emergency_exit'
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (t) => [
  // Serves the "newest check-in for user" lookup on every state read.
  index("brain_checkins_user_time_idx").on(t.userId, t.createdAt),
]);

export type BrainCheckin = typeof brainCheckinsTable.$inferSelect;
