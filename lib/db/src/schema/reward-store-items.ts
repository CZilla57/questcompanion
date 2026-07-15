import { pgTable, serial, integer, varchar, text, timestamp } from "drizzle-orm/pg-core";
import { usersTable } from "./users";

export type RewardTier = "small" | "medium" | "large" | "treat";

export const rewardStoreItemsTable = pgTable("reward_store_items", {
  id:        serial("id").primaryKey(),
  userId:    integer("user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  label:     varchar("label", { length: 100 }).notNull(),
  tier:      text("tier").$type<RewardTier>().notNull(),
  // Snapshotted from the tier at creation so retuning tier prices never
  // silently reprices a user's existing rewards.
  coinCost:  integer("coin_cost").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export type RewardStoreItem = typeof rewardStoreItemsTable.$inferSelect;
