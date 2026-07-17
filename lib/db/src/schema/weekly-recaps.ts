import { pgTable, serial, integer, text, timestamp, jsonb, boolean, unique } from "drizzle-orm/pg-core";
import { usersTable } from "./users";

/** Structured strengths-only week summary stored per recap. Defined here (like
 * tasks.ts VariantLadder) so the api-server logic and the jsonb column share
 * one source of truth. This shape has NO channel for unfinished, missed, or
 * overdue work — anti-shame is structural, not filtered. */
export interface WeekStatsBoss {
  damage: number;
  attacks: number;
  defeated: boolean;
}

export interface WeekStatsRhythms {
  powerHours: number[];
  bestDay: number | null; // 0=Sunday..6=Saturday, matching PatternSummary
  topHelpers: string[];
}

export interface WeekStats {
  weekKey: string;
  questsCompleted: number;
  sampleQuestTitles: string[]; // up to 5, for LLM grounding + email list
  focusSessions: number;
  focusMinutes: number;
  xpEarned: number;
  coinsEarned: number;
  initiations: number;
  levelUps: number;
  badges: string[]; // badge names earned this week
  questlinesCompleted: string[]; // titles claimed this week
  boss: WeekStatsBoss | null; // null when the user made no attacks that week
  rhythms: WeekStatsRhythms | null; // null below "ok" confidence
}

// One row per user per recapped ISO week. The claim insert (userId+weekKey
// only, onConflictDoNothing) IS the exactly-once gate; stats/subject/narrative
// are filled after the claim, sentAt only after a successful email delivery.
export const weeklyRecapsTable = pgTable("weekly_recaps", {
  id:        serial("id").primaryKey(),
  userId:    integer("user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  weekKey:   text("week_key").notNull(), // e.g. "2026-W29" (shared getWeekKey format)
  stats:     jsonb("stats").$type<WeekStats>(),
  subject:   text("subject"),
  narrative: text("narrative"),
  skipped:   boolean("skipped").notNull().default(false), // zero-signal week → silent skip
  sentAt:    timestamp("sent_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (t) => [
  unique("weekly_recaps_user_week_unique").on(t.userId, t.weekKey),
]);

export type WeeklyRecap = typeof weeklyRecapsTable.$inferSelect;
