// LPC id → source palette/style mapping, keyed by @workspace/hero-options ids.
// Extend HERE (plus the matching hero-options axis) to add an option.
export const SKIN_MAP: Record<string, string> = {
  light: "light", tan: "amber", brown: "brown", dark: "black", green: "green", blue: "blue",
  olive: "olive", bronze: "bronze", almond: "taupe",
};

export const HAIR_STYLE_MAP: Record<string, string> = {
  short: "plain", long: "long", ponytail: "ponytail", afro: "afro",
  bob: "bob", curly: "curly_long", spiked: "spiked", bangs: "bangs", pixie: "pixie",
};

export const HAIR_COLOR_CANDS: Record<string, string[]> = {
  brown: ["brown", "light_brown", "dark_brown"], black: ["black", "raven"],
  blonde: ["blonde", "blond", "gold"], red: ["redhead", "red", "carrot", "ginger"],
  white: ["white", "platinum", "gray", "silver"], blue: ["blue", "navy"],
  gray: ["gray", "grey"], auburn: ["chestnut", "auburn"], green: ["green"],
  purple: ["purple", "violet"], pink: ["pink", "rose"], orange: ["orange", "carrot"],
};
