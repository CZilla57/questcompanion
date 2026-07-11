export interface Option {
  readonly id: string;
  readonly label: string;
  readonly swatch?: string;
}

export const builds = [
  { id: "male", label: "Male" },
  { id: "female", label: "Female" },
] as const satisfies readonly Option[];

export const skins = [
  { id: "light", label: "Light", swatch: "#FDBCB4" },
  { id: "tan", label: "Tan", swatch: "#D4956A" },
  { id: "brown", label: "Brown", swatch: "#8D5524" },
  { id: "dark", label: "Dark", swatch: "#4A2512" },
  { id: "green", label: "Green", swatch: "#7BC47F" },
  { id: "blue", label: "Blue", swatch: "#89C4E1" },
  { id: "olive", label: "Olive", swatch: "#b98a54" },
  { id: "bronze", label: "Bronze", swatch: "#8a5a34" },
  { id: "almond", label: "Almond", swatch: "#c7935f" },
] as const satisfies readonly Option[];

export const hairStyles = [
  { id: "bald", label: "Bald" },
  { id: "short", label: "Short" },
  { id: "long", label: "Long" },
  { id: "ponytail", label: "Ponytail" },
  { id: "afro", label: "Afro" },
  { id: "bob", label: "Bob" },
  { id: "curly", label: "Curly" },
  { id: "spiked", label: "Spiked" },
  { id: "bangs", label: "Bangs" },
  { id: "pixie", label: "Pixie" },
] as const satisfies readonly Option[];

// Shared color palette — hairColors and beardColors both reference it.
export const hairColors = [
  { id: "brown", label: "Brown", swatch: "#5b3a1e" },
  { id: "black", label: "Black", swatch: "#242424" },
  { id: "blonde", label: "Blonde", swatch: "#E6C35C" },
  { id: "red", label: "Red", swatch: "#a83232" },
  { id: "white", label: "White", swatch: "#e8e8ea" },
  { id: "blue", label: "Blue", swatch: "#3a4a9e" },
  { id: "gray", label: "Gray", swatch: "#9a9a9a" },
  { id: "auburn", label: "Auburn", swatch: "#8a3b1e" },
  { id: "green", label: "Green", swatch: "#3f8f4f" },
  { id: "purple", label: "Purple", swatch: "#7c3aed" },
  { id: "pink", label: "Pink", swatch: "#ec6fa8" },
  { id: "orange", label: "Orange", swatch: "#d97a2b" },
] as const satisfies readonly Option[];

export const faces = [
  { id: "neutral", label: "Neutral" },
  { id: "stern", label: "Stern" },
  { id: "smile", label: "Smile" },
] as const satisfies readonly Option[];

export const beardStyles = [
  { id: "none", label: "None" },
  { id: "stubble", label: "Stubble" },
  { id: "short", label: "Short" },
  { id: "full", label: "Full" },
  { id: "goatee", label: "Goatee" },
  { id: "mustache", label: "Mustache" },
] as const satisfies readonly Option[];

// Beard color shares the hair palette but is an independent selection.
export const beardColors = hairColors;

export const glasses = [
  { id: "none", label: "None" },
  { id: "round", label: "Round" },
  { id: "square", label: "Square" },
  { id: "sunglasses", label: "Sunglasses" },
] as const satisfies readonly Option[];

export const earrings = [
  { id: "none", label: "None" },
  { id: "studs", label: "Studs" },
  { id: "hoops", label: "Hoops" },
] as const satisfies readonly Option[];

export const classes = [
  { id: "fighter", label: "Fighter", swatch: "#ef4444" },
  { id: "mage", label: "Mage", swatch: "#8b5cf6" },
  { id: "ranger", label: "Ranger", swatch: "#22c55e" },
  { id: "healer", label: "Healer", swatch: "#f59e0b" },
] as const satisfies readonly Option[];

// Accent color palette (profile/leaderboard) — id is the hex itself.
export const colors = [
  { id: "#00FFFF", label: "Cyan" },
  { id: "#A855F7", label: "Purple" },
  { id: "#F97316", label: "Orange" },
  { id: "#22C55E", label: "Green" },
  { id: "#EC4899", label: "Pink" },
  { id: "#EAB308", label: "Yellow" },
  { id: "#6366F1", label: "Indigo" },
  { id: "#F43F5E", label: "Rose" },
] as const satisfies readonly Option[];

export type BuildId = (typeof builds)[number]["id"];
export type SkinId = (typeof skins)[number]["id"];
export type HairStyleId = (typeof hairStyles)[number]["id"];
export type HairColorId = (typeof hairColors)[number]["id"];
export type FaceId = (typeof faces)[number]["id"];
export type ClassId = (typeof classes)[number]["id"];
export type BeardStyleId = (typeof beardStyles)[number]["id"];
export type BeardColorId = HairColorId;
export type GlassesId = (typeof glasses)[number]["id"];
export type EarringId = (typeof earrings)[number]["id"];

export function ids(o: readonly Option[]): string[] {
  return o.map((x) => x.id);
}

export function includesId(o: readonly Option[], value: string): boolean {
  return o.some((x) => x.id === value);
}
