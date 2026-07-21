// Act VII Gentle Door (q5): hero-name rename rules. Pure — no I/O.
// The onboarding set is free and starts no clock; each later rename opens a
// 7-day window. The gentle door's whole point: minute-zero decisions are
// reversible.
export const USERNAME_REGEX = /^[a-zA-Z0-9_]{3,20}$/;
export const RENAME_COOLDOWN_MS = 7 * 24 * 60 * 60 * 1000;

export type RenameDecision =
  | { kind: "noop" }
  | { kind: "invalid_format" }
  | { kind: "cooldown"; renameAvailableAt: Date }
  | { kind: "ok"; isOnboardingSet: boolean };

export function decideRename(args: {
  current: string;
  requested: string;
  onboardingComplete: boolean;
  usernameChangedAt: Date | null;
  now: Date;
}): RenameDecision {
  const requested = args.requested.trim();
  if (requested === args.current && args.onboardingComplete) return { kind: "noop" };
  if (!USERNAME_REGEX.test(requested)) return { kind: "invalid_format" };
  if (args.onboardingComplete && args.usernameChangedAt) {
    const availableAt = new Date(args.usernameChangedAt.getTime() + RENAME_COOLDOWN_MS);
    if (args.now.getTime() < availableAt.getTime()) {
      return { kind: "cooldown", renameAvailableAt: availableAt };
    }
  }
  return { kind: "ok", isOnboardingSet: !args.onboardingComplete };
}

/** ISO instant the next rename opens, or null when renaming is available now. */
export function renameAvailableAt(usernameChangedAt: Date | null, now: Date): string | null {
  if (!usernameChangedAt) return null;
  const at = new Date(usernameChangedAt.getTime() + RENAME_COOLDOWN_MS);
  return at.getTime() > now.getTime() ? at.toISOString() : null;
}

/** Postgres unique-violation (23505), wherever the driver buried it. */
export function isUniqueViolation(err: unknown): boolean {
  let e: unknown = err;
  while (e && typeof e === "object") {
    if ((e as { code?: unknown }).code === "23505") return true;
    e = (e as { cause?: unknown }).cause;
  }
  return false;
}
