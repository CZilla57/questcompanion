import { pgTable, serial, integer, text, timestamp, index } from "drizzle-orm/pg-core";
import { usersTable } from "./users";

export const allyNudgesTable = pgTable("ally_nudges", {
  id:          serial("id").primaryKey(),
  senderId:    integer("sender_id").notNull().references(() => usersTable.id),
  recipientId: integer("recipient_id").notNull().references(() => usersTable.id),
  kind:        text("kind").notNull(),          // 'poke' | 'cheer'
  reaction:    text("reaction").notNull(),      // canned reaction key
  contextType: text("context_type"),            // optional cue label
  readAt:      timestamp("read_at"),            // null = unread
  createdAt:   timestamp("created_at").notNull().defaultNow(),
}, (t) => [
  index("ally_nudges_recipient_idx").on(t.recipientId),
  index("ally_nudges_sender_recipient_kind_idx").on(t.senderId, t.recipientId, t.kind, t.createdAt),
]);

export type AllyNudge = typeof allyNudgesTable.$inferSelect;
