import { pgTable, serial, integer, text, timestamp, jsonb, unique } from "drizzle-orm/pg-core";
import { usersTable } from "./users";

// One row per user per local day. Created when the evening question is first
// drafted; answering updates the row in place (drafted ≠ answered — see
// answeredAt). Reflection CONTENT never reaches the activity feed or any ally
// surface (anti-shame); the +5 XP grant writes a content-free activity row.
export const reflectionsTable = pgTable("reflections", {
  id:           serial("id").primaryKey(),
  userId:       integer("user_id").notNull().references(() => usersTable.id),
  localDate:    text("local_date").notNull(),    // YYYY-MM-DD in the user's tz (UTC fallback)
  prompt:       text("prompt").notNull(),
  promptSource: text("prompt_source").notNull(), // 'ai' | 'fallback'
  // Selected chip keys. No column default — every insert passes chips: [].
  chips:        jsonb("chips").$type<string[]>().notNull(),
  freeText:     text("free_text"),
  ack:          text("ack"),
  answeredAt:   timestamp("answered_at"),
  createdAt:    timestamp("created_at").notNull().defaultNow(),
}, (t) => [
  // One reflection per local day; concurrent first-drafts converge on one row
  // via onConflictDoNothing + re-select.
  unique("reflections_user_day_unique").on(t.userId, t.localDate),
]);

export type Reflection = typeof reflectionsTable.$inferSelect;
