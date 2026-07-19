CREATE TABLE "sessions" (
	"sid" varchar PRIMARY KEY NOT NULL,
	"sess" jsonb NOT NULL,
	"expire" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" serial PRIMARY KEY NOT NULL,
	"external_id" varchar,
	"username" text NOT NULL,
	"display_name" text,
	"avatar_color" text DEFAULT '#6366f1' NOT NULL,
	"total_points" integer DEFAULT 0 NOT NULL,
	"weekly_points" integer DEFAULT 0 NOT NULL,
	"current_level" integer DEFAULT 1 NOT NULL,
	"streak_days" integer DEFAULT 0 NOT NULL,
	"longest_streak" integer DEFAULT 0 NOT NULL,
	"last_active_date" text,
	"streak_freezes" integer DEFAULT 0 NOT NULL,
	"onboarding_complete" boolean DEFAULT false NOT NULL,
	"avatar_class" text DEFAULT 'fighter' NOT NULL,
	"avatar_skin" text DEFAULT 'light' NOT NULL,
	"avatar_hair_style" text DEFAULT 'short' NOT NULL,
	"avatar_hair_color" text DEFAULT 'brown' NOT NULL,
	"avatar_body_build" text DEFAULT 'male' NOT NULL,
	"avatar_face" text DEFAULT 'neutral' NOT NULL,
	"avatar_beard_style" text DEFAULT 'none' NOT NULL,
	"avatar_beard_color" text DEFAULT 'brown' NOT NULL,
	"avatar_glasses" text DEFAULT 'none' NOT NULL,
	"avatar_earrings" text DEFAULT 'none' NOT NULL,
	"last_fed_at" timestamp DEFAULT now() NOT NULL,
	"hunger_notified_stage" text,
	"last_flavor_push_at" timestamp,
	"bond_quests_completed" integer DEFAULT 0 NOT NULL,
	"companion_milestone_notified" text,
	"timezone" text,
	"hyperfocus_nudged_at" timestamp,
	"hyperfocus_last_kind" text,
	"hyperfocus_paused_until" timestamp,
	"coin_balance" integer DEFAULT 0 NOT NULL,
	"xp_boost_expires_at" timestamp,
	"focus_boost_expires_at" timestamp,
	"reflection_prompted_date" text,
	"nudge_due_today_date" text,
	"nudge_power_window_date" text,
	"nudge_quick_win_date" text,
	"context_nudged_at" timestamp,
	"email" text,
	"recap_emails_enabled" boolean DEFAULT true NOT NULL,
	"recap_unsubscribe_token" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "users_external_id_unique" UNIQUE("external_id"),
	CONSTRAINT "users_username_unique" UNIQUE("username"),
	CONSTRAINT "users_recap_unsubscribe_token_unique" UNIQUE("recap_unsubscribe_token")
);
--> statement-breakpoint
CREATE TABLE "tasks" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"recurring_task_id" integer,
	"title" text NOT NULL,
	"description" text,
	"points" integer DEFAULT 10 NOT NULL,
	"points_awarded" integer,
	"coins_awarded" integer DEFAULT 0 NOT NULL,
	"daily_bonus_awarded" boolean DEFAULT false NOT NULL,
	"streak_days_before" integer,
	"longest_streak_before" integer,
	"last_active_date_before" text,
	"freeze_consumed_on_complete" boolean DEFAULT false NOT NULL,
	"badges_granted_ids" text,
	"habit_streak_snapshot" text,
	"gear_granted_ids" text,
	"estimated_minutes" integer,
	"actual_minutes" integer,
	"is_daily_focus" boolean DEFAULT false NOT NULL,
	"focus_date" date,
	"completed" boolean DEFAULT false NOT NULL,
	"completed_at" timestamp,
	"due_date" text,
	"due_time" text,
	"is_anchored" boolean DEFAULT false NOT NULL,
	"questline_id" integer,
	"priority" text DEFAULT 'medium' NOT NULL,
	"category" text DEFAULT 'default' NOT NULL,
	"difficulty" text DEFAULT 'medium' NOT NULL,
	"difficulty_variants" jsonb,
	"struggle_score" integer DEFAULT 0 NOT NULL,
	"difficulty_offer_snoozed_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "tasks_recurring_unique_idx" UNIQUE("user_id","recurring_task_id","due_date")
);
--> statement-breakpoint
CREATE TABLE "badges" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"description" text NOT NULL,
	"icon" text NOT NULL,
	"category" text NOT NULL,
	"metric" text NOT NULL,
	"requirement" integer NOT NULL,
	CONSTRAINT "badges_name_unique" UNIQUE("name")
);
--> statement-breakpoint
CREATE TABLE "user_badges" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"badge_id" integer NOT NULL,
	"earned_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "partnerships" (
	"id" serial PRIMARY KEY NOT NULL,
	"requester_id" integer NOT NULL,
	"recipient_id" integer NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ally_nudges" (
	"id" serial PRIMARY KEY NOT NULL,
	"sender_id" integer NOT NULL,
	"recipient_id" integer NOT NULL,
	"kind" text NOT NULL,
	"reaction" text NOT NULL,
	"context_type" text,
	"read_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "activity" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"type" text NOT NULL,
	"description" text NOT NULL,
	"points" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "push_subscriptions" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"endpoint" text NOT NULL,
	"p256dh" text NOT NULL,
	"auth" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "push_subscriptions_endpoint_unique" UNIQUE("endpoint")
);
--> statement-breakpoint
CREATE TABLE "recurring_tasks" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"priority" text DEFAULT 'medium' NOT NULL,
	"category" text DEFAULT 'default' NOT NULL,
	"days_of_week" text DEFAULT '1,2,3,4,5' NOT NULL,
	"time_of_day" text DEFAULT '08:00' NOT NULL,
	"start_date" text NOT NULL,
	"end_date" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "habit_streaks" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"recurring_task_id" integer NOT NULL,
	"current_streak" integer DEFAULT 0 NOT NULL,
	"longest_streak" integer DEFAULT 0 NOT NULL,
	"total_completions" integer DEFAULT 0 NOT NULL,
	"last_completed_date" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "gear_items" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"description" text NOT NULL,
	"slot" text NOT NULL,
	"rarity" text NOT NULL,
	"stat_power" integer NOT NULL,
	"cost_xp" integer NOT NULL,
	"level_required" integer DEFAULT 1 NOT NULL,
	"icon" text NOT NULL,
	"sprite_id" text,
	CONSTRAINT "gear_items_name_unique" UNIQUE("name")
);
--> statement-breakpoint
CREATE TABLE "user_gear" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"gear_item_id" integer NOT NULL,
	"equipped" boolean DEFAULT false NOT NULL,
	"acquired_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "user_gear_user_item_unique" UNIQUE("user_id","gear_item_id")
);
--> statement-breakpoint
CREATE TABLE "weekly_battles" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"week_key" text NOT NULL,
	"power_score" integer NOT NULL,
	"boss_power" integer NOT NULL,
	"roll" integer NOT NULL,
	"result" text NOT NULL,
	"xp_awarded" integer NOT NULL,
	"fought_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "weekly_battles_user_week_unique" UNIQUE("user_id","week_key")
);
--> statement-breakpoint
CREATE TABLE "dopamine_rewards" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"reward_text" varchar(100) NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "focus_sessions" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"task_id" integer,
	"preset" text NOT NULL,
	"focus_minutes" integer NOT NULL,
	"break_minutes" integer NOT NULL,
	"long_break_minutes" integer NOT NULL,
	"long_break_every" integer NOT NULL,
	"planned_cycles" integer NOT NULL,
	"completed_intervals" integer DEFAULT 0 NOT NULL,
	"focused_seconds" integer DEFAULT 0 NOT NULL,
	"xp_awarded" integer DEFAULT 0 NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"started_at" timestamp DEFAULT now() NOT NULL,
	"last_interval_at" timestamp,
	"ended_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "task_steps" (
	"id" serial PRIMARY KEY NOT NULL,
	"task_id" integer NOT NULL,
	"user_id" integer NOT NULL,
	"text" text NOT NULL,
	"position" integer NOT NULL,
	"done" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "questlines" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"color" text,
	"status" text DEFAULT 'active' NOT NULL,
	"reward_xp_awarded" integer,
	"completed_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "initiation_awards" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"kind" text NOT NULL,
	"ref_id" integer,
	"awarded_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "brain_checkins" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"mode" text NOT NULL,
	"source" text DEFAULT 'tap' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "rescue_events" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"task_id" integer,
	"blocker" text NOT NULL,
	"intervention" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "reward_store_items" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"label" varchar(100) NOT NULL,
	"tier" text NOT NULL,
	"coin_cost" integer NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "coin_transactions" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"amount" integer NOT NULL,
	"reason" text NOT NULL,
	"reward_item_id" integer,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "world_boss_attacks" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"week_key" text NOT NULL,
	"day_key" text NOT NULL,
	"damage" integer NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "world_boss_attacks_user_day_unique" UNIQUE("user_id","day_key")
);
--> statement-breakpoint
CREATE TABLE "world_boss_weeks" (
	"id" serial PRIMARY KEY NOT NULL,
	"week_key" text NOT NULL,
	"hp" integer NOT NULL,
	"total_damage" integer DEFAULT 0 NOT NULL,
	"defeated_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "world_boss_weeks_week_key_unique" UNIQUE("week_key")
);
--> statement-breakpoint
CREATE TABLE "reflections" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"local_date" text NOT NULL,
	"prompt" text NOT NULL,
	"prompt_source" text NOT NULL,
	"chips" jsonb NOT NULL,
	"free_text" text,
	"ack" text,
	"answered_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "reflections_user_day_unique" UNIQUE("user_id","local_date")
);
--> statement-breakpoint
CREATE TABLE "weekly_recaps" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"week_key" text NOT NULL,
	"stats" jsonb,
	"subject" text,
	"narrative" text,
	"skipped" boolean DEFAULT false NOT NULL,
	"sent_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "weekly_recaps_user_week_unique" UNIQUE("user_id","week_key")
);
--> statement-breakpoint
CREATE TABLE "kingdom_points" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"kingdom_id" text NOT NULL,
	"lifetime_points" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "kingdom_points_user_kingdom_unique" UNIQUE("user_id","kingdom_id")
);
--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_questline_id_questlines_id_fk" FOREIGN KEY ("questline_id") REFERENCES "public"."questlines"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_badges" ADD CONSTRAINT "user_badges_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_badges" ADD CONSTRAINT "user_badges_badge_id_badges_id_fk" FOREIGN KEY ("badge_id") REFERENCES "public"."badges"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "partnerships" ADD CONSTRAINT "partnerships_requester_id_users_id_fk" FOREIGN KEY ("requester_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "partnerships" ADD CONSTRAINT "partnerships_recipient_id_users_id_fk" FOREIGN KEY ("recipient_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ally_nudges" ADD CONSTRAINT "ally_nudges_sender_id_users_id_fk" FOREIGN KEY ("sender_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ally_nudges" ADD CONSTRAINT "ally_nudges_recipient_id_users_id_fk" FOREIGN KEY ("recipient_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "activity" ADD CONSTRAINT "activity_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "push_subscriptions" ADD CONSTRAINT "push_subscriptions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recurring_tasks" ADD CONSTRAINT "recurring_tasks_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "habit_streaks" ADD CONSTRAINT "habit_streaks_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "habit_streaks" ADD CONSTRAINT "habit_streaks_recurring_task_id_recurring_tasks_id_fk" FOREIGN KEY ("recurring_task_id") REFERENCES "public"."recurring_tasks"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_gear" ADD CONSTRAINT "user_gear_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_gear" ADD CONSTRAINT "user_gear_gear_item_id_gear_items_id_fk" FOREIGN KEY ("gear_item_id") REFERENCES "public"."gear_items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "weekly_battles" ADD CONSTRAINT "weekly_battles_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dopamine_rewards" ADD CONSTRAINT "dopamine_rewards_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "focus_sessions" ADD CONSTRAINT "focus_sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "focus_sessions" ADD CONSTRAINT "focus_sessions_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_steps" ADD CONSTRAINT "task_steps_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_steps" ADD CONSTRAINT "task_steps_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "questlines" ADD CONSTRAINT "questlines_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "initiation_awards" ADD CONSTRAINT "initiation_awards_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "brain_checkins" ADD CONSTRAINT "brain_checkins_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rescue_events" ADD CONSTRAINT "rescue_events_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rescue_events" ADD CONSTRAINT "rescue_events_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reward_store_items" ADD CONSTRAINT "reward_store_items_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "coin_transactions" ADD CONSTRAINT "coin_transactions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "coin_transactions" ADD CONSTRAINT "coin_transactions_reward_item_id_reward_store_items_id_fk" FOREIGN KEY ("reward_item_id") REFERENCES "public"."reward_store_items"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "world_boss_attacks" ADD CONSTRAINT "world_boss_attacks_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reflections" ADD CONSTRAINT "reflections_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "weekly_recaps" ADD CONSTRAINT "weekly_recaps_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kingdom_points" ADD CONSTRAINT "kingdom_points_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "IDX_session_expire" ON "sessions" USING btree ("expire");--> statement-breakpoint
CREATE UNIQUE INDEX "user_badges_user_id_badge_id_idx" ON "user_badges" USING btree ("user_id","badge_id");--> statement-breakpoint
CREATE INDEX "ally_nudges_recipient_idx" ON "ally_nudges" USING btree ("recipient_id");--> statement-breakpoint
CREATE INDEX "ally_nudges_sender_recipient_kind_idx" ON "ally_nudges" USING btree ("sender_id","recipient_id","kind","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "habit_streaks_user_id_recurring_task_id_idx" ON "habit_streaks" USING btree ("user_id","recurring_task_id");--> statement-breakpoint
CREATE UNIQUE INDEX "initiation_awards_user_kind_ref_idx" ON "initiation_awards" USING btree ("user_id","kind","ref_id");--> statement-breakpoint
CREATE INDEX "initiation_awards_user_kind_time_idx" ON "initiation_awards" USING btree ("user_id","kind","awarded_at");--> statement-breakpoint
CREATE INDEX "brain_checkins_user_time_idx" ON "brain_checkins" USING btree ("user_id","created_at");