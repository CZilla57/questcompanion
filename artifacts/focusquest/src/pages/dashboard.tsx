import { useState } from "react";
import { format, differenceInDays, parseISO } from "date-fns";
import { ActivityItem, useGetMyStats, useGetTasks, useBuyStreakFreeze } from "@workspace/api-client-react";
import { TaskItem } from "@/components/task-item";
import { Progress } from "@/components/ui/progress";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Flame, Trophy, Target, Award, Zap, Check, Shield, ShieldCheck, ShieldOff, AlertTriangle, X, TrendingDown } from "lucide-react";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useQueryClient } from "@tanstack/react-query";
import { getGetMyStatsQueryKey } from "@workspace/api-client-react";
import { useToast } from "@/hooks/use-toast";

const FREEZE_COST = 50;

export default function Dashboard() {
  const { data: stats, isLoading: statsLoading } = useGetMyStats();
  const { data: tasks, isLoading: tasksLoading } = useGetTasks({
    date: format(new Date(), 'yyyy-MM-dd')
  });

  const [levelUpData, setLevelUpData] = useState<any | null>(null);
  const [decayDismissed, setDecayDismissed] = useState(false);
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const buyFreezeMutation = useBuyStreakFreeze();

  const pendingTasks = tasks?.filter(t => !t.completed) || [];
  const completedTasks = tasks?.filter(t => t.completed) || [];

  const handleBuyFreeze = () => {
    buyFreezeMutation.mutate(undefined, {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getGetMyStatsQueryKey() });
        toast({
          title: "Streak Shield Activated! 🛡️",
          description: `Spent ${FREEZE_COST} XP. Your next missed day won't break your streak.`,
          className: "border-cyan-500/50 bg-cyan-500/10",
        });
      },
      onError: (err: any) => {
        toast({
          title: "Can't buy freeze",
          description: err?.response?.data?.error ?? "Something went wrong.",
          variant: "destructive",
        });
      },
    });
  };

  if (statsLoading || tasksLoading) {
    return <div className="p-8 flex justify-center items-center h-64"><Zap className="w-8 h-8 text-primary animate-pulse" /></div>;
  }

  if (!stats) return null;

  const progressPercent = stats.pointsToNextLevel > 0
    ? ((stats.totalPoints % 1000) / 1000) * 100
    : 100;

  const hasFreeze = stats.streakFreezes > 0;
  const canAfford = stats.totalPoints >= FREEZE_COST;

  // XP decay warning: show if no activity for 3+ days
  const lastActivityIso = stats.recentActivity[0]?.createdAt ?? null;
  const daysSinceActive = lastActivityIso
    ? differenceInDays(new Date(), parseISO(lastActivityIso))
    : 999;
  const showDecayWarning = !decayDismissed && daysSinceActive >= 3;

  return (
    <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">

      {/* Top Stats Row */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card className="bg-card border-primary/20 neon-glow relative overflow-hidden">
          <div className="absolute top-0 right-0 p-4 opacity-10">
            <Trophy className="w-16 h-16" />
          </div>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground uppercase tracking-wider">Current Level</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold text-foreground">Lv. {stats.currentLevel}</div>
            <div className="text-sm text-primary font-medium mt-1">{stats.levelName}</div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground uppercase tracking-wider">Today's XP</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold text-foreground">{stats.todayPoints}</div>
            <div className="text-sm text-muted-foreground mt-1">Total: {stats.totalPoints}</div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground uppercase tracking-wider">Daily Quests</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold text-foreground">{stats.todayTasksCompleted} / {stats.todayTasksTotal}</div>
            <div className="text-sm text-muted-foreground mt-1">
              {stats.allDayBonusEarned ? <span className="text-secondary font-bold">Bonus Active!</span> : "Complete all for bonus"}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground uppercase tracking-wider">Active Streak</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold text-foreground flex items-center gap-2">
              <Flame className="w-6 h-6 text-accent" />
              {stats.streakDays}
            </div>
            <div className="text-sm text-muted-foreground mt-1">Days in a row</div>
          </CardContent>
        </Card>
      </div>

      {/* Progress Bar */}
      <Card className="border-primary/20">
        <CardContent className="pt-6">
          <div className="flex justify-between items-end mb-2">
            <div>
              <div className="text-sm font-medium text-muted-foreground uppercase tracking-wider">Next Level</div>
              <div className="font-bold text-primary">{stats.pointsToNextLevel} XP remaining</div>
            </div>
            <div className="text-right">
              <div className="text-2xl font-bold text-foreground">{Math.round(progressPercent)}%</div>
            </div>
          </div>
          <Progress value={progressPercent} className="h-4 bg-muted" />
        </CardContent>
      </Card>

      {/* XP Decay Warning */}
      {showDecayWarning && (
        <div className="relative flex items-start gap-4 p-4 rounded-xl border border-amber-500/40 bg-amber-500/8 shadow-[0_0_20px_rgba(251,191,36,0.08)] animate-in fade-in slide-in-from-top-2 duration-300">
          <div className="flex-shrink-0 p-2 rounded-lg bg-amber-500/15 border border-amber-500/30 mt-0.5">
            <TrendingDown className="w-5 h-5 text-amber-400" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1">
              <AlertTriangle className="w-4 h-4 text-amber-400" />
              <span className="text-sm font-bold uppercase tracking-wider text-amber-400">XP Ranking Sliding</span>
            </div>
            <p className="text-sm text-muted-foreground">
              {daysSinceActive >= 999
                ? "No quests completed yet — your weekly XP ranking hasn't started. Complete your first quest to get on the board."
                : `You've been away for ${daysSinceActive} day${daysSinceActive === 1 ? "" : "s"}. Weekly XP rankings reset every Monday — every quest you skip lets others pull ahead.`
              }
            </p>
            <Button asChild size="sm" className="mt-3 bg-amber-500/20 border border-amber-500/40 text-amber-300 hover:bg-amber-500/30 hover:text-amber-200 h-8 px-4">
              <Link href="/tasks">Get Back on Track →</Link>
            </Button>
          </div>
          <button
            onClick={() => setDecayDismissed(true)}
            className="flex-shrink-0 p-1 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors"
            aria-label="Dismiss"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Streak Shield */}
      <Card className={`border transition-all duration-300 ${hasFreeze ? "border-cyan-500/40 bg-cyan-500/5 shadow-[0_0_20px_rgba(0,255,255,0.08)]" : "border-border"}`}>
        <CardContent className="pt-5 pb-5">
          <div className="flex items-center justify-between gap-4 flex-wrap">
            <div className="flex items-center gap-4">
              <div className={`p-2.5 rounded-xl border ${hasFreeze ? "bg-cyan-500/15 border-cyan-500/40 shadow-[0_0_12px_rgba(0,255,255,0.25)]" : "bg-muted/40 border-border"}`}>
                {hasFreeze
                  ? <ShieldCheck className="w-6 h-6 text-cyan-400" />
                  : <ShieldOff className="w-6 h-6 text-muted-foreground" />
                }
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <span className="text-sm font-bold uppercase tracking-wider text-muted-foreground">Streak Shield</span>
                  {hasFreeze && (
                    <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-cyan-500/20 border border-cyan-500/30 text-cyan-400 uppercase tracking-wider">
                      Ready
                    </span>
                  )}
                </div>
                <p className="text-sm mt-0.5">
                  {hasFreeze
                    ? <span className="text-cyan-400 font-semibold">1 freeze held — auto-activates if you miss a day</span>
                    : <span className="text-muted-foreground">Protects your streak from a missed day. Auto-activates when needed.</span>
                  }
                </p>
              </div>
            </div>

            <Button
              onClick={handleBuyFreeze}
              disabled={hasFreeze || !canAfford || buyFreezeMutation.isPending}
              variant={hasFreeze ? "ghost" : "outline"}
              className={
                hasFreeze
                  ? "text-muted-foreground cursor-default"
                  : canAfford
                    ? "border-cyan-500/50 text-cyan-400 hover:bg-cyan-500/10 hover:border-cyan-500"
                    : "border-muted text-muted-foreground"
              }
            >
              {hasFreeze
                ? <><ShieldCheck className="w-4 h-4 mr-2" /> Shield Active</>
                : !canAfford
                  ? <><Shield className="w-4 h-4 mr-2" /> Need {FREEZE_COST} XP</>
                  : <><Shield className="w-4 h-4 mr-2" /> Buy for {FREEZE_COST} XP</>
              }
            </Button>
          </div>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        {/* Tasks List */}
        <div className="lg:col-span-2 space-y-6">
          <div className="flex items-center justify-between">
            <h2 className="text-2xl font-bold tracking-tight flex items-center gap-2">
              <Target className="w-6 h-6 text-primary" />
              Today's Quests
            </h2>
            <Button asChild variant="outline" className="border-primary/50 text-primary hover:bg-primary/20">
              <Link href="/tasks">View All</Link>
            </Button>
          </div>

          <div className="space-y-4">
            {pendingTasks.length === 0 && completedTasks.length === 0 && (
              <div className="text-center py-12 border-2 border-dashed border-muted rounded-xl">
                <Target className="w-12 h-12 text-muted-foreground mx-auto mb-4 opacity-50" />
                <h3 className="text-lg font-medium text-foreground">No quests active today</h3>
                <p className="text-muted-foreground mt-1 mb-4">Ready to start grinding?</p>
                <Button asChild>
                  <Link href="/tasks">Add a Quest</Link>
                </Button>
              </div>
            )}

            {pendingTasks.map(task => (
              <TaskItem key={task.id} task={task} onLevelUp={setLevelUpData} />
            ))}

            {completedTasks.length > 0 && (
              <>
                <h3 className="text-sm font-bold uppercase tracking-wider text-muted-foreground mt-8 mb-4 flex items-center gap-2">
                  <Check className="w-4 h-4" /> Completed
                </h3>
                <div className="opacity-75 space-y-4">
                  {completedTasks.map(task => (
                    <TaskItem key={task.id} task={task} />
                  ))}
                </div>
              </>
            )}
          </div>
        </div>

        {/* Activity Feed */}
        <div className="space-y-6">
          <h2 className="text-2xl font-bold tracking-tight">Activity Log</h2>
          <Card>
            <CardContent className="p-0">
              <div className="divide-y divide-border">
                {stats.recentActivity.slice(0, 8).map((activity: ActivityItem) => (
                  <div key={activity.id} className="p-4 flex gap-4 hover:bg-muted/30 transition-colors">
                    <div className="mt-1 flex-shrink-0">
                      {activity.type === 'task_completed' && <Check className="w-5 h-5 text-green-500" />}
                      {activity.type === 'badge_earned' && <Award className="w-5 h-5 text-secondary" />}
                      {activity.type === 'level_up' && <Trophy className="w-5 h-5 text-primary" />}
                      {activity.type === 'streak_milestone' && <Flame className="w-5 h-5 text-accent" />}
                      {activity.type === 'all_day_bonus' && <Zap className="w-5 h-5 text-yellow-500" />}
                      {activity.type === 'streak_freeze_bought' && <Shield className="w-5 h-5 text-cyan-400" />}
                      {activity.type === 'streak_freeze_used' && <ShieldCheck className="w-5 h-5 text-cyan-400" />}
                    </div>
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-foreground">{activity.description}</p>
                      <p className="text-xs text-muted-foreground mt-1">
                        {format(new Date(activity.createdAt), 'MMM d, h:mm a')}
                        {activity.points !== 0 && (
                          <span className={`font-bold ml-2 ${activity.points < 0 ? "text-red-400" : "text-primary"}`}>
                            {activity.points > 0 ? "+" : ""}{activity.points} XP
                          </span>
                        )}
                      </p>
                    </div>
                  </div>
                ))}
                {stats.recentActivity.length === 0 && (
                  <div className="p-8 text-center text-muted-foreground">
                    No recent activity. Start completing quests!
                  </div>
                )}
              </div>
            </CardContent>
          </Card>
        </div>
      </div>

      <Dialog open={!!levelUpData} onOpenChange={() => setLevelUpData(null)}>
        <DialogContent className="sm:max-w-md bg-card border-primary neon-glow text-center">
          <DialogHeader>
            <DialogTitle className="text-2xl font-bold text-primary uppercase tracking-wider text-center">
              Level Up!
            </DialogTitle>
          </DialogHeader>
          <div className="py-8 animate-level-up">
            <Trophy className="w-24 h-24 text-primary mx-auto mb-6 drop-shadow-[0_0_15px_rgba(0,255,255,0.8)]" />
            <h3 className="text-3xl font-bold text-foreground mb-2">You reached Level {levelUpData?.newLevel}!</h3>
            <p className="text-muted-foreground">Keep the momentum going.</p>

            {levelUpData?.newBadges?.length > 0 && (
              <div className="mt-8">
                <h4 className="text-sm font-bold uppercase text-secondary mb-4">Badges Unlocked</h4>
                <div className="flex justify-center gap-4">
                  {levelUpData.newBadges.map((b: any) => (
                    <div key={b.id} className="p-3 bg-secondary/20 border border-secondary/50 rounded-lg">
                      <Award className="w-8 h-8 text-secondary mx-auto mb-2" />
                      <div className="text-xs font-bold">{b.name}</div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
          <Button onClick={() => setLevelUpData(null)} className="w-full bg-primary hover:bg-primary/80 text-background font-bold text-lg h-12">
            Continue Quest
          </Button>
        </DialogContent>
      </Dialog>
    </div>
  );
}
