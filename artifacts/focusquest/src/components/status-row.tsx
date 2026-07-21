// One quiet line where four stat cards used to be. Tap-through to /progress —
// unless Progress hasn't been unlocked yet, in which case it's plain text
// (no dead link, no tease).
import { Link } from "wouter";
import { Flame } from "lucide-react";
import { statusRowParts, type StatusRowStats } from "@/lib/status-row";

export function StatusRow({ stats, linkToProgress = true }: { stats: StatusRowStats; linkToProgress?: boolean }) {
  const parts = statusRowParts(stats);
  const inner = (
    <>
      {stats.streakDays > 0 && <Flame className="w-4 h-4 text-orange-400" aria-hidden />}
      <span>{parts.join(" · ")}</span>
    </>
  );
  const cls = "flex items-center gap-2 text-sm text-muted-foreground";
  if (!linkToProgress) return <div className={cls}>{inner}</div>;
  return (
    <Link href="/progress" className={`${cls} hover:text-foreground transition-colors`} aria-label="Open progress">
      {inner}
    </Link>
  );
}
