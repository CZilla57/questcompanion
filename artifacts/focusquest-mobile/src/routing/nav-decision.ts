import { normalizeDeepLink, type KnownRoute } from "./url-routing";

export type AuthStatus = "loading" | "authed" | "anon";

/**
 * Decide where a pending deep link should send the user, given current auth.
 * Returns the route to navigate to (caller then clears pendingUrl), or null to
 * wait. Cold-start taps arriving before session restore (`loading`) wait; taps
 * while logged out (`anon`) are held until the user authenticates.
 */
export function nextNav(status: AuthStatus, pendingUrl: string | null): KnownRoute | null {
  if (status !== "authed") return null;
  if (pendingUrl === null) return null;
  return normalizeDeepLink(pendingUrl);
}
