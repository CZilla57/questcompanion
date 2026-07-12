import { createCooldown } from "./breakdown-cooldown";

export const PARSE_COOLDOWN_MS = 3000;
export const parseCooldown = createCooldown(PARSE_COOLDOWN_MS);
