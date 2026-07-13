import { createCooldown } from "./breakdown-cooldown";

export const SUGGEST_COOLDOWN_MS = 3000;
export const suggestCooldown = createCooldown(SUGGEST_COOLDOWN_MS);
