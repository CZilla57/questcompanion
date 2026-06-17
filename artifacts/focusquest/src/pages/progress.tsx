import { useGetMe, useGetMyStats, useGetMyBadges } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Award, Flame, Trophy, Zap, CheckCircle2, Star, Target,
  Rocket, TrendingUp, Shield, Users, Medal, Calendar, Crown,
} from "lucide-react";
import { format } from "date-fns";
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer,
} from "recharts";

const ICON_MAP: Record<string, React.ReactNode> = {
  CheckCircle: <CheckCircle2 className="w-8 h-8" />,
  Zap:         <Zap className="w-8 h-8" />,
  Trophy:      <Trophy className="w-8 h-8" />,
  Medal:       <Medal className="w-8 h-8" />,
  Flame:       <Flame className="w-8 h-8" />,
  Star:        <Star className="w-8 h-8" />,
  Crown:       <Crown className="w-8 h-8" />,
  Calendar:    <Calendar className="w-8 h-8" />,
  Target:      <Target className="w-8 h-8" />,
  Rocket:      <Rocket className="w-8 h-8" />,
  TrendingUp:  <TrendingUp className="w-8 h-8" />,
  Shield:      <Shield className="w-8 h-8" />,
  Users:       <Users className="w-8 h-8" />,
  Award:       <Award className="w-8 h-8" />,
};

const CATEGORY_STYLE: Record<string, { label: string; color: string; bg: string; border: string }> = {
  tasks:        { label: "Task Mastery",    color: "text-primary",   bg: "bg-primary/10",   border: "border-primary/30" },
  points:       { label: "XP Milestones",   color: "text-yellow-400",bg: "bg-yellow-400/10",border: "border-yellow-400/30" },
  streak:       { label: "Daily Streaks",   color: "text-orange-400",bg: "bg-orange-400/10",border: "border-orange-400/30" },
  level:        { label: "Rank Ups",        color: "text-purple-400",bg: "bg-purple-400/10",border: "border-purple-400/30" },
  social:       { label: "Social",          color: "text-green-400", bg: "bg-green-400/10", border: "border-green-400/30" },
  habit_streak: { label: "Habit Streaks",   color: "text-amber-400", bg: "bg-amber-400/10", border: "border-amber-500/40" },
};

const generateWeeklyData = () => {
  const data = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    data.push({ name: format(d, "EEE"), xp: Math.floor(Math.random() * 500) + 100 });
  }
  return data;
};

export default function Progress() {
  const { data: user, isLoading: userLoading } = useGetMe();
  const { data: stats, isLoading: statsLoading } = useGetMyStats();
  const { data: userBadges, isLoading: badgesLoading } = useGetMyBadges();

  if (userLoading || statsLoading || badgesLoading) {
    return (
      <div className="p-8 flex justify-center items-center h-64">
        <Zap className="w-8 h-8 text-primary animate-pulse" />
      </div>
    );
  }

  const chartData = generateWeeklyData();
  if (stats) chartData[6].xp = stats.todayPoints;

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

          <Card className="bg-card border-border col-span-2">
            <CardHeader className="pb-4">
              <CardTitle className="text-sm font-medium text-muted-foreground">Weekly XP Gain</CardTitle>
            </CardHeader>
            <CardContent className="h-[200px] w-full">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={chartData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#2D3748" vertical={false} />
                  <XAxis dataKey="name" stroke="#A0AEC0" fontSize={12} tickLine={false} axisLine={false} />
                  <YAxis stroke="#A0AEC0" fontSize={12} tickLine={false} axisLine={false} />
                  <Tooltip
                    contentStyle={{ backgroundColor: "#1A202C", border: "1px solid #00FFFF", borderRadius: "8px" }}
                    itemStyle={{ color: "#00FFFF" }}
                  />
                  <Line
                    type="monotone"
                    dataKey="xp"
                    stroke="#00FFFF"
                    strokeWidth={3}
                    dot={{ fill: "#00FFFF", r: 4 }}
                    activeDot={{ r: 6, fill: "#00FFFF", stroke: "#1A202C", strokeWidth: 2 }}
                  />
                </LineChart>
              </ResponsiveContainer>
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
              const style = CATEGORY_STYLE[cat] ?? CATEGORY_STYLE["tasks"];
              return (
                <div key={cat}>
                  <h3 className={`text-xs font-bold uppercase tracking-widest mb-3 flex items-center gap-2 ${style.color}`}>
                    <span className={`inline-block w-2 h-2 rounded-full ${style.bg.replace("/10", "")} border ${style.border}`} />
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
                        <div className={`w-16 h-16 rounded-full ${style.bg} flex items-center justify-center mb-3 border ${style.border} shadow-sm`}>
                          <span className={style.color}>
                            {ICON_MAP[ub.badge.icon] ?? <Award className="w-8 h-8" />}
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

        {/* Locked habit streak badges preview */}
        <div className="mt-8">
          <h3 className="text-xs font-bold uppercase tracking-widest mb-3 flex items-center gap-2 text-muted-foreground">
            <span className="inline-block w-2 h-2 rounded-full bg-muted border border-muted-foreground/30" />
            Habit Streak Milestones
            <span className="font-normal normal-case tracking-normal">(complete recurring quests to unlock)</span>
          </h3>
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-4">
            {[
              { name: "Warming Up",        req: 3,  icon: <Flame className="w-8 h-8" />,   desc: "3-day habit streak" },
              { name: "On Fire",           req: 7,  icon: <Flame className="w-8 h-8" />,   desc: "7-day habit streak" },
              { name: "Habit Forming",     req: 14, icon: <Zap className="w-8 h-8" />,     desc: "14-day habit streak" },
              { name: "Habit Formed",      req: 21, icon: <Star className="w-8 h-8" />,    desc: "21-day habit streak" },
              { name: "Unstoppable Habit", req: 30, icon: <Rocket className="w-8 h-8" />,  desc: "30-day habit streak" },
            ].map((m) => {
              const earned = userBadges?.some((ub) => ub.badge.name === m.name && ub.badge.category === "habit_streak");
              return (
                <div
                  key={m.name}
                  className={`border rounded-xl flex flex-col items-center p-4 text-center transition-all duration-200
                    ${earned
                      ? "bg-amber-400/10 border-amber-500/40 shadow-[0_0_12px_rgba(251,191,36,0.15)]"
                      : "bg-muted/10 border-border opacity-50"
                    }`}
                >
                  <div className={`w-14 h-14 rounded-full flex items-center justify-center mb-3 border
                    ${earned ? "bg-amber-400/20 border-amber-500/40 text-amber-400" : "bg-muted/20 border-border text-muted-foreground"}`}>
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
