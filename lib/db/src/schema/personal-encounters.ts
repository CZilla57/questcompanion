import { pgTable, serial, integer, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { usersTable } from "./users";

// The Campaign — Phase 2: a per-user "personal encounter". A solo foe whose
// shared HP is chipped by the player's own quest completions (each completion's
// Phase-1 skill check scales the blow). At most one is active per user; when
// felled it is stamped and the next view spawns a fresh, slightly tougher one.
//
// totalDamage only ever grows for a given encounter row (uncompleting a quest
// does not heal the foe) — the anti-shame law: progress against the foe is
// never taken back. A felled encounter "rests"; it is never a loss.
export const personalEncountersTable = pgTable("personal_encounters", {
  id:          serial("id").primaryKey(),
  userId:      integer("user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  name:        text("name").notNull(),
  /** Ordinal of this encounter in the user's run (1, 2, 3…); sizes each foe. */
  tier:        integer("tier").notNull().default(1),
  hp:          integer("hp").notNull(),
  totalDamage: integer("total_damage").notNull().default(0),
  felledAt:    timestamp("felled_at"),
  createdAt:   timestamp("created_at").notNull().defaultNow(),
}, (t) => [
  // At most one ACTIVE (unfelled) encounter per user. A partial unique index
  // makes lazy spawn an atomic insert that can't race two active foes into
  // existence, while still allowing many felled rows in the history.
  uniqueIndex("personal_encounters_active_user_unique")
    .on(t.userId)
    .where(sql`${t.felledAt} is null`),
]);

export type PersonalEncounter = typeof personalEncountersTable.$inferSelect;
