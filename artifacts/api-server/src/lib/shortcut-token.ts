import { createHash, randomBytes } from "node:crypto";

/** Pocket Gate personal-access tokens: `fqs_` + base64url(32 random bytes). */
export const TOKEN_PREFIX = "fqs_";

export interface MintedSecret {
  /** Full plaintext token — shown to the user exactly once, never stored. */
  token: string;
  /** sha256 hex digest — the only form that touches the database. */
  tokenHash: string;
}

export function mintTokenSecret(): MintedSecret {
  const token = TOKEN_PREFIX + randomBytes(32).toString("base64url");
  return { token, tokenHash: hashTokenSecret(token) };
}

export function hashTokenSecret(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function isShortcutToken(bearerValue: string): boolean {
  return bearerValue.startsWith(TOKEN_PREFIX);
}

// Default-deny route whitelist (spec D4): a shortcut token authenticates
// exactly these requests and nothing else — in particular never the
// /shortcut-tokens management routes, so a leaked token cannot mint tokens.
// Matched against the app-level req.path, which includes the /api mount.
const WHITELIST: ReadonlyArray<{ method: string; path: RegExp }> = [
  { method: "POST", path: /^\/api\/shortcuts\/capture$/ },
  { method: "GET", path: /^\/api\/shortcuts\/today$/ },
  { method: "POST", path: /^\/api\/tasks\/\d+\/complete$/ },
];

export function isShortcutRouteAllowed(method: string, path: string): boolean {
  return WHITELIST.some((w) => w.method === method && w.path.test(path));
}

/** Subset of an api_tokens row the auth decision needs. */
export interface TokenRowLike {
  revokedAt: Date | null;
  lastUsedAt: Date | null;
}

export type ShortcutAuthDecision =
  | { kind: "not-a-shortcut-token" }
  /** Wrong route, unknown or revoked token — the request stays unauthenticated. */
  | { kind: "deny" }
  | { kind: "allow"; refreshLastUsed: boolean };

/** last_used_at is a freshness hint for the Settings list, not an audit log —
 * refresh at most hourly so token auth doesn't write on every tap. */
export const LAST_USED_THROTTLE_MS = 60 * 60 * 1000;

export function evaluateShortcutAuth(input: {
  bearer: string;
  method: string;
  path: string;
  tokenRow: TokenRowLike | undefined;
  now?: Date;
}): ShortcutAuthDecision {
  if (!isShortcutToken(input.bearer)) return { kind: "not-a-shortcut-token" };
  if (!isShortcutRouteAllowed(input.method, input.path)) return { kind: "deny" };
  const row = input.tokenRow;
  if (!row || row.revokedAt !== null) return { kind: "deny" };
  const nowMs = (input.now ?? new Date()).getTime();
  const refreshLastUsed =
    row.lastUsedAt === null || nowMs - row.lastUsedAt.getTime() >= LAST_USED_THROTTLE_MS;
  return { kind: "allow", refreshLastUsed };
}
