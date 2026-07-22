// One quiet line of context under the momentum suggestion: which chapter you're
// on. Renders NOTHING when there is no running campaign, when campaigns are
// locked, or when every chapter is done — it never nags and never competes
// with the suggestion above it.
import { Link } from "wouter";
import { Map as MapIcon } from "lucide-react";
import {
  useGetMyStats, useGetCampaigns, useGetCampaign,
  getGetCampaignQueryKey, getGetCampaignsQueryKey,
} from "@workspace/api-client-react";
import { isUnlocked } from "@/lib/feature-gates";
import { browserTimeZone } from "@/lib/timezone";

export function CampaignNowLine() {
  const { data: stats } = useGetMyStats({ tz: browserTimeZone() });
  const unlocked = isUnlocked(stats?.unlockedFeatures, "campaigns");

  const { data: campaigns } = useGetCampaigns({
    // Reuse the generated key — a bespoke key would open a SECOND cache entry
    // for the same request and refetch the list twice on every Now render.
    query: { enabled: unlocked, queryKey: getGetCampaignsQueryKey() },
  });
  const running = (campaigns ?? []).find((c) => c.status === "running");

  // Chained query: only fires once a running campaign is known, so a user
  // with no campaigns (or campaigns locked) never issues this second request.
  const { data: detail } = useGetCampaign(running?.id ?? 0, {
    query: { enabled: unlocked && !!running, queryKey: getGetCampaignQueryKey(running?.id ?? 0) },
  });

  if (!unlocked || !running || !detail) return null;

  const index = detail.chapters.findIndex((c) => c.questlineId === detail.currentChapterId);
  if (index < 0) return null;
  const chapter = detail.chapters[index]!;

  return (
    <Link href={`/campaigns/${running.id}`}
      className="flex items-center gap-2 text-xs text-muted-foreground hover:text-foreground transition-colors">
      <MapIcon className="w-3.5 h-3.5 text-primary/70" aria-hidden />
      <span className="flex-1 min-w-0 truncate">
        Chapter {index + 1} of {detail.chapters.length} — {chapter.title}
      </span>
    </Link>
  );
}
