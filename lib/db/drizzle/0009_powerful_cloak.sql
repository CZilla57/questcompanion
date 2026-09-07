CREATE TABLE "personal_encounters" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"name" text NOT NULL,
	"tier" integer DEFAULT 1 NOT NULL,
	"hp" integer NOT NULL,
	"total_damage" integer DEFAULT 0 NOT NULL,
	"felled_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "personal_encounters" ADD CONSTRAINT "personal_encounters_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "personal_encounters_active_user_unique" ON "personal_encounters" USING btree ("user_id") WHERE "personal_encounters"."felled_at" is null;