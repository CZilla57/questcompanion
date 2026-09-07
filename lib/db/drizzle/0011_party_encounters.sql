CREATE TABLE "party_encounter_contributions" (
	"id" serial PRIMARY KEY NOT NULL,
	"party_encounter_id" integer NOT NULL,
	"user_id" integer NOT NULL,
	"damage" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "party_encounters" (
	"id" serial PRIMARY KEY NOT NULL,
	"partnership_id" integer NOT NULL,
	"name" text NOT NULL,
	"tier" integer DEFAULT 1 NOT NULL,
	"hp" integer NOT NULL,
	"total_damage" integer DEFAULT 0 NOT NULL,
	"felled_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "party_encounter_contributions" ADD CONSTRAINT "party_encounter_contributions_party_encounter_id_party_encounters_id_fk" FOREIGN KEY ("party_encounter_id") REFERENCES "public"."party_encounters"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "party_encounter_contributions" ADD CONSTRAINT "party_encounter_contributions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "party_encounters" ADD CONSTRAINT "party_encounters_partnership_id_partnerships_id_fk" FOREIGN KEY ("partnership_id") REFERENCES "public"."partnerships"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "party_encounter_contrib_foe_user_unique" ON "party_encounter_contributions" USING btree ("party_encounter_id","user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "party_encounters_active_partnership_unique" ON "party_encounters" USING btree ("partnership_id") WHERE "party_encounters"."felled_at" is null;