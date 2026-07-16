import { pgTable, serial, integer, text, timestamp } from "drizzle-orm/pg-core";
import { usersTable } from "./users";
import { rewardStoreItemsTable } from "./reward-store-items";

export type CoinReason =
  | "quest_complete"
  | "focus_session"
  | "streak_milestone"
  | "questline_complete"
  | "boss_win"
  | "redeem"
  | "quest_uncomplete"
  | "world_boss_defeat"
  | "mystery_open"
  | "mystery_bonus"
  | "perk_xp_boost"
  | "perk_focus_boost"
  | "perk_streak_shield";

// Append-only audit ledger. Not surfaced in the UI (v1); exists for integrity,
// debuggability, and reconstructing the denormalized users.coinBalance.
export const coinTransactionsTable = pgTable("coin_transactions", {
  id:           serial("id").primaryKey(),
  userId:       integer("user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  amount:       integer("amount").notNull(), // signed: +earn, -spend
  reason:       text("reason").$type<CoinReason>().notNull(),
  rewardItemId: integer("reward_item_id").references(() => rewardStoreItemsTable.id, { onDelete: "set null" }),
  createdAt:    timestamp("created_at").notNull().defaultNow(),
});

export type CoinTransaction = typeof coinTransactionsTable.$inferSelect;
