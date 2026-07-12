export interface Cooldown {
  tryAcquire(userId: number, nowMs?: number): boolean;
}

/**
 * Best-effort, in-memory per-user rate guard. Single-instance only (Render free
 * tier); state resets on restart. Prevents rapid re-clicks and free-tier burn.
 */
export function createCooldown(intervalMs: number): Cooldown {
  const lastCall = new Map<number, number>();
  return {
    tryAcquire(userId, nowMs = Date.now()) {
      const prev = lastCall.get(userId);
      if (prev !== undefined && nowMs - prev < intervalMs) {
        return false;
      }
      lastCall.set(userId, nowMs);
      return true;
    },
  };
}

export const BREAKDOWN_COOLDOWN_MS = 3000;
export const breakdownCooldown = createCooldown(BREAKDOWN_COOLDOWN_MS);
