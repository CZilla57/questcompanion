import { createCooldown } from "./breakdown-cooldown";

export const VARIANTS_COOLDOWN_MS = 3000;
export const variantsCooldown = createCooldown(VARIANTS_COOLDOWN_MS);
