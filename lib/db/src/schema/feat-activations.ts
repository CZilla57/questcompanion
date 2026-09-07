import { pgTable, serial, integer, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { usersTable } from "./users";

// The Campaign — second wave (Class Feats): one row per use of an ACTIVE feat.
//
// Which feats a hero has unlocked is DERIVED from class + level (see
// lib/class-feats.ts) — nothing stored. The only genuinely new state is the
// once-a-day cooldown on active feats, and this table is it: a row is written
// each time a feat is activated, stamped with the user's LOCAL date so "once a
// day" is stable across clients and timezones (same tz discipline as
// reflections / dm_beats).
//
// The (userId, featId, localDate) unique index makes the daily use an atomic
// claim: a second activation on the same local day conflicts instead of racing
// two grants through. Rows only accumulate (a history of uses) — nothing here
// is ever taken back, per the anti-shame law.
export const featActivationsTable = pgTable("feat_activations", {
  id:          serial("id").primaryKey(),
  userId:      integer("user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  /** Feat id from lib/class-feats.ts (e.g. "focus_surge"). */
  featId:      text("feat_id").notNull(),
  /** The user-tz calendar day of the activation (YYYY-MM-DD); the cooldown key. */
  localDate:   text("local_date").notNull(),
  activatedAt: timestamp("activated_at").notNull().defaultNow(),
}, (t) => [
  uniqueIndex("feat_activations_user_feat_day_unique").on(t.userId, t.featId, t.localDate),
]);

export type FeatActivation = typeof featActivationsTable.$inferSelect;
