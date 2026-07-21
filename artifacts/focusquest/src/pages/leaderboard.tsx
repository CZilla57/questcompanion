import { useState } from "react";
import { useGetLeaderboard, useGetMe, useGetMyWeek, GetLeaderboardPeriod, type MyWeekMetric } from "@workspace/api-client-react";
import { Trophy, Medal, Star, Zap, Swords, Timer, Sparkles } from "lucide-react";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { PageTabs } from "@/components/page-tabs";
import { paceDelta, isFreshStart } from "@/lib/my-week";

function RankIcon({ rank }: { rank: number }) {
  if (rank === 1) return <Trophy className="w-5 h-5 text-yellow-400 drop-shadow-[0_0_8px_rgba(250,204,21,0.8)]" />;
  if (rank === 2) return <Medal className="w-5 h-5 text-slate-300 drop-shadow-[0_0_8px_rgba(209,213,219,0.8)]" />;
  if (rank === 3) return <Medal className="w-5 h-5 text-amber-600 drop-shadow-[0_0_8px_rgba(217,119,6,0.8)]" />;
  return <span className="font-bold text-muted-foreground tabular-nums">{rank}</span>;
}

function SkeletonRow() {
  return (
    <div className="grid grid-cols-12 gap-4 p-4 items-center animate-pulse">
      <div className="col-span-2 flex justify-center">
        <div className="w-6 h-6 rounded-full bg-muted" />
      </div>
      <div className="col-span-6 flex items-center gap-3">
        <div className="w-8 h-8 rounded-full bg-muted" />
        <div className="space-y-1.5">
          <div className="h-3 w-24 bg-muted rounded" />
          <div className="h-2.5 w-12 bg-muted rounded" />
        </div>
      </div>
      <div className="col-span-4 flex flex-col items-end gap-1.5">
        <div className="h-3 w-16 bg-muted rounded" />
        <div className="h-2.5 w-12 bg-muted rounded" />
      </div>
    </div>
  );
}

function MetricCard({ icon, label, metric }: { icon: React.ReactNode; label: string; metric: MyWeekMetric }) {
  const delta = paceDelta(metric);
  return (
    <div className="bg-card border border-border rounded-xl p-5 shadow-lg space-y-3">
      <div className="flex items-center gap-2 text-sm font-semibold text-muted-foreground">
        {icon}
        {label}
      </div>
      <div className="flex items-end gap-2 flex-wrap">
        <span className="text-4xl font-bold tabular-nums leading-none">{metric.current.toLocaleString()}</span>
        {delta !== null && (
          <span className="text-[11px] bg-primary/15 text-primary border border-primary/30 px-2 py-0.5 rounded-full font-bold flex items-center gap-1">
            <Sparkles className="w-3 h-3" />
            +{delta.toLocaleString()} ahead of last week&rsquo;s pace
          </span>
        )}
      </div>
      <div className="text-xs text-muted-foreground space-y-0.5">
        <div>By this time last week: <span className="tabular-nums font-semibold">{metric.samePointLastWeek.toLocaleString()}</span></div>
        <div>Last week total: <span className="tabular-nums font-semibold">{metric.lastWeekTotal.toLocaleString()}</span></div>
      </div>
    </div>
  );
}

function MyWeekPanel() {
  const { data: week, isLoading } = useGetMyWeek();

  if (isLoading || !week) {
    return (
      <div className="grid gap-4 sm:grid-cols-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="bg-card border border-border rounded-xl p-5 h-36 animate-pulse" />
        ))}
      </div>
    );
  }

  if (isFreshStart(week)) {
    return (
      <div className="bg-card border border-border rounded-xl py-16 px-6 text-center space-y-3 shadow-lg">
        <Sparkles className="w-8 h-8 text-primary mx-auto" />
        <p className="font-semibold text-foreground">Fresh start</p>
        <p className="text-sm text-muted-foreground">
          This page fills in as you quest — next week it becomes your favorite rivalry.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-3">
        <MetricCard icon={<Swords className="w-4 h-4" />} label="Quests cleared" metric={week.quests} />
        <MetricCard icon={<Star className="w-4 h-4" />} label="XP earned" metric={week.xp} />
        <MetricCard icon={<Timer className="w-4 h-4" />} label="Focus minutes" metric={week.focusMinutes} />
      </div>
      <p className="text-xs text-muted-foreground text-center">
        Weeks start Monday in your timezone. Pace compares the same stretch of each week.
      </p>
    </div>
  );
}

function EveryonePanel() {
  const [period, setPeriod] = useState<GetLeaderboardPeriod>(GetLeaderboardPeriod.weekly);
  const { data: leaderboard, isLoading } = useGetLeaderboard({ period });
  const { data: me } = useGetMe();

  const isEmpty = !isLoading && leaderboard?.length === 0;

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Tabs value={period} onValueChange={(v) => setPeriod(v as GetLeaderboardPeriod)}>
          <TabsList className="bg-card border border-border">
            <TabsTrigger
              value={GetLeaderboardPeriod.weekly}
              className="data-[state=active]:bg-primary/20 data-[state=active]:text-primary"
            >
              This Week
            </TabsTrigger>
            <TabsTrigger
              value={GetLeaderboardPeriod.alltime}
              className="data-[state=active]:bg-primary/20 data-[state=active]:text-primary"
            >
              All Time
            </TabsTrigger>
          </TabsList>
        </Tabs>
      </div>

      <div className="bg-card border border-border rounded-xl overflow-hidden shadow-lg">
        {/* Header row */}
        <div className="grid grid-cols-12 gap-4 px-4 py-3 bg-muted/40 text-[11px] font-bold text-muted-foreground uppercase tracking-wider border-b border-border">
          <div className="col-span-2 text-center">Rank</div>
          <div className="col-span-6">Commander</div>
          <div className="col-span-4 text-right">Score</div>
        </div>

        <div className="divide-y divide-border">
          {isLoading ? (
            Array.from({ length: 5 }).map((_, i) => <SkeletonRow key={i} />)
          ) : isEmpty ? (
            <div className="py-20 flex flex-col items-center gap-4 text-center px-6">
              <div className="w-16 h-16 rounded-full bg-muted/40 flex items-center justify-center border border-border">
                <Trophy className="w-8 h-8 text-muted-foreground opacity-40" />
              </div>
              <div>
                <p className="font-semibold text-foreground">No one&rsquo;s on the board yet</p>
                <p className="text-sm text-muted-foreground mt-1">Complete quests to claim the top spot.</p>
              </div>
            </div>
          ) : (
            leaderboard?.map((entry) => {
              const isMe = me != null && entry.user.id === me.id;
              return (
                <div
                  key={entry.user.id}
                  className={`
                    grid grid-cols-12 gap-4 px-4 py-3.5 items-center transition-colors
                    hover:bg-muted/30
                    ${isMe ? "bg-primary/5 border-l-2 border-primary" : ""}
                  `}
                  aria-current={isMe ? "true" : undefined}
                >
                  {/* Rank */}
                  <div className="col-span-2 flex justify-center">
                    <RankIcon rank={entry.rank} />
                  </div>

                  {/* Commander */}
                  <div className="col-span-6 flex items-center gap-3 min-w-0">
                    <div
                      className="w-9 h-9 rounded-full flex items-center justify-center font-bold text-sm border-2 border-border bg-muted text-foreground flex-shrink-0"
                      style={
                        entry.user.avatarColor
                          ? {
                              borderColor: entry.user.avatarColor,
                              backgroundColor: `${entry.user.avatarColor}22`,
                              boxShadow: `0 0 6px ${entry.user.avatarColor}55`,
                            }
                          : undefined
                      }
                    >
                      {entry.user.username.charAt(0).toUpperCase()}
                    </div>
                    <div className="min-w-0">
                      <div className="font-bold flex items-center gap-2 flex-wrap">
                        <span className="truncate">{entry.user.username}</span>
                        {isMe && (
                          <span className="text-[10px] bg-primary text-background px-1.5 py-0.5 rounded uppercase font-bold tracking-wider flex-shrink-0">
                            You
                          </span>
                        )}
                      </div>
                      <div className="text-xs text-muted-foreground">Lv. {entry.user.currentLevel} · {entry.user.levelName}</div>
                    </div>
                  </div>

                  {/* Score */}
                  <div className="col-span-4 text-right">
                    <div className={`font-bold flex items-center justify-end gap-1 ${isMe ? "text-primary" : "text-foreground"}`}>
                      <Star className="w-3.5 h-3.5 fill-current flex-shrink-0" />
                      <span className="tabular-nums">{entry.points.toLocaleString()}</span>
                    </div>
                    <div className="text-xs text-muted-foreground mt-0.5">
                      {entry.tasksCompleted} quests
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>

      {/* Footer hint when there are entries */}
      {!isLoading && !isEmpty && (
        <p className="text-xs text-muted-foreground text-center flex items-center justify-center gap-1.5">
          <Zap className="w-3 h-3" />
          Weekly XP resets every Monday. Complete quests to climb the ranks.
        </p>
      )}
    </div>
  );
}

type FellowshipView = "myweek" | "everyone";

export default function Leaderboard() {
  // "You vs. last week" is the default: at any population it's a full room (Act VII q6).
  const [view, setView] = useState<FellowshipView>("myweek");

  return (
    <div className="space-y-8 animate-in fade-in duration-500">
      <PageTabs group="allies" />
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h1 className="text-3xl font-bold text-foreground flex items-center gap-3">
            <Trophy className="w-7 h-7 text-primary" />
            Fellowship
          </h1>
          <p className="text-muted-foreground mt-1">You vs. last week — the only match that matters.</p>
        </div>

        <Tabs value={view} onValueChange={(v) => setView(v as FellowshipView)}>
          <TabsList className="bg-card border border-border">
            <TabsTrigger
              value="myweek"
              className="data-[state=active]:bg-primary/20 data-[state=active]:text-primary"
            >
              My Week
            </TabsTrigger>
            <TabsTrigger
              value="everyone"
              className="data-[state=active]:bg-primary/20 data-[state=active]:text-primary"
            >
              Everyone
            </TabsTrigger>
          </TabsList>
        </Tabs>
      </div>

      {view === "myweek" ? <MyWeekPanel /> : <EveryonePanel />}
    </div>
  );
}
