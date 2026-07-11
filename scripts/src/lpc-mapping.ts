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

// our beard style id → LPC beard/mustache folder under spritesheets/beards/ (recolored via the
// hair palette, like hair). 'none' is not baked. 'goatee' has no upstream match (verified via the
// live GitHub tree: spritesheets/beards/ only has `beard/{5oclock_shadow,basic,medium,trimmed,winter}`
// and `mustache/{basic,bigstache,chevron,french,handlebar,horseshoe,lampshade,walrus}` — no
// chin-only goatee shape exists) and was removed from hero-options.beardStyles to match.
// `full` uses `beard/winter/male` — winter has no universal walk.png (only male/ and female/
// subfolders), but the two south-frame crops are byte-identical (verified by hash), so `male` is
// used unconditionally rather than adding a build split to the beard loop.
export const BEARD_STYLE_MAP: Record<string, string> = {
  stubble: "beard/5oclock_shadow", short: "beard/trimmed", full: "beard/winter/male", mustache: "mustache/basic",
};

// our glasses id → LPC leaf dir under spritesheets/facial/glasses/ (single color, universal,
// one adult/walk.png per style — no per-build split). 'none' is not baked. Verified via the live
// GitHub tree during Task 9: spritesheets/facial/glasses/ has {glasses,halfmoon,nerd,round,
// secretary,shades,sunglasses}/adult/walk.png — no folder literally named "square". "square" maps
// to `secretary` (boxy rectangular-lens reading glasses — the closest shape match, confirmed by
// visual inspection of the cropped south frame) rather than being dropped, since a usable
// square-ish shape does exist upstream.
export const GLASSES_MAP: Record<string, string> = {
  round: "facial/glasses/round/adult",
  square: "facial/glasses/secretary/adult",
  sunglasses: "facial/glasses/sunglasses/adult",
};

// our earring id → LPC leaf dir under spritesheets/facial/earrings/ (note: plural "earrings",
// not "earring" as the plan assumed). Verified via the live GitHub tree during Task 9:
// spritesheets/facial/earrings/ has {emerald,moon,pear,princess,simple,stud}/{male,female}/walk.png
// (per-build dirs, no shared "adult" leaf) — and a repo-wide search of the upstream CREDITS.csv
// (13765 rows, every shipped asset) turned up zero "hoop"-named files anywhere in the project.
// 'hoops' has NO usable upstream asset and was dropped from hero-options.earrings to match (see
// lib/hero-options/src/index.ts). 'studs' uses `stud/male` — its cropped south frame (y=128..191)
// is byte-identical (sha1) to `stud/female`'s, same precedent as BEARD_STYLE_MAP.full above, so a
// single build is used unconditionally rather than adding a build split to the cosmetic loop.
export const EARRING_MAP: Record<string, string> = {
  studs: "facial/earrings/stud/male",
};
