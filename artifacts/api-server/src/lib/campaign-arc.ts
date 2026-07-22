// Act VI Quest Campaigns: hand-written story arcs. Pure — no I/O, no AI.
// These are the FALLBACK PATH, not an error path: campaign creation must never
// fail because the model is unavailable. Prose is deliberately goal-agnostic so
// it reads correctly without knowing what the user is actually working on.

export const MIN_CHAPTERS = 3;
export const MAX_CHAPTERS = 5;

export interface Arc {
  arcPremise: string;
  endingBeat: string;
  chapterBeats: string[];
}

export const CURATED_ARCS = [
  {
    key: "the_long_haul",
    premise: "Some roads are walked, not sprinted. This one is yours, and it is long enough to be worth walking.",
    ending: "The road ends where you stand. You walked all of it, on the days it was easy and the days it wasn't.",
    beats: [
      "The first stretch is behind you. That was the part most people never start.",
      "You have found your pace. The road stops fighting you.",
      "The middle miles — quiet, unglamorous, and the ones that actually carry you.",
      "The ground begins to rise. You are further along than the view suggests.",
      "The last stretch is in sight, and you already know how to walk it.",
    ],
  },
  {
    key: "the_reclamation",
    premise: "Something here was yours before it slipped out of reach. This is the work of taking it back.",
    ending: "It's yours again. Not because it was returned to you, but because you went and got it.",
    beats: [
      "The first corner is reclaimed. Small, but unmistakably yours again.",
      "What was scattered is starting to hold a shape.",
      "The hard middle: the part that was always going to take real work.",
      "More of it is yours now than isn't.",
      "Only the edges remain, and edges go quickly.",
    ],
  },
  {
    key: "the_steady_climb",
    premise: "No summit is taken in one move. It is taken in the ordinary steps nobody claps for.",
    ending: "You're at the top. It was never one heroic push — it was every ordinary step you took.",
    beats: [
      "The climb has begun. The first ledge always looks smaller from above.",
      "Height gained. Look back once — then keep going.",
      "The steep section, met and passed.",
      "The air is thinner here, and you are still climbing.",
      "The summit is one honest push away.",
    ],
  },
  {
    key: "the_open_workshop",
    premise: "Nothing worth having arrives finished. This is the bench where it gets built, piece by piece.",
    ending: "It's built. It exists because you kept coming back to the bench.",
    beats: [
      "The bench is cleared and the first piece is cut. Work can begin.",
      "The frame holds. What was an idea now has edges.",
      "The fiddly middle work — the part that decides whether it lasts.",
      "It looks like the thing it was meant to be.",
      "Final fittings. Everything from here is finish work.",
    ],
  },
] as const;

/** Positive modulo so negative picks wrap instead of throwing. */
function wrapIndex(pick: number, length: number): number {
  return ((Math.trunc(pick) % length) + length) % length;
}

/** A curated arc trimmed to the requested chapter count. Deterministic: the same
 * (count, pick) always yields the same text. */
export function curatedArc(chapterCount: number, pick = 0): Arc {
  const arc = CURATED_ARCS[wrapIndex(pick, CURATED_ARCS.length)]!;
  const count = Math.max(MIN_CHAPTERS, Math.min(chapterCount, MAX_CHAPTERS));
  return {
    arcPremise: arc.premise,
    endingBeat: arc.ending,
    chapterBeats: arc.beats.slice(0, count),
  };
}
