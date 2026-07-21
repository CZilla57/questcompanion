CREATE TABLE "body_double_members" (
	"id" serial PRIMARY KEY NOT NULL,
	"room_id" integer NOT NULL,
	"user_id" integer NOT NULL,
	"joined_at" timestamp DEFAULT now() NOT NULL,
	"left_at" timestamp,
	"last_seen_at" timestamp DEFAULT now() NOT NULL,
	"last_wave_at" timestamp,
	CONSTRAINT "body_double_members_room_user_unique" UNIQUE("room_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "body_double_rooms" (
	"id" serial PRIMARY KEY NOT NULL,
	"host_id" integer NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"ended_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "body_double_sprints" (
	"id" serial PRIMARY KEY NOT NULL,
	"room_id" integer NOT NULL,
	"minutes" integer NOT NULL,
	"started_by" integer NOT NULL,
	"started_at" timestamp DEFAULT now() NOT NULL,
	"completed_at" timestamp
);
--> statement-breakpoint
ALTER TABLE "body_double_members" ADD CONSTRAINT "body_double_members_room_id_body_double_rooms_id_fk" FOREIGN KEY ("room_id") REFERENCES "public"."body_double_rooms"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "body_double_members" ADD CONSTRAINT "body_double_members_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "body_double_rooms" ADD CONSTRAINT "body_double_rooms_host_id_users_id_fk" FOREIGN KEY ("host_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "body_double_sprints" ADD CONSTRAINT "body_double_sprints_room_id_body_double_rooms_id_fk" FOREIGN KEY ("room_id") REFERENCES "public"."body_double_rooms"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "body_double_sprints" ADD CONSTRAINT "body_double_sprints_started_by_users_id_fk" FOREIGN KEY ("started_by") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "body_double_sprints_live_room_unique" ON "body_double_sprints" USING btree ("room_id") WHERE "body_double_sprints"."completed_at" IS NULL;