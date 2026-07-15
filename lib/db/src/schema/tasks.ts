import { pgTable, serial, text, integer, boolean, timestamp, date, unique, jsonb } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { usersTable } from "./users";
import { questlinesTable } from "./questlines";

export type DifficultyLevel = "easy" | "medium" | "hard";

/** One rung of the difficulty ladder. `estimatedMinutes` may be null when the
 * medium snapshot came from a quest with no estimate. */
export interface RungContent {
  title: string;
  estimatedMinutes: number | null;
  steps: string[];
}

/** The lazily-drafted ladder. `medium` is a snapshot of the user's own quest;
 * `easy`/`hard` are LLM re-scopes. Null until first generated. */
export interface VariantLadder {
  easy: RungContent;
  medium: RungContent;
  hard: RungContent;
}

export const tasksTable = pgTable("tasks", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().references(() => usersTable.id),
  recurringTaskId: integer("recurring_task_id"),
  title: text("title").notNull(),
  description: text("description"),
  points: integer("points").notNull().default(10),

  // Snapshot written at completion time so uncomplete can reverse exactly what was granted.
  pointsAwarded: integer("points_awarded"),
  coinsAwarded: integer("coins_awarded").notNull().default(0),
  dailyBonusAwarded: boolean("daily_bonus_awarded").notNull().default(false),
  streakDaysBefore: integer("streak_days_before"),
  longestStreakBefore: integer("longest_streak_before"),
  lastActiveDateBefore: text("last_active_date_before"),
  freezeConsumedOnComplete: boolean("freeze_consumed_on_complete").notNull().default(false),
  badgesGrantedIds: text("badges_granted_ids"),
  habitStreakSnapshot: text("habit_streak_snapshot"),
  // JSON array of gear item IDs awarded during this completion (account + habit streak rewards).
  // Stored so /uncomplete can revoke exactly the gear that was granted.
  gearGrantedIds: text("gear_granted_ids"),

  estimatedMinutes: integer("estimated_minutes"),
  actualMinutes: integer("actual_minutes"),

  isDailyFocus: boolean("is_daily_focus").notNull().default(false),
  focusDate: date("focus_date"),

  completed: boolean("completed").notNull().default(false),
  completedAt: timestamp("completed_at"),
  dueDate: text("due_date"),
  dueTime: text("due_time"),
  isAnchored: boolean("is_anchored").notNull().default(false),
  questlineId: integer("questline_id").references(() => questlinesTable.id, { onDelete: "set null" }),
  priority: text("priority").notNull().default("medium"),
  category: text("category").notNull().default("default"),
  // Adaptive difficulty. INVARIANT: difficultyVariants IS NULL ⇒ difficulty = 'medium'.
  difficulty: text("difficulty").notNull().default("medium").$type<DifficultyLevel>(),
  difficultyVariants: jsonb("difficulty_variants").$type<VariantLadder>(),
  // Silent struggle accumulator (never shown to the user). Reset to 0 on any rung change.
  struggleScore: integer("struggle_score").notNull().default(0),
  difficultyOfferSnoozedAt: timestamp("difficulty_offer_snoozed_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => [
  // Prevents duplicate recurring-task rows for the same user/template/day across concurrent
  // scheduler instances.  PostgreSQL treats NULLs as distinct so regular (non-recurring)
  // tasks on the same date are unaffected by this constraint.
  unique("tasks_recurring_unique_idx").on(table.userId, table.recurringTaskId, table.dueDate),
]);

export const insertTaskSchema = createInsertSchema(tasksTable).omit({ id: true, createdAt: true, completedAt: true, completed: true });
export type InsertTask = z.infer<typeof insertTaskSchema>;
export type Task = typeof tasksTable.$inferSelect;
