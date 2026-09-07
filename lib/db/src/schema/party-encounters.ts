import { pgTable, serial, integer, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { usersTable } from "./users";
import { partnershipsTable } from "./partnerships";

// The Campaign — Phase 2 (Party): one SHARED foe per accepted partnership,
// chipped by EITHER member's quest completions. The co-op reframe of the World
// Boss, scoped to a pair. Same anti-shame law as personal_encounters: totalDamage
// only grows, a felled foe "rests", nothing is ever taken back.
export const partyEncountersTable = pgTable("party_encounters", {
  id:            serial("id").primaryKey(),
  partnershipId: integer("partnership_id").notNull()
                   .references(() => partnershipsTable.id, { onDelete: "cascade" }),
  name:          text("name").notNull(),
  /** Ordinal of this foe in the party's run (1, 2, 3…); sizes each foe. */
  tier:          integer("tier").notNull().default(1),
  hp:            integer("hp").notNull(),
  totalDamage:   integer("total_damage").notNull().default(0),
  felledAt:      timestamp("felled_at"),
  createdAt:     timestamp("created_at").notNull().defaultNow(),
}, (t) => [
  // At most one ACTIVE (unfelled) foe per party — lazy spawn is an atomic insert
  // that can't race two active foes into existence; many felled rows may remain.
  uniqueIndex("party_encounters_active_partnership_unique")
    .on(t.partnershipId)
    .where(sql`${t.felledAt} is null`),
]);

// One row per (foe, member), damage accumulated. Lets the UI show both members'
// contributions as teamwork and lets loot reach every contributor. NEVER used to
// rank members against each other (anti-shame law).
export const partyEncounterContributionsTable = pgTable("party_encounter_contributions", {
  id:               serial("id").primaryKey(),
  partyEncounterId: integer("party_encounter_id").notNull()
                      .references(() => partyEncountersTable.id, { onDelete: "cascade" }),
  userId:           integer("user_id").notNull()
                      .references(() => usersTable.id, { onDelete: "cascade" }),
  damage:           integer("damage").notNull().default(0),
  createdAt:        timestamp("created_at").notNull().defaultNow(),
}, (t) => [
  uniqueIndex("party_encounter_contrib_foe_user_unique").on(t.partyEncounterId, t.userId),
]);

export type PartyEncounter = typeof partyEncountersTable.$inferSelect;
export type PartyEncounterContribution = typeof partyEncounterContributionsTable.$inferSelect;
