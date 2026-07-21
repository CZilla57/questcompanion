import { createCooldown } from "./ai/breakdown-cooldown";

// Spec D8: per-user interval guards on the Pocket Gate surface, using the
// house cooldown primitive (one call per interval; in-memory, single-instance).
// Mint is anti-spam only — the 5-active-token cap is the real bound, and
// back-to-back "iPhone"/"iPad" mints must stay pleasant.
export const CAPTURE_COOLDOWN_MS = 6_000; // ~10/min
export const TODAY_COOLDOWN_MS = 2_000; // ~30/min
export const MINT_COOLDOWN_MS = 10_000;

export const captureCooldown = createCooldown(CAPTURE_COOLDOWN_MS);
export const todayCooldown = createCooldown(TODAY_COOLDOWN_MS);
export const mintCooldown = createCooldown(MINT_COOLDOWN_MS);
