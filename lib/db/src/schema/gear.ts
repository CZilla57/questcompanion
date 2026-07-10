import { pgTable, serial, text, integer, timestamp, boolean, unique } from "drizzle-orm/pg-core";
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
  spriteId: text("sprite_id"),
});

export const userGearTable = pgTable("user_gear", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().references(() => usersTable.id),
  gearItemId: integer("gear_item_id").notNull().references(() => gearItemsTable.id),
  equipped: boolean("equipped").notNull().default(false),
  acquiredAt: timestamp("acquired_at").notNull().defaultNow(),
}, (table) => [
  // Prevents a user from owning duplicate copies of the same gear item, which would allow
  // stacking battle power via repeated reward claims or concurrent purchase races.
  unique("user_gear_user_item_unique").on(table.userId, table.gearItemId),
]);

export type GearItem = typeof gearItemsTable.$inferSelect;
export type UserGear = typeof userGearTable.$inferSelect;
