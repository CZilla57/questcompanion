// Tabs-as-links (Act VII q2): grouped routes stay first-class pages joined by
// a link row, so deep links and old URLs never break. Styled after ui/tabs
// triggers; active state mirrors nav-groups' prefix rule for :id subroutes.
// A tab may carry a `feature` key (Act VI Quest Campaigns) — locked tabs are
// INVISIBLE, and an absent unlock list fails OPEN.
import { Link, useLocation } from "wouter";
import { useGetMyStats } from "@workspace/api-client-react";
import { NAV_GROUPS } from "@/lib/nav-groups";
import { isUnlocked } from "@/lib/feature-gates";
import { browserTimeZone } from "@/lib/timezone";

export function PageTabs({ group }: { group: "quests" | "progress" | "allies" | "rewards" }) {
  const [location] = useLocation();
  const { data: stats } = useGetMyStats({ tz: browserTimeZone() });
  const tabs = NAV_GROUPS.find((g) => g.key === group)?.tabs;
  if (!tabs) return null;

  const visible = tabs.filter(
    (t) => !t.feature || isUnlocked(stats?.unlockedFeatures, t.feature),
  );

  return (
    <div className="inline-flex h-9 items-center rounded-lg bg-muted p-1 text-muted-foreground mb-2" role="tablist" aria-label={`${group} sections`}>
      {visible.map((t) => {
        const active = location === t.href || location.startsWith(`${t.href}/`);
        return (
          <Link key={t.href} href={t.href} role="tab" aria-selected={active}
            className={`inline-flex items-center justify-center whitespace-nowrap rounded-md px-3 py-1 text-sm font-medium transition-all ${
              active ? "bg-background text-foreground shadow" : "hover:text-foreground"
            }`}>
            {t.label}
          </Link>
        );
      })}
    </div>
  );
}
