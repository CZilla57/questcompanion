import { pgTable, serial, integer, text, timestamp, unique } from "drizzle-orm/pg-core";
import { usersTable } from "./users";

// Act VI Life Kingdoms: persisted MONOTONIC structure points, one row per
// (user, kingdom). Incremented by base task points in the completion
// transaction and NEVER decremented — not on uncomplete, not on delete. That
// invariant is what makes a neglected kingdom read as "asleep" rather than
// "ruined", so it is load-bearing for the anti-shame law, not an optimisation.
//
// Lifetime points could in principle be summed from `tasks` by category, but
// that would silently shrink whenever a quest is uncompleted or deleted, which
// is exactly the decay this feature must never express. Hence a counter.
//
// Liveliness, tier and the neglect invitation are all derived at read time and
// are deliberately absent from this table.
export const kingdomPointsTable = pgTable("kingdom_points", {
  id:             serial("id").primaryKey(),
  userId:         integer("user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  kingdomId:      text("kingdom_id").notNull(), // KingdomId from api-server/src/lib/kingdoms.ts
  lifetimePoints: integer("lifetime_points").notNull().default(0),
  updatedAt:      timestamp("updated_at").notNull().defaultNow(),
}, (t) => [
  unique("kingdom_points_user_kingdom_unique").on(t.userId, t.kingdomId),
]);

export type KingdomPoints = typeof kingdomPointsTable.$inferSelect;
