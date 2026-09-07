CREATE TABLE "feat_activations" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"feat_id" text NOT NULL,
	"local_date" text NOT NULL,
	"activated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "feat_activations" ADD CONSTRAINT "feat_activations_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "feat_activations_user_feat_day_unique" ON "feat_activations" USING btree ("user_id","feat_id","local_date");