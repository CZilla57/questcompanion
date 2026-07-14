import { createCooldown } from "./breakdown-cooldown";

export const TRANSCRIBE_COOLDOWN_MS = 5000;
export const transcribeCooldown = createCooldown(TRANSCRIBE_COOLDOWN_MS);
