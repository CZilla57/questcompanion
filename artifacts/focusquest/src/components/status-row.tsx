// One quiet line where four stat cards used to be. Tap-through to /progress.
import { Link } from "wouter";
import { Flame } from "lucide-react";
import { statusRowParts, type StatusRowStats } from "@/lib/status-row";

export function StatusRow({ stats }: { stats: StatusRowStats }) {
  const parts = statusRowParts(stats);
  return (
    <Link href="/progress"
      className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors"
      aria-label="Open progress">
      {stats.streakDays > 0 && <Flame className="w-4 h-4 text-orange-400" aria-hidden />}
      <span>{parts.join(" · ")}</span>
    </Link>
  );
}
