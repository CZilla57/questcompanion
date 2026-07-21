import { pgTable, serial, integer, text, timestamp, unique, uniqueIndex } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { usersTable } from "./users";

// Act IV Body-Doubling Rooms. A room is an open door: accepted allies of the
// host may drop in and co-work with ambient presence. All FKs to users cascade
// so the account-delete schema walk stays FK-safe.
export const bodyDoubleRoomsTable = pgTable("body_double_rooms", {
  id: serial("id").primaryKey(),
  hostId: integer("host_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  status: text("status").notNull().default("open"), // 'open' | 'ended'
  createdAt: timestamp("created_at").notNull().defaultNow(),
  endedAt: timestamp("ended_at"),
});

export const bodyDoubleMembersTable = pgTable("body_double_members", {
  id: serial("id").primaryKey(),
  roomId: integer("room_id").notNull().references(() => bodyDoubleRoomsTable.id, { onDelete: "cascade" }),
  userId: integer("user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  joinedAt: timestamp("joined_at").notNull().defaultNow(),
  // The ONLY "gone" signal — presence staleness never means "left" (anti-shame:
  // a locked phone is a body double working, not a body double gone).
  leftAt: timestamp("left_at"),
  lastSeenAt: timestamp("last_seen_at").notNull().defaultNow(), // touched by the state poll
  lastWaveAt: timestamp("last_wave_at"),
}, (t) => [
  // Rejoin = clear left_at on the existing row, never a second row.
  unique("body_double_members_room_user_unique").on(t.roomId, t.userId),
]);

export const bodyDoubleSprintsTable = pgTable("body_double_sprints", {
  id: serial("id").primaryKey(),
  roomId: integer("room_id").notNull().references(() => bodyDoubleRoomsTable.id, { onDelete: "cascade" }),
  minutes: integer("minutes").notNull(), // ∈ {15, 25, 50}
  startedBy: integer("started_by").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  startedAt: timestamp("started_at").notNull().defaultNow(),
  // Null = live. Setting it is the exactly-once payout claim (world-boss grammar).
  completedAt: timestamp("completed_at"),
}, (t) => [
  // One live sprint per room: the partial unique makes the INSERT the guard.
  uniqueIndex("body_double_sprints_live_room_unique").on(t.roomId).where(sql`${t.completedAt} IS NULL`),
]);

export type BodyDoubleRoom = typeof bodyDoubleRoomsTable.$inferSelect;
export type BodyDoubleMember = typeof bodyDoubleMembersTable.$inferSelect;
export type BodyDoubleSprint = typeof bodyDoubleSprintsTable.$inferSelect;
