export type KnownRoute = "/" | "/focus" | "/reflection";

const KNOWN: ReadonlySet<string> = new Set<KnownRoute>(["/focus", "/reflection"]);

/**
 * Normalize a notification `data.url` into a route that actually exists in the
 * native app. Query/hash are stripped; anything not in the allowlist (including
 * "/", empty, null, and web-only paths) collapses to home ("/").
 */
export function normalizeDeepLink(url: string | undefined | null): KnownRoute {
  if (typeof url !== "string") return "/";
  const trimmed = url.trim();
  if (trimmed === "") return "/";
  const path = trimmed.split(/[?#]/, 1)[0];
  return KNOWN.has(path) ? (path as KnownRoute) : "/";
}
