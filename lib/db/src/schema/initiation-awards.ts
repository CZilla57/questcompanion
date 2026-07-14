import { pgTable, serial, integer, text, timestamp, index, uniqueIndex } from "drizzle-orm/pg-core";
import { usersTable } from "./users";

export const initiationAwardsTable = pgTable("initiation_awards", {
  id:        serial("id").primaryKey(),
  userId:    integer("user_id").notNull().references(() => usersTable.id),
  kind:      text("kind").notNull(),  // 'session_start' | 'first_step' | 'questline_kickoff' | 'first_move'
  refId:     integer("ref_id"),       // taskId for first_step, questlineId for questline_kickoff, else NULL
  awardedAt: timestamp("awarded_at").notNull().defaultNow(),
}, (t) => [
  // Race-safe once-ever guard for first_step / questline_kickoff. Postgres
  // treats NULL ref_id as distinct, so the time-window kinds never collide.
  uniqueIndex("initiation_awards_user_kind_ref_idx").on(t.userId, t.kind, t.refId),
  // Serves the cooldown and day-boundary "latest row" lookups.
  index("initiation_awards_user_kind_time_idx").on(t.userId, t.kind, t.awardedAt),
]);

export type InitiationAward = typeof initiationAwardsTable.$inferSelect;
