ALTER TABLE "recurring_tasks" ADD COLUMN "frequency" text DEFAULT 'weekly' NOT NULL;--> statement-breakpoint
ALTER TABLE "recurring_tasks" ADD COLUMN "monthly_mode" text;--> statement-breakpoint
ALTER TABLE "recurring_tasks" ADD COLUMN "day_of_month" integer;--> statement-breakpoint
ALTER TABLE "recurring_tasks" ADD COLUMN "week_of_month" integer;--> statement-breakpoint
ALTER TABLE "recurring_tasks" ADD COLUMN "month_of_year" integer;--> statement-breakpoint
ALTER TABLE "recurring_tasks" ADD COLUMN "lead_days" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "habit_streaks" ADD COLUMN "last_period_key" text;