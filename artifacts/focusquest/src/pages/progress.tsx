import {
  useGetMe, useGetMyStats, useGetMyBadges, useGetMyXpHistory,
} from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Award, Flame, Trophy, Zap, Star, Rocket } from "lucide-react";
import { BadgeIcon, BADGE_CATEGORY_STYLE, DEFAULT_BADGE_CATEGORY_STYLE } from "@/lib/badges";
import { format } from "date-fns";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, Cell,
} from "recharts";

interface TooltipProps {
  active?: boolean;
  payload?: { value: number }[];
  label?: string;
}

function XpTooltip({ active, payload, label }: TooltipProps) {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-card border border-primary/30 rounded-lg px-3 py-2 shadow-lg">
      <p className="text-xs text-muted-foreground mb-0.5">{label}</p>
      <p className="text-sm font-bold text-primary">{payload[0].value} XP</p>
    </div>
  );
}

export default function Progress() {
  const { data: user, isLoading: userLoading } = useGetMe();
  const { data: stats, isLoading: statsLoading } = useGetMyStats();
  const { data: userBadges, isLoading: badgesLoading } = useGetMyBadges();
  const { data: xpHistory, isLoading: xpLoading } = useGetMyXpHistory({ days: 14 });

  if (userLoading || statsLoading || badgesLoading) {
    return (
      <div className="p-8 flex justify-center items-center h-64">
        <Zap className="w-8 h-8 text-primary animate-pulse" />
      </div>
    );
  }

  const todayXp = stats?.todayPoints ?? 0;
  const maxXp = xpHistory ? Math.max(...xpHistory.map((d) => d.xp), 1) : 1;

  // Group earned badges by category
  const earnedByCategory: Record<string, typeof userBadges> = {};
  userBadges?.forEach((ub) => {
    const cat = ub.badge.category;
    if (!earnedByCategory[cat]) earnedByCategory[cat] = [];
    earnedByCategory[cat]!.push(ub);
  });

  const categoryOrder = ["habit_streak", "streak", "tasks", "points", "level", "social"];

  return (
    <div className="space-y-8 animate-in fade-in duration-500">
      <div>
        <h1 className="text-3xl font-bold text-foreground">Commander Profile</h1>
        <p className="text-muted-foreground mt-1">Review your career stats and achievements.</p>
      </div>

      {/* Top row */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {/* Avatar card */}
        <Card className="md:col-span-1 bg-card border-primary/20 neon-glow relative overflow-hidden flex flex-col justify-center items-center p-8 text-center">
          <div className="w-24 h-24 rounded-full bg-primary/20 flex items-center justify-center border-2 border-primary shadow-[0_0_30px_rgba(0,255,255,0.2)] mb-6">
            <Trophy className="w-12 h-12 text-primary" />
          </div>
          <h2 className="text-3xl font-bold">{user?.username}</h2>
          <div className="text-primary font-bold tracking-widest uppercase mt-2">{user?.levelName}</div>
          <div className="mt-6 flex items-center gap-2 text-muted-foreground">
            <span className="font-bold text-foreground text-xl">Lv. {user?.currentLevel}</span>
            <span>•</span>
            <span>{user?.totalPoints} XP Total</span>
          </div>
        </Card>

        {/* Stats + chart */}
        <div className="md:col-span-2 grid grid-cols-2 gap-4">
          <Card className="bg-card border-border">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
                <Flame className="w-4 h-4 text-orange-400" /> Daily Streak
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-4xl font-bold text-foreground">{user?.streakDays}</div>
              <div className="text-sm text-muted-foreground mt-1">Best: {user?.longestStreak} days</div>
            </CardContent>
          </Card>

          <Card className="bg-card border-border">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
                <Award className="w-4 h-4 text-secondary" /> Badges Earned
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-4xl font-bold text-foreground">{userBadges?.length ?? 0}</div>
              <div className="text-sm text-muted-foreground mt-1">Keep collecting</div>
            </CardContent>
          </Card>

          {/* Real XP chart */}
          <Card className="bg-card border-border col-span-2">
            <CardHeader className="pb-2 flex flex-row items-center justify-between">
              <CardTitle className="text-sm font-medium text-muted-foreground">XP Earned — Last 14 Days</CardTitle>
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <span className="inline-block w-2 h-2 rounded-full bg-primary" />
                Today: <span className="text-primary font-bold">{todayXp} XP</span>
              </div>
            </CardHeader>
            <CardContent className="h-[200px] w-full pt-2">
              {xpLoading ? (
                <div className="h-full flex items-center justify-center">
                  <Zap className="w-6 h-6 text-primary animate-pulse" />
                </div>
              ) : (
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={xpHistory ?? []} barSize={20} margin={{ top: 4, right: 4, left: -20, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#2D3748" vertical={false} />
                    <XAxis
                      dataKey="label"
                      stroke="#A0AEC0"
                      fontSize={11}
                      tickLine={false}
                      axisLine={false}
                      interval={0}
                    />
                    <YAxis stroke="#A0AEC0" fontSize={11} tickLine={false} axisLine={false} />
                    <Tooltip content={<XpTooltip />} cursor={{ fill: "rgba(0,255,255,0.05)" }} />
                    <Bar dataKey="xp" radius={[4, 4, 0, 0]}>
                      {(xpHistory ?? []).map((entry) => (
                        <Cell
                          key={entry.date}
                          fill={entry.xp === 0 ? "#2D3748" : entry.xp >= maxXp * 0.8 ? "#00FFFF" : "rgba(0,255,255,0.5)"}
                        />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              )}
            </CardContent>
          </Card>
        </div>
      </div>

      {/* Badges section */}
      <div>
        <h2 className="text-2xl font-bold tracking-tight flex items-center gap-2 mb-6">
          <Award className="w-6 h-6 text-secondary" />
          Badges & Achievements
        </h2>

        {userBadges && userBadges.length > 0 ? (
          <div className="space-y-8">
            {categoryOrder.map((cat) => {
              const items = earnedByCategory[cat];
              if (!items || items.length === 0) return null;
              const style = BADGE_CATEGORY_STYLE[cat] ?? DEFAULT_BADGE_CATEGORY_STYLE;
              return (
                <div key={cat}>
                  <h3 className={`text-xs font-bold uppercase tracking-widest mb-3 flex items-center gap-2 ${style.color}`}>
                    <span className="inline-block w-2 h-2 rounded-full border" style={{ background: "currentColor", borderColor: "currentColor" }} />
                    {style.label}
                    <span className="text-muted-foreground font-normal normal-case tracking-normal">
                      ({items.length})
                    </span>
                  </h3>
                  <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
                    {items.map((ub) => (
                      <Card
                        key={ub.badge.id}
                        className={`${style.bg} ${style.border} border flex flex-col items-center p-4 text-center hover:brightness-110 transition-all duration-200`}
                      >
                        <div className={`w-16 h-16 rounded-full ${style.bg} flex items-center justify-center mb-3 border ${style.border}`}>
                          <span className={style.color}>
                            <BadgeIcon icon={ub.badge.icon} className="w-8 h-8" />
                          </span>
                        </div>
                        <h3 className="font-bold text-sm text-foreground leading-tight">{ub.badge.name}</h3>
                        <p className="text-xs text-muted-foreground mt-1 leading-snug">{ub.badge.description}</p>
                        <p className={`text-[10px] mt-3 uppercase tracking-wider font-bold ${style.color}`}>
                          {format(new Date(ub.earnedAt), "MMM d, yyyy")}
                        </p>
                      </Card>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="text-center py-16 border-2 border-dashed border-muted rounded-xl">
            <Award className="w-12 h-12 text-muted-foreground mx-auto mb-4 opacity-50" />
            <h3 className="text-lg font-medium text-foreground">No badges yet</h3>
            <p className="text-muted-foreground mt-1">Complete quests to unlock achievements.</p>
          </div>
        )}

        {/* Habit streak milestone preview — always shown */}
        <div className="mt-8">
          <h3 className="text-xs font-bold uppercase tracking-widest mb-3 flex items-center gap-2 text-muted-foreground">
            <span className="inline-block w-2 h-2 rounded-full bg-muted border border-muted-foreground/30" />
            Habit Streak Milestones
            <span className="font-normal normal-case tracking-normal">(complete recurring quests to unlock)</span>
          </h3>
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-4">
            {[
              { name: "Warming Up",        req: 3,  icon: <Flame className="w-8 h-8" />,  desc: "3-day habit streak" },
              { name: "On Fire",           req: 7,  icon: <Flame className="w-8 h-8" />,  desc: "7-day habit streak" },
              { name: "Habit Forming",     req: 14, icon: <Zap className="w-8 h-8" />,    desc: "14-day habit streak" },
              { name: "Habit Formed",      req: 21, icon: <Star className="w-8 h-8" />,   desc: "21-day habit streak" },
              { name: "Unstoppable Habit", req: 30, icon: <Rocket className="w-8 h-8" />, desc: "30-day habit streak" },
            ].map((m) => {
              const earned = userBadges?.some(
                (ub) => ub.badge.name === m.name && ub.badge.category === "habit_streak",
              );
              return (
                <div
                  key={m.name}
                  className={`border rounded-xl flex flex-col items-center p-4 text-center transition-all duration-200 ${
                    earned
                      ? "bg-amber-400/10 border-amber-500/40 shadow-[0_0_12px_rgba(251,191,36,0.15)]"
                      : "bg-muted/10 border-border opacity-50"
                  }`}
                >
                  <div
                    className={`w-14 h-14 rounded-full flex items-center justify-center mb-3 border ${
                      earned
                        ? "bg-amber-400/20 border-amber-500/40 text-amber-400"
                        : "bg-muted/20 border-border text-muted-foreground"
                    }`}
                  >
                    {m.icon}
                  </div>
                  <h3 className={`font-bold text-sm leading-tight ${earned ? "text-foreground" : "text-muted-foreground"}`}>
                    {m.name}
                  </h3>
                  <p className="text-xs text-muted-foreground mt-1">{m.desc}</p>
                  <p className={`text-[10px] mt-2 font-bold ${earned ? "text-amber-400 uppercase tracking-wider" : "text-muted-foreground"}`}>
                    {earned ? "Earned!" : `${m.req}-day streak`}
                  </p>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
