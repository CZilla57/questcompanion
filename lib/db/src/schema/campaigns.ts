import { pgTable, serial, integer, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { usersTable } from "./users";

export const campaignsTable = pgTable("campaigns", {
  id: serial("id").primaryKey(),
  // Denormalized ownership check, matching questlines / task_steps.
  userId: integer("user_id").notNull().references(() => usersTable.id),
  title: text("title").notNull(),
  // Story text is SNAPSHOTTED at creation and never regenerated on read.
  arcPremise: text("arc_premise"),
  endingBeat: text("ending_beat"),
  // 'ai' | 'curated' — which path produced the text above.
  storySource: text("story_source").notNull().default("curated"),
  // 'running' -> 'set_aside' <-> 'running' -> 'completed'.
  // 'ready-to-claim' is derived, never stored (same rule as questlines).
  status: text("status").notNull().default("running"),
  // Claim snapshot so the payout is auditable, mirroring questlines.rewardXpAwarded.
  rewardXpAwarded: integer("reward_xp_awarded"),
  completedAt: timestamp("completed_at"),
  setAsideAt: timestamp("set_aside_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (t) => [
  // One running campaign per user — the DB is the guard, not just the route.
  uniqueIndex("campaigns_one_running_per_user")
    .on(t.userId)
    .where(sql`${t.status} = 'running'`),
]);

export const insertCampaignSchema = createInsertSchema(campaignsTable).omit({
  id: true,
  createdAt: true,
  completedAt: true,
  setAsideAt: true,
  status: true,
  rewardXpAwarded: true,
});
export type InsertCampaign = z.infer<typeof insertCampaignSchema>;
export type Campaign = typeof campaignsTable.$inferSelect;
