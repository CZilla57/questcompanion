import { pgTable, serial, text, integer, timestamp, boolean } from "drizzle-orm/pg-core";
import { usersTable } from "./users";

export type GearSlot = "weapon" | "helmet" | "armor" | "boots" | "accessory";
export type GearRarity = "common" | "rare" | "epic" | "legendary";

export const gearItemsTable = pgTable("gear_items", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  description: text("description").notNull(),
  slot: text("slot").$type<GearSlot>().notNull(),
  rarity: text("rarity").$type<GearRarity>().notNull(),
  statPower: integer("stat_power").notNull(),
  costXp: integer("cost_xp").notNull(),
  levelRequired: integer("level_required").notNull().default(1),
  icon: text("icon").notNull(),
});

export const userGearTable = pgTable("user_gear", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().references(() => usersTable.id),
  gearItemId: integer("gear_item_id").notNull().references(() => gearItemsTable.id),
  equipped: boolean("equipped").notNull().default(false),
  acquiredAt: timestamp("acquired_at").notNull().defaultNow(),
});

export type GearItem = typeof gearItemsTable.$inferSelect;
export type UserGear = typeof userGearTable.$inferSelect;
