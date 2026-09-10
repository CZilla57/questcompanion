import { pgTable, serial, text, integer, timestamp, boolean, unique, jsonb } from "drizzle-orm/pg-core";
import { usersTable } from "./users";

export type GearSlot = "weapon" | "helmet" | "armor" | "boots" | "accessory";
export type GearRarity = "common" | "rare" | "epic" | "legendary";
export type GearAbilityId = "might" | "intellect" | "attunement" | "presence" | "vigor" | "finesse";

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
  // Catalog expansion: false = drop-only treasure (won't appear in the Gear Store).
  // The store filters on this; loot/awardStreakGear draw from the full pool.
  inStore: boolean("in_store").notNull().default(true),
  // Gear stat mods (RPG-depth Act I(b)): a { abilityId: evenScoreBonus } map.
  // Raises the matching ability on the sheet + roll while equipped; upside-only.
  // Empty for common items (they carry statPower only). See lib/gear-mods.ts.
  statMods: jsonb("stat_mods").$type<Partial<Record<GearAbilityId, number>>>().notNull().default({}),
}, (table) => [
  unique("gear_items_name_unique").on(table.name),
]);

export const userGearTable = pgTable("user_gear", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().references(() => usersTable.id),
  gearItemId: integer("gear_item_id").notNull().references(() => gearItemsTable.id),
  equipped: boolean("equipped").notNull().default(false),
  // Attunement (D&D second wave): an equipped magic item may be attuned to draw
  // extra battle power. Only meaningful while equipped; unequipping clears it.
  attuned: boolean("attuned").notNull().default(false),
  acquiredAt: timestamp("acquired_at").notNull().defaultNow(),
}, (table) => [
  // Prevents a user from owning duplicate copies of the same gear item, which would allow
  // stacking battle power via repeated reward claims or concurrent purchase races.
  unique("user_gear_user_item_unique").on(table.userId, table.gearItemId),
]);

export type GearItem = typeof gearItemsTable.$inferSelect;
export type UserGear = typeof userGearTable.$inferSelect;
