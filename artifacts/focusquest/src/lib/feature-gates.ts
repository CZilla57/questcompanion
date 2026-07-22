// Act VII Gentle Door (q5). Locked features are INVISIBLE — no teasers, no
// level-N teasers, no countdowns (anti-shame law). The client renders
// whatever the server's `unlockedFeatures` list says; an ABSENT list (offline
// shell, cold start) fails OPEN — this is pacing, not authorization, and a
// grandfathered user offline must never lose chrome.
import { NAV_GROUPS, type NavGroupKey } from "./nav-groups";

export type FeatureKey = "focus" | "hero" | "progress" | "allies" | "rewards" | "campaigns";

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
  // Safe by construction: every non-always-on NavGroupKey is a FeatureKey —
  // nav-groups.ts and this module share the same key vocabulary.
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
  { prefix: "/campaigns", feature: "campaigns" },
];

export function routeFeature(path: string): FeatureKey | null {
  for (const r of ROUTE_FEATURES) {
    if (path === r.prefix || path.startsWith(`${r.prefix}/`)) return r.feature;
  }
  return null;
}

// Labels for keys that are NOT nav groups (Quest Campaigns gates a tab inside
// the always-on quests group), falling back to the nav group's own label.
const EXTRA_LABELS: Record<string, string> = { campaigns: "Campaigns" };

/** Label for the unlock celebration — the same word the UI will show. */
export function featureLabel(key: string): string {
  return EXTRA_LABELS[key] ?? NAV_GROUPS.find((g) => g.key === key)?.label ?? key;
}
