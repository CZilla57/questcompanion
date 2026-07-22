CREATE TABLE "campaigns" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"title" text NOT NULL,
	"arc_premise" text,
	"ending_beat" text,
	"story_source" text DEFAULT 'curated' NOT NULL,
	"status" text DEFAULT 'running' NOT NULL,
	"reward_xp_awarded" integer,
	"completed_at" timestamp,
	"set_aside_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "questlines" ADD COLUMN "campaign_id" integer;--> statement-breakpoint
ALTER TABLE "questlines" ADD COLUMN "chapter_order" integer;--> statement-breakpoint
ALTER TABLE "questlines" ADD COLUMN "chapter_beat" text;--> statement-breakpoint
ALTER TABLE "campaigns" ADD CONSTRAINT "campaigns_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "campaigns_one_running_per_user" ON "campaigns" USING btree ("user_id") WHERE "campaigns"."status" = 'running';--> statement-breakpoint
ALTER TABLE "questlines" ADD CONSTRAINT "questlines_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE set null ON UPDATE no action;