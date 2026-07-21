import { useRoute, Link } from "wouter";
import { useGetPartnerDetail } from "@workspace/api-client-react";
import { browserTimeZone } from "@/lib/timezone";
import { PixelHero } from "@/components/pixel-hero";
import { NudgePicker } from "@/components/nudge-picker";
import { Card, CardContent } from "@/components/ui/card";
import { ArrowLeft, Trophy } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { apiHeroToLook } from "@/lib/hero/from-api";

const MILESTONE_ICON: Record<string, string> = {
  level_up: "⭐", badge_earned: "🏅", streak_milestone: "🔥", all_day_bonus: "🎯",
};

export default function PartnerDetail() {
  const [, params] = useRoute("/partners/:id");
  const partnerId = params ? parseInt(params.id, 10) : NaN;
  const queryClient = useQueryClient();

  const { data, isLoading, error } = useGetPartnerDetail(
    partnerId,
    { tz: browserTimeZone() },
    { query: { enabled: Number.isInteger(partnerId), queryKey: ["partnerDetail", partnerId] } },
  );

  if (isLoading) {
    return <div className="text-center py-20 text-primary animate-pulse">Loading ally…</div>;
  }
  if (error || !data) {
    return (
      <div className="text-center py-20 space-y-4">
        <p className="text-muted-foreground">Couldn't load this ally.</p>
        <Link href="/partners" className="text-primary underline">Back to allies</Link>
      </div>
    );
  }

  const heroLook = apiHeroToLook(data.hero);

  const behind = data.progress.questsDueToday > 0 && !data.progress.allDoneToday;

  return (
    <div className="space-y-6 animate-in fade-in duration-500 max-w-3xl mx-auto">
      <Link href="/partners" className="inline-flex items-center gap-2 text-muted-foreground hover:text-foreground">
        <ArrowLeft className="w-4 h-4" /> Allies
      </Link>

      {/* Header: hero + identity + actions */}
      <Card className="bg-card border-border">
        <CardContent className="p-6 flex flex-col sm:flex-row items-center gap-6">
          <div className="shrink-0">
            {heroLook
              ? <PixelHero look={heroLook} size={140} />
              : <div className="w-[140px] h-[140px] rounded-xl bg-muted flex items-center justify-center text-4xl font-bold text-muted-foreground">
                  {data.partner.username.charAt(0).toUpperCase()}
                </div>}
          </div>
          <div className="flex-1 text-center sm:text-left">
            <h1 className="text-2xl font-bold">{data.partner.username}</h1>
            <p className="text-primary font-medium">Lv. {data.partner.currentLevel} • {data.partner.levelName}</p>
            <div className="mt-3 flex justify-center sm:justify-start gap-6 text-sm text-muted-foreground">
              <div><span className="font-bold text-foreground block">{data.partner.totalPoints}</span>XP</div>
              <div><span className="font-bold text-foreground block">{data.partner.streakDays}</span>Streak</div>
              <div>
                <span className="font-bold text-foreground block">
                  {data.progress.questsCompletedToday}/{data.progress.questsDueToday}
                </span>Today
              </div>
            </div>
            <div className="mt-4 flex justify-center sm:justify-start gap-2">
              <NudgePicker partnerId={partnerId} kind="poke" disabled={data.sentTodayPoke} emphasized={behind} onSent={() => queryClient.invalidateQueries({ queryKey: ["partnerDetail", partnerId] })} />
              <NudgePicker partnerId={partnerId} kind="cheer" disabled={data.sentTodayCheer} emphasized={data.milestones.length > 0} onSent={() => queryClient.invalidateQueries({ queryKey: ["partnerDetail", partnerId] })} />
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Badges */}
      <div>
        <h2 className="text-lg font-bold mb-3 flex items-center gap-2"><Trophy className="w-5 h-5 text-primary" /> Badges ({data.badges.length})</h2>
        {data.badges.length === 0 ? (
          <p className="text-muted-foreground text-sm">No badges earned yet.</p>
        ) : (
          <div className="grid grid-cols-3 sm:grid-cols-4 gap-3">
            {data.badges.map((ub) => (
              <div key={ub.badge.id} className="text-center p-3 bg-card border border-border rounded-xl">
                <div className="text-2xl mb-1">{ub.badge.icon}</div>
                <div className="text-xs font-semibold truncate">{ub.badge.name}</div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Recent milestones */}
      <div>
        <h2 className="text-lg font-bold mb-3">Recent milestones</h2>
        {data.milestones.length === 0 ? (
          <p className="text-muted-foreground text-sm">No milestones yet.</p>
        ) : (
          <div className="space-y-2">
            {data.milestones.map((m) => (
              <div key={m.id} className="flex items-center gap-3 p-3 bg-card border border-border rounded-lg">
                <span className="text-xl">{MILESTONE_ICON[m.type] ?? "✨"}</span>
                <span className="text-sm">{m.description}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
