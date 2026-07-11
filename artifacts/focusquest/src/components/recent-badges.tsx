import { useGetMyBadges } from "@workspace/api-client-react";
import { Link } from "wouter";
import { Award, ChevronRight } from "lucide-react";
import { format } from "date-fns";
import {
  BadgeIcon,
  BADGE_CATEGORY_STYLE,
  DEFAULT_BADGE_CATEGORY_STYLE,
  pickRecentBadges,
} from "@/lib/badges";

const SECTION_LABEL =
  "text-[11px] font-semibold uppercase tracking-wider text-muted-foreground mb-2.5";

/**
 * Compact "last few earned badges" strip, shown on the dashboard as the third
 * section of the Quest Activity card (beside the heatmap and hero portrait).
 */
export function RecentBadges() {
  const { data: userBadges, isLoading } = useGetMyBadges();

  if (isLoading) {
    return (
      <div className="min-w-0">
        <div className={SECTION_LABEL}>Recent Badges</div>
        <div className="flex gap-2.5">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="w-11 h-11 rounded-full bg-muted/30 animate-pulse" />
          ))}
        </div>
      </div>
    );
  }

  const recent = pickRecentBadges(userBadges, 3);

  if (recent.length === 0) {
    return (
      <div className="min-w-0">
        <div className={SECTION_LABEL}>Recent Badges</div>
        <div className="flex flex-col items-start gap-1">
          <div className="w-11 h-11 rounded-full flex items-center justify-center border border-border bg-muted/20 text-muted-foreground opacity-60 mb-1">
            <Award className="w-5 h-5" aria-hidden />
          </div>
          <p className="text-sm font-medium text-foreground leading-tight">No badges yet</p>
          <Link
            href="/tasks"
            className="inline-flex items-center gap-0.5 text-xs font-medium text-primary hover:underline"
          >
            Complete quests to earn your first <ChevronRight className="w-3 h-3" aria-hidden />
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-w-0">
      <div className={SECTION_LABEL}>Recent Badges</div>
      <div className="flex gap-2.5">
        {recent.map((ub) => {
          const style = BADGE_CATEGORY_STYLE[ub.badge.category] ?? DEFAULT_BADGE_CATEGORY_STYLE;
          const tip = `${ub.badge.name} — ${format(new Date(ub.earnedAt), "MMM d")}`;
          return (
            <div
              key={ub.badge.id}
              title={tip}
              aria-label={tip}
              className={`w-11 h-11 rounded-full flex items-center justify-center border ${style.bg} ${style.border} ${style.color}`}
            >
              <BadgeIcon icon={ub.badge.icon} className="w-5 h-5" />
            </div>
          );
        })}
      </div>
      <Link
        href="/progress"
        className="inline-flex items-center gap-0.5 text-xs font-medium text-primary hover:underline mt-3"
      >
        View all <ChevronRight className="w-3 h-3" aria-hidden />
      </Link>
    </div>
  );
}
