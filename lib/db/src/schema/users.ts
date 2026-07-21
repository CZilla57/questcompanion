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
  // Act VI Living Companion: monotonic bond metric (lifetime quest completions).
  // Incremented in the completion transaction; NEVER decremented (anti-shame).
  bondQuestsCompleted: integer("bond_quests_completed").notNull().default(0),
  // Streak-milestone celebration push dedup marker (last milestone value pushed,
  // e.g. "7"); cleared when the streak breaks. Mirrors hungerNotifiedStage.
  companionMilestoneNotified: text("companion_milestone_notified"),
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
  // Act VII One Voice: per-category push preferences + user quiet hours.
  // Categories map to candidate producers (see api-server lib/notification-envelope.ts).
  notifyProtection: boolean("notify_protection").notNull().default(true),
  notifyReminders: boolean("notify_reminders").notNull().default(true),
  notifyReflection: boolean("notify_reflection").notNull().default(true),
  notifyHero: boolean("notify_hero").notNull().default(true),
  // Local-hour ints [0,23]. Quiet window is [start→end) wrapping midnight; start === end
  // means "no quiet hours". Applies to non-critical classes only — the [2,7) deep-night
  // floor in the envelope is absolute and not user-configurable.
  quietHoursStart: integer("quiet_hours_start").notNull().default(22),
  quietHoursEnd: integer("quiet_hours_end").notNull().default(8),
  // Envelope budget state: local-date key the counter belongs to, count sent that day,
  // and the instant of the last envelope push (90-min aggregate spacing).
  pushesSentDate: text("pushes_sent_date"),
  pushesSentCount: integer("pushes_sent_count").notNull().default(0),
  lastPushAt: timestamp("last_push_at"),
  // Act VII Gentle Door (q5): progressive-unlock state.
  // unlockAll — grandfather flag. The column default stamps TRUE onto every row
  // that exists when the migration runs (pre-quest behavior: everything open);
  // only the auth create path inserts FALSE, so exactly the accounts born after
  // this ship get the gentle door. Unforeseen insert paths fail open.
  unlockAll: boolean("unlock_all").notNull().default(true),
  // Monotonic unlock floor: highest level reached before any XP reversal.
  // Written ONLY in the /uncomplete transaction (the sole XP-lowering path) —
  // forward progress needs no writes because derived level covers it. Gates
  // read max(derived level, highestLevel) so a seen door never closes.
  highestLevel: integer("highest_level").notNull().default(1),
  // Rename cooldown anchor: set on each successful post-onboarding rename;
  // null until the first real rename (the onboarding set doesn't start the
  // clock — a minute-zero typo must be fixable immediately).
  usernameChangedAt: timestamp("username_changed_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const insertUserSchema = createInsertSchema(usersTable).omit({ id: true, createdAt: true });
export type InsertUser = z.infer<typeof insertUserSchema>;
export type User = typeof usersTable.$inferSelect;
