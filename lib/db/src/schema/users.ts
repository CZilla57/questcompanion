import { pgTable, serial, text, integer, timestamp, varchar, boolean } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const usersTable = pgTable("users", {
  id: serial("id").primaryKey(),
  externalId: varchar("external_id").unique(),
  username: text("username").notNull().unique(),
  displayName: text("display_name"),
  avatarColor: text("avatar_color").notNull().default("#6366f1"),
  totalPoints: integer("total_points").notNull().default(0),
  weeklyPoints: integer("weekly_points").notNull().default(0),
  currentLevel: integer("current_level").notNull().default(1),
  streakDays: integer("streak_days").notNull().default(0),
  longestStreak: integer("longest_streak").notNull().default(0),
  lastActiveDate: text("last_active_date"),
  streakFreezes: integer("streak_freezes").notNull().default(0),
  onboardingComplete: boolean("onboarding_complete").notNull().default(false),
  avatarClass: text("avatar_class").notNull().default("fighter"),
  avatarSkin: text("avatar_skin").notNull().default("light"),
  avatarHairStyle: text("avatar_hair_style").notNull().default("short"),
  avatarHairColor: text("avatar_hair_color").notNull().default("brown"),
  avatarBodyBuild: text("avatar_body_build").notNull().default("male"),
  avatarFace: text("avatar_face").notNull().default("neutral"),
  avatarBeardStyle: text("avatar_beard_style").notNull().default("none"),
  avatarBeardColor: text("avatar_beard_color").notNull().default("brown"),
  avatarGlasses: text("avatar_glasses").notNull().default("none"),
  avatarEarrings: text("avatar_earrings").notNull().default("none"),
  lastFedAt: timestamp("last_fed_at").notNull().defaultNow(),
  hungerNotifiedStage: text("hunger_notified_stage"),
  lastFlavorPushAt: timestamp("last_flavor_push_at"),
  // Per-user timezone (IANA), captured from the client. Lets cron compute the
  // user's local hour for bedtime / quiet-hours.
  timezone: text("timezone"),
  // Hyperfocus Protection dedup/rotation/pause state (mirrors hero-care columns).
  hyperfocusNudgedAt: timestamp("hyperfocus_nudged_at"),
  hyperfocusLastKind: text("hyperfocus_last_kind"),
  hyperfocusPausedUntil: timestamp("hyperfocus_paused_until"),
  // Act IV reward economy: spendable currency, decoupled from XP. Never negative.
  coinBalance: integer("coin_balance").notNull().default(0),
  // Act IV Stat Perks: coin-priced timed boosts. A boost is active iff its column
  // is non-null and in the future — derived at read time, no cron sweep. Null = off.
  xpBoostExpiresAt: timestamp("xp_boost_expires_at"),
  focusBoostExpiresAt: timestamp("focus_boost_expires_at"),
  // Local-date string (YYYY-MM-DD) of the last evening reflection push — the
  // once-per-day dedup gate for the cron pass (mirrors hyperfocus columns).
  reflectionPromptedDate: text("reflection_prompted_date"),
  // Context-aware nudges (Act V q3): per-kind once-per-day dedup gates. Local-date
  // strings (YYYY-MM-DD); today's sent-count for the 2/day cap is derived by
  // comparing them to the user's localToday — no separate counter.
  nudgeDueTodayDate: text("nudge_due_today_date"),
  nudgePowerWindowDate: text("nudge_power_window_date"),
  nudgeQuickWinDate: text("nudge_quick_win_date"),
  // Instant of the last context nudge of any kind — enforces 90-min spacing.
  contextNudgedAt: timestamp("context_nudged_at"),
  // Weekly AI Recap email (Act V q4). Email captured from OIDC claims at
  // login/token-exchange; recaps default ON with a one-click tokenized
  // unsubscribe (anti-shame: instant, no login required).
  email: text("email"),
  recapEmailsEnabled: boolean("recap_emails_enabled").notNull().default(true),
  recapUnsubscribeToken: text("recap_unsubscribe_token").unique(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const insertUserSchema = createInsertSchema(usersTable).omit({ id: true, createdAt: true });
export type InsertUser = z.infer<typeof insertUserSchema>;
export type User = typeof usersTable.$inferSelect;
