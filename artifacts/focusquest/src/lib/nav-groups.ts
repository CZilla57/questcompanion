// Single source of truth for the 7-entry nav and its tab groups (Act VII q2).
// Pure — layout.tsx and page-tabs.tsx both derive from this; icons stay in layout.

export interface NavTab { label: string; href: string }
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
      { label: "Today", href: "/tasks" },
      { label: "Questlines", href: "/questlines" },
      { label: "Recurring", href: "/recurring" },
    ],
  },
  { key: "focus", label: "Focus", href: "/focus", mobileShow: true, tabs: undefined },
  {
    key: "progress", label: "Progress", href: "/progress", mobileShow: true,
    tabs: [
      { label: "Progress", href: "/progress" },
      { label: "Insights", href: "/insights" },
    ],
  },
  { key: "hero", label: "Hero", href: "/avatar", mobileShow: true, tabs: undefined },
  {
    key: "allies", label: "Allies", href: "/partners", mobileShow: false,
    tabs: [
      { label: "Allies", href: "/partners" },
      { label: "Leaderboard", href: "/leaderboard" },
    ],
  },
  {
    // The Rewards hub (Act VII q3, Honest Coin): three first-class tab routes.
    // /rewards and /dopamine-menu redirect to Treats in App.tsx.
    key: "rewards", label: "Rewards", href: "/rewards/treats", mobileShow: false,
    tabs: [
      { label: "Treats", href: "/rewards/treats" },
      { label: "Store", href: "/rewards/store" },
      { label: "Perks", href: "/rewards/perks" },
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
