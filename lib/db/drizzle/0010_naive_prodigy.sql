CREATE TABLE "dm_beats" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"local_date" text NOT NULL,
	"kind" text NOT NULL,
	"narrative" text NOT NULL,
	"source" text NOT NULL,
	"facts" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "dm_beats_user_date_kind_unique" UNIQUE("user_id","local_date","kind")
);
--> statement-breakpoint
ALTER TABLE "dm_beats" ADD CONSTRAINT "dm_beats_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;