import { pgTable, serial, integer, text, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { usersTable } from "./users";
import { campaignsTable } from "./campaigns";

export const questlinesTable = pgTable("questlines", {
  id: serial("id").primaryKey(),
  // Denormalized ownership check, matching task_steps / focus_sessions.
  userId: integer("user_id").notNull().references(() => usersTable.id),
  title: text("title").notNull(),
  description: text("description"),
  color: text("color"),
  // 'active' -> 'completed'. 'ready-to-claim' is derived, never stored.
  status: text("status").notNull().default("active"),
  // Snapshot written at claim so the payout is auditable/reversible, mirroring tasks.pointsAwarded.
  rewardXpAwarded: integer("reward_xp_awarded"),
  completedAt: timestamp("completed_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  // Act VI Quest Campaigns: a questline may be one chapter of one campaign.
  // SET NULL keeps the promise questlines make to quests — deleting the parent
  // unlinks the children, it never deletes work.
  campaignId: integer("campaign_id").references(() => campaignsTable.id, { onDelete: "set null" }),
  chapterOrder: integer("chapter_order"),
  chapterBeat: text("chapter_beat"),
});

export const insertQuestlineSchema = createInsertSchema(questlinesTable).omit({
  id: true,
  createdAt: true,
  completedAt: true,
  status: true,
  rewardXpAwarded: true,
});
export type InsertQuestline = z.infer<typeof insertQuestlineSchema>;
export type Questline = typeof questlinesTable.$inferSelect;
