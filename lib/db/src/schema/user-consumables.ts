import { pgTable, serial, integer, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { usersTable } from "./users";

// Act IV (Tactics & Stakes): a user's owned consumables (potions/scrolls). One
// row per (user, consumableId) holding a non-negative quantity. Buying bumps qty;
// spending on a completion decrements it. The catalog + effects live in
// api-server lib/consumables.ts — this table stores only ownership.
export const userConsumablesTable = pgTable("user_consumables", {
  id:           serial("id").primaryKey(),
  userId:       integer("user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  consumableId: text("consumable_id").notNull(),
  quantity:     integer("quantity").notNull().default(0),
  updatedAt:    timestamp("updated_at").notNull().defaultNow(),
}, (t) => [
  uniqueIndex("user_consumables_user_item_unique").on(t.userId, t.consumableId),
]);

export type UserConsumable = typeof userConsumablesTable.$inferSelect;
