// The hero's life outside the app: short medieval-RPG vignettes selected
// deterministically from (userId, 3-hour time bucket) — rotates on its own,
// identical across devices, zero storage. Ambience follows hunger: well-fed
// heroes adventure, starving heroes huddle by the fire.
import { hashSeed, type HungerStage } from "./hero-care";

export type HeroClass = "fighter" | "mage" | "ranger" | "healer";

export type Vignette = {
  id: string;
  text: string;
  stages: HungerStage[];
  /** Restrict to avatar classes; omit = all classes. Literal union so a typo is a compile error. */
  classes?: HeroClass[];
};

export const VIGNETTES: Vignette[] = [
  // ── well_fed: out living their best medieval life ─────────────────────────
  { id: "tavern_tales", text: "swapping tales of your latest victories at the Gilded Tankard", stages: ["well_fed"] },
  { id: "market_haggle", text: "haggling with a potion merchant over a suspiciously cheap elixir", stages: ["well_fed"] },
  { id: "griffin_hunt", text: "off hunting griffins in the northern hills", stages: ["well_fed"] },
  { id: "millpond_fishing", text: "fishing lazily at the millpond, boots off", stages: ["well_fed"] },
  { id: "blacksmith_polish", text: "getting their gear polished at the blacksmith's", stages: ["well_fed"] },
  { id: "bard_song", text: "requesting one more song from the tavern bard", stages: ["well_fed"] },
  { id: "notice_board", text: "studying the quest notice board in the town square", stages: ["well_fed"] },
  { id: "old_ruins", text: "exploring moss-covered ruins beyond the east road", stages: ["well_fed"] },
  { id: "arm_wrestle", text: "winning an arm-wrestling match against the innkeeper", stages: ["well_fed"] },
  { id: "stargazing", text: "stargazing on the castle ramparts", stages: ["well_fed"] },
  { id: "harvest_festival", text: "sampling honey cakes at the harvest festival", stages: ["well_fed"] },
  { id: "card_game", text: "losing gracefully at cards to a retired knight", stages: ["well_fed"] },
  // class flavor
  { id: "fighter_sparring", text: "sparring with the town guard — they're improving", stages: ["well_fed"], classes: ["fighter"] },
  { id: "fighter_armory", text: "inspecting new blades at the armory", stages: ["well_fed"], classes: ["fighter"] },
  { id: "mage_scrolls", text: "transcribing scrolls in the archive tower", stages: ["well_fed"], classes: ["mage"] },
  { id: "mage_experiment", text: "testing a new spell — the smoke is probably fine", stages: ["well_fed"], classes: ["mage"] },
  { id: "ranger_tracking", text: "tracking deer trails through the greenwood", stages: ["well_fed"], classes: ["ranger"] },
  { id: "ranger_hawk", text: "training a young hawk to carry messages", stages: ["well_fed"], classes: ["ranger"] },
  { id: "healer_herbs", text: "gathering moonpetal herbs by the riverbank", stages: ["well_fed"], classes: ["healer"] },
  { id: "healer_clinic", text: "tending scraped knees at the village clinic", stages: ["well_fed"], classes: ["healer"] },

  // ── peckish: appetite creeping in ─────────────────────────────────────────
  { id: "foraging", text: "foraging for berries along the road", stages: ["peckish"] },
  { id: "baker_stall", text: "eyeing the baker's stall wistfully", stages: ["peckish"] },
  { id: "stew_smell", text: "following the smell of stew through the market", stages: ["peckish"] },
  { id: "apple_tree", text: "shaking an apple tree with modest success", stages: ["peckish"] },
  { id: "roast_daydream", text: "daydreaming about a proper roast dinner", stages: ["peckish"] },

  // ── hungry: rationing ──────────────────────────────────────────────────────
  { id: "trail_bread", text: "rationing the last of the trail bread", stages: ["hungry"] },
  { id: "belt_notch", text: "tightening their belt another notch", stages: ["hungry"] },
  { id: "sad_turnip", text: "considering a suspicious-looking turnip", stages: ["hungry"] },
  { id: "loud_stomach", text: "trying to ignore a very loud stomach", stages: ["hungry"] },

  // ── starving: too weak to travel ──────────────────────────────────────────
  { id: "dying_campfire", text: "huddled by a dying campfire, too weak to travel", stages: ["starving"] },
  { id: "milestone_rest", text: "resting against a roadside milestone, saving their strength", stages: ["starving"] },
  { id: "heavy_pack", text: "too weak to lift their pack — a quest would be a feast", stages: ["starving"] },

  // ── fainted ────────────────────────────────────────────────────────────────
  { id: "collapsed_roadside", text: "lies unconscious at the roadside… only a completed quest can revive them", stages: ["fainted"] },
  { id: "collapsed_hunger", text: "has collapsed from hunger. Complete any quest to revive them!", stages: ["fainted"] },
];

const BUCKET_MS = 3 * 60 * 60 * 1000; // rotate the ambient status line every 3 hours

export function currentVignette(
  userId: number,
  stage: HungerStage,
  avatarClass: string,
  now: Date,
): Vignette {
  const eligible = VIGNETTES.filter(
    // avatarClass stays string (raw DB value); widen classes for the lookup.
    (v) => v.stages.includes(stage) && (!v.classes || (v.classes as readonly string[]).includes(avatarClass)),
  );
  const bucket = Math.floor(now.getTime() / BUCKET_MS);
  const idx = hashSeed(`${userId}:${bucket}`) % eligible.length;
  return eligible[idx]!;
}
