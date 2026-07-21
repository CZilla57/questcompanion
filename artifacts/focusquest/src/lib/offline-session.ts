import { isNetworkError } from "@/lib/net-errors";

/** Last-known-good session facts, written only on positive server answers.
 * Grace NEVER comes from this record alone — only from record + an
 * unreachable-server signal. A real 401/logged-out answer clears it. */
export type SessionRecord = {
  authed: boolean;
  onboardingComplete: boolean;
  savedAt: string;
};

const KEY = "fq.offline-session";

export function readSessionRecord(storage?: Pick<Storage, "getItem">): SessionRecord | null {
  try {
    const s = storage ?? localStorage;
    const raw = s.getItem(KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<SessionRecord>;
    if (typeof parsed !== "object" || parsed === null) return null;
    return {
      authed: parsed.authed === true,
      onboardingComplete: parsed.onboardingComplete === true,
      savedAt: typeof parsed.savedAt === "string" ? parsed.savedAt : "",
    };
  } catch {
    return null;
  }
}

export function writeSessionRecord(
  patch: Partial<Omit<SessionRecord, "savedAt">>,
  storage?: Pick<Storage, "getItem" | "setItem">,
): void {
  try {
    const s = storage ?? localStorage;
    const current = readSessionRecord(s);
    const next: SessionRecord = {
      authed: patch.authed ?? current?.authed ?? false,
      onboardingComplete: patch.onboardingComplete ?? current?.onboardingComplete ?? false,
      savedAt: new Date().toISOString(),
    };
    s.setItem(KEY, JSON.stringify(next));
  } catch {
    // Storage unavailable (private mode): grace simply won't apply.
  }
}

export function clearSessionRecord(storage?: Pick<Storage, "removeItem">): void {
  try {
    const s = storage ?? localStorage;
    s.removeItem(KEY);
  } catch {
    /* ignore */
  }
}

function isUnreachableError(err: unknown): boolean {
  if (isNetworkError(err)) return true;
  const status = (err as { status?: unknown } | null)?.status;
  return typeof status === "number" && status >= 500;
}

export function authVerdict(args: {
  isAuthenticated: boolean;
  failure: "unreachable" | null;
  record: SessionRecord | null;
}): "in" | "out" {
  if (args.isAuthenticated) return "in";
  if (args.failure === "unreachable" && args.record?.authed) return "in";
  return "out";
}

export function onboardingVerdict(args: {
  stats: { onboardingComplete?: boolean } | undefined;
  isPaused: boolean;
  error: unknown;
  record: SessionRecord | null;
}): "app" | "onboarding" | "loading" {
  if (args.stats) return args.stats.onboardingComplete ? "app" : "onboarding";
  const unreachable = args.isPaused || (args.error != null && isUnreachableError(args.error));
  if (unreachable && args.record?.onboardingComplete) return "app";
  // No positive answer and no grace: hold at loading — the onboarding screen
  // only ever shows on a positive "not onboarded" from the server.
  return "loading";
}
