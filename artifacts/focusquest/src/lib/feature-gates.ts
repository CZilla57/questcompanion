// Act VII Gentle Door (q5). Locked features are INVISIBLE — no teasers, no
// "unlocks at level N", no countdowns (anti-shame law). The client renders
// whatever the server's `unlockedFeatures` list says; an ABSENT list (offline
// shell, cold start) fails OPEN — this is pacing, not authorization, and a
// grandfathered user offline must never lose chrome.
import { NAV_GROUPS, type NavGroupKey } from "./nav-groups";

export type FeatureKey = "focus" | "hero" | "progress" | "allies" | "rewards";

const ALWAYS_ON: ReadonlySet<NavGroupKey> = new Set(["home", "quests"]);

export function isUnlocked(
  unlockedFeatures: readonly string[] | undefined,
  key: FeatureKey,
): boolean {
  return unlockedFeatures === undefined || unlockedFeatures.includes(key);
}

export function isNavGroupVisible(
  key: NavGroupKey,
  unlockedFeatures: readonly string[] | undefined,
): boolean {
  if (ALWAYS_ON.has(key)) return true;
  return isUnlocked(unlockedFeatures, key as FeatureKey);
}

// Path prefix → gate. Anything unlisted is L1 core and never gated.
const ROUTE_FEATURES: ReadonlyArray<{ prefix: string; feature: FeatureKey }> = [
  { prefix: "/focus", feature: "focus" },
  { prefix: "/avatar", feature: "hero" },
  { prefix: "/progress", feature: "progress" },
  { prefix: "/insights", feature: "progress" },
  { prefix: "/partners", feature: "allies" },
  { prefix: "/leaderboard", feature: "allies" },
  { prefix: "/rewards", feature: "rewards" },
];

export function routeFeature(path: string): FeatureKey | null {
  for (const r of ROUTE_FEATURES) {
    if (path === r.prefix || path.startsWith(`${r.prefix}/`)) return r.feature;
  }
  return null;
}

/** Label for the unlock celebration — the same word the nav will show. */
export function featureLabel(key: string): string {
  return NAV_GROUPS.find((g) => g.key === key)?.label ?? key;
}
