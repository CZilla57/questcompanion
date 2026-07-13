import type { CSSProperties } from "react";

export type HungerStage = "well_fed" | "peckish" | "hungry" | "starving" | "fainted";

const SEGMENTS: Record<HungerStage, number> = {
  well_fed: 5,
  peckish: 4,
  hungry: 3,
  starving: 1,
  fainted: 0,
};

const LABELS: Record<HungerStage, string> = {
  well_fed: "Well Fed",
  peckish: "Peckish",
  hungry: "Hungry",
  starving: "Starving",
  fainted: "Fainted",
};

/** Filled segments (of 5) on the vitality bar. */
export function stageSegments(stage: HungerStage): number {
  return SEGMENTS[stage];
}

export function stageLabel(stage: HungerStage): string {
  return LABELS[stage];
}

/**
 * CSS-only hunger treatment for the hero sprite. The LPC pipeline bakes a
 * single frame per layer, so the collapsed look is a transform, not new art.
 */
export function heroSpriteEffect(stage: HungerStage | undefined): CSSProperties {
  switch (stage) {
    case "hungry":
      return { filter: "saturate(0.6)" };
    case "starving":
      return { filter: "grayscale(0.85) brightness(0.9)", transform: "rotate(6deg)" };
    case "fainted":
      return { filter: "grayscale(1) brightness(0.85)", transform: "rotate(90deg) translateY(-12%)" };
    default:
      return {};
  }
}
