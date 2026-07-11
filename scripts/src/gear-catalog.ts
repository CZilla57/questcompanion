import type { GearSlot, GearRarity } from "@workspace/db";

export interface GearRosterItem {
  name: string; description: string; slot: GearSlot; rarity: GearRarity;
  statPower: number; costXp: number; levelRequired: number; icon: string; spriteId: string;
}

export const GEAR_CATALOG: GearRosterItem[] = [
  // weapons
  { name: "Rusty Sword",    description: "A pitted blade, but it cuts.",       slot: "weapon", rarity: "common",    statPower: 4,  costXp: 100,  levelRequired: 1,  icon: "Sword", spriteId: "sword" },
  { name: "Knight's Blade", description: "Balanced steel for a true fighter.", slot: "weapon", rarity: "rare",      statPower: 10, costXp: 600,  levelRequired: 5,  icon: "Sword", spriteId: "sword" },
  { name: "Zweihänder",     description: "A massive two-handed greatsword.",   slot: "weapon", rarity: "epic",      statPower: 18, costXp: 1600, levelRequired: 12, icon: "Sword", spriteId: "greatsword" },
  { name: "Gnarled Staff",  description: "Channels arcane focus.",             slot: "weapon", rarity: "rare",      statPower: 9,  costXp: 600,  levelRequired: 5,  icon: "Gem",   spriteId: "staff" },
  { name: "Hunter's Sling",    description: "A swift ranged sidearm.",          slot: "weapon", rarity: "rare",      statPower: 9,  costXp: 550,  levelRequired: 5,  icon: "Sword", spriteId: "slingshot" },  // was crossbow (blank south frame → slingshot, Task 3)
  { name: "Excalibur",      description: "The legendary blade of kings.",      slot: "weapon", rarity: "legendary", statPower: 30, costXp: 5000, levelRequired: 25, icon: "Sword", spriteId: "excalibur" },
  { name: "Staff of the Archmage", description: "Raw magic given form.",       slot: "weapon", rarity: "legendary", statPower: 28, costXp: 5000, levelRequired: 25, icon: "Gem",   spriteId: "archmage-staff" },
  // helmets
  { name: "Leather Cap",    description: "Simple head protection.",            slot: "helmet", rarity: "common",    statPower: 3,  costXp: 80,   levelRequired: 1,  icon: "HardHat", spriteId: "cap" },
  { name: "Iron Helm",      description: "Sturdy forged headgear.",            slot: "helmet", rarity: "rare",      statPower: 8,  costXp: 500,  levelRequired: 4,  icon: "HardHat", spriteId: "helm" },
  { name: "Great Helm",     description: "Full-face knightly protection.",     slot: "helmet", rarity: "epic",      statPower: 14, costXp: 1400, levelRequired: 11, icon: "HardHat", spriteId: "greathelm" },
  { name: "Crown of Valor", description: "Worn only by champions.",            slot: "helmet", rarity: "legendary", statPower: 24, costXp: 4500, levelRequired: 22, icon: "Crown",   spriteId: "crown" },
  // armor
  { name: "Leather Vest",   description: "Light, flexible protection.",        slot: "armor",  rarity: "common",    statPower: 5,  costXp: 120,  levelRequired: 1,  icon: "ShieldHalf", spriteId: "leather-armor" },
  { name: "Chainmail",      description: "Interlocking steel rings.",          slot: "armor",  rarity: "rare",      statPower: 12, costXp: 700,  levelRequired: 6,  icon: "ShieldHalf", spriteId: "mail" },
  { name: "Plate Armor",    description: "Heavy forged protection.",           slot: "armor",  rarity: "epic",      statPower: 20, costXp: 1800, levelRequired: 13, icon: "ShieldHalf", spriteId: "plate" },
  { name: "Dragonscale Plate", description: "Forged from dragon hide.",        slot: "armor",  rarity: "legendary", statPower: 34, costXp: 5500, levelRequired: 26, icon: "ShieldHalf", spriteId: "dragon-plate" },
  // boots
  { name: "Worn Shoes",     description: "Better than bare feet.",             slot: "boots",  rarity: "common",    statPower: 2,  costXp: 60,   levelRequired: 1,  icon: "Footprints", spriteId: "shoes" },
  { name: "Traveler's Boots", description: "Made for the long road.",          slot: "boots",  rarity: "rare",      statPower: 7,  costXp: 450,  levelRequired: 4,  icon: "Footprints", spriteId: "boots" },
  { name: "Steel Greaves",  description: "Armored leg guards.",                slot: "boots",  rarity: "epic",      statPower: 13, costXp: 1300, levelRequired: 11, icon: "Footprints", spriteId: "greaves" },
  // accessory
  { name: "Traveler's Cloak", description: "A warm, sturdy cape.",             slot: "accessory", rarity: "common", statPower: 3, costXp: 90,   levelRequired: 1,  icon: "Gem", spriteId: "cape" },
  { name: "Amulet of Focus", description: "Sharpens the mind.",                slot: "accessory", rarity: "rare",   statPower: 8, costXp: 550,  levelRequired: 5,  icon: "Gem", spriteId: "amulet" },
];
