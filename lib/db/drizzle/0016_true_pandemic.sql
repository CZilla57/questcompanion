CREATE TABLE "user_consumables" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"consumable_id" text NOT NULL,
	"quantity" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "pending_consumable" text;--> statement-breakpoint
ALTER TABLE "user_consumables" ADD CONSTRAINT "user_consumables_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "user_consumables_user_item_unique" ON "user_consumables" USING btree ("user_id","consumable_id");