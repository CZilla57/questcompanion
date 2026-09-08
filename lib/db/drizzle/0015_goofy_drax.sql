ALTER TABLE "users" ADD COLUMN "companion_name" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "companion_disposition" text DEFAULT 'warm' NOT NULL;