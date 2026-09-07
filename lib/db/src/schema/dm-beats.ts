import { pgTable, serial, integer, text, timestamp, jsonb, unique } from "drizzle-orm/pg-core";
import { usersTable } from "./users";

// The Campaign — Phase 3: the Dungeon Master's daily narration cache.
//
// One row per user per (local date, kind). The DM writes a short, grounded beat
// once per morning/evening and it is cached here so a re-open never re-generates
// (cost + latency) and every viewer of the day sees the same words.
//
// `facts` stores the strengths-only inputs the beat was grounded on — it is the
// same anti-shame shape the prompt saw (completed + planned titles, kingdom
// growth), with NO channel for missed/overdue work. Persisted so a beat can be
// re-validated or re-rendered without re-querying, and so the no-fabrication
// contract is auditable after the fact.
export type DmBeatKind = "morning" | "camp";

export interface DmBeatFacts {
  /** Titles of quests already completed today (evening camp grounds on these). */
  completedTitles: string[];
  /** Titles of quests planned for today (morning board frames these). */
  plannedTitles: string[];
  /** Life areas that grew today, e.g. "the Forge reached Outpost". */
  kingdomGrowth: string[];
  focusMinutes: number;
  streakDays: number;
  /** Active campaign chapter beat, when the user is running a campaign. */
  chapterBeat: string | null;
}

export const dmBeatsTable = pgTable("dm_beats", {
  id:        serial("id").primaryKey(),
  userId:    integer("user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  localDate: text("local_date").notNull(),          // YYYY-MM-DD in the user's zone
  kind:      text("kind").$type<DmBeatKind>().notNull(),
  narrative: text("narrative").notNull(),
  source:    text("source").$type<"ai" | "fallback">().notNull(),
  facts:     jsonb("facts").$type<DmBeatFacts>(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (t) => [
  // Exactly one beat per user per day per kind. The insert (onConflictDoNothing)
  // IS the once-per-beat gate — a lost race re-reads the winner's row.
  unique("dm_beats_user_date_kind_unique").on(t.userId, t.localDate, t.kind),
]);

export type DmBeat = typeof dmBeatsTable.$inferSelect;
