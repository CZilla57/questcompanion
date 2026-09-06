// The Campaign — Phase 2: shared web helpers for rendering encounters.

/** Label an encounter's health phase. Anti-shame: the felled state reads
 *  "At rest", never "dead"/"defeated by the boss". */
export function encounterPhaseLabel(phase: string): string {
  switch (phase) {
    case "fresh": return "Standing strong";
    case "bloodied": return "Bloodied";
    case "wounded": return "Barely standing";
    case "resting": return "At rest";
    default: return "";
  }
}
