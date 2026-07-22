// Single source of truth for the 7-entry nav and its tab groups (Act VII q2).
// Pure — layout.tsx and page-tabs.tsx both derive from this; icons stay in layout.
import type { FeatureKey } from "./feature-gates";

export interface NavTab {
  label: string;
  href: string;
  // Act VI Quest Campaigns: a tab inside an ALWAYS-ON group can still be
  // gated. Undefined means ungated (the common case). Required-but-undefined
  // like NavGroup.tabs below: every literal keeps the `feature` key (set to
  // `undefined` when ungated) so `t.feature` stays legal across the
  // as-const union element type instead of vanishing from literals that
  // omitted it.
  feature?: FeatureKey;
}
export interface NavGroup {
  key: string;
  label: string;
  href: string;        // where the nav entry lands
  mobileShow: boolean; // bottom-bar membership (exactly 5 true)
  // Tabs-as-links rendered on every page in the group. Required-but-undefined
  // (not optional): every literal keeps the prop, so `g.tabs` stays legal on
  // the as-const union element type.
  tabs: readonly NavTab[] | undefined;
}

export const NAV_GROUPS = [
  { key: "home", label: "Home", href: "/", mobileShow: true, tabs: undefined },
  {
    key: "quests", label: "Quests", href: "/tasks", mobileShow: true,
    tabs: [
      { label: "Today", href: "/tasks", feature: undefined },
      { label: "Questlines", href: "/questlines", feature: undefined },
      { label: "Campaigns", href: "/campaigns", feature: "campaigns" },
      { label: "Recurring", href: "/recurring", feature: undefined },
    ],
  },
  { key: "focus", label: "Focus", href: "/focus", mobileShow: true, tabs: undefined },
  {
    key: "progress", label: "Progress", href: "/progress", mobileShow: true,
    tabs: [
      { label: "Progress", href: "/progress", feature: undefined },
      { label: "Insights", href: "/insights", feature: undefined },
    ],
  },
  { key: "hero", label: "Hero", href: "/avatar", mobileShow: true, tabs: undefined },
  {
    key: "allies", label: "Allies", href: "/partners", mobileShow: false,
    tabs: [
      { label: "Allies", href: "/partners", feature: undefined },
      { label: "Leaderboard", href: "/leaderboard", feature: undefined },
    ],
  },
  {
    // The Rewards hub (Act VII q3, Honest Coin): three first-class tab routes.
    // /rewards and /dopamine-menu redirect to Treats in App.tsx.
    key: "rewards", label: "Rewards", href: "/rewards/treats", mobileShow: false,
    tabs: [
      { label: "Treats", href: "/rewards/treats", feature: undefined },
      { label: "Store", href: "/rewards/store", feature: undefined },
      { label: "Perks", href: "/rewards/perks", feature: undefined },
    ],
  },
] as const satisfies readonly NavGroup[];

/** Literal union of group keys — maps typed `Record<NavGroupKey, …>` stay
 * exhaustive, so adding a group without updating them fails typecheck. */
export type NavGroupKey = (typeof NAV_GROUPS)[number]["key"];

/** Which nav group is active for a location: exact group/tab href match, or a
 * `${href}/` prefix so /questlines/7 lights Quests. "/" only matches exactly. */
export function activeGroupKey(location: string): string | null {
  for (const g of NAV_GROUPS) {
    const hrefs = [g.href, ...(g.tabs ?? []).map((t) => t.href)];
    for (const href of hrefs) {
      if (location === href) return g.key;
      if (href !== "/" && location.startsWith(`${href}/`)) return g.key;
    }
  }
  return null;
}
