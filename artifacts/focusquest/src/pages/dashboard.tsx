import { useState } from "react";
import { format, differenceInDays, parseISO } from "date-fns";
import { ActivityItem, Task, TaskPriority, useGetMyStats, useGetTasks, useBuyStreakFreeze, useUpdateTask } from "@workspace/api-client-react";
import { TaskItem } from "@/components/task-item";
import { ActivityHeatmap } from "@/components/activity-heatmap";
import { HeroSummary } from "@/components/hero-summary";
import { RecentBadges } from "@/components/recent-badges";
import { Progress } from "@/components/ui/progress";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Flame, Trophy, Target, Award, Zap, Check,
  Shield, ShieldCheck, ShieldOff, AlertTriangle, X, TrendingDown, Clock, Timer,
} from "lucide-react";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useQueryClient } from "@tanstack/react-query";
import { getGetMyStatsQueryKey, getGetTasksQueryKey } from "@workspace/api-client-react";
import { useToast } from "@/hooks/use-toast";

const FREEZE_COST = 50;

function DashboardSkeleton() {
  return (
    <div className="space-y-8" aria-busy="true" aria-label="Loading dashboard">
      {/* Stat cards skeleton */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <Card key={i} className="animate-pulse">
            <CardHeader className="pb-2">
              <div className="h-3 w-20 bg-muted rounded" />
            </CardHeader>
            <CardContent>
              <div className="h-8 w-16 bg-muted rounded mb-2" />
              <div className="h-3 w-24 bg-muted rounded" />
            </CardContent>
          </Card>
        ))}
      </div>
      {/* Progress bar skeleton */}
      <Card className="animate-pulse">
        <CardContent className="pt-6">
          <div className="flex justify-between mb-3">
            <div className="space-y-1.5">
              <div className="h-3 w-20 bg-muted rounded" />
              <div className="h-4 w-32 bg-muted rounded" />
            </div>
            <div className="h-8 w-12 bg-muted rounded" />
          </div>
          <div className="h-4 bg-muted rounded-full" />
        </CardContent>
      </Card>
      {/* Content skeleton */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        <div className="lg:col-span-2 space-y-4">
          <div className="h-8 w-40 bg-muted rounded animate-pulse" />
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="h-20 bg-muted/20 animate-pulse rounded-xl border border-border" />
          ))}
        </div>
        <div className="space-y-4">
          <div className="h-8 w-28 bg-muted rounded animate-pulse" />
          <Card className="animate-pulse">
            <CardContent className="p-0">
              {Array.from({ length: 5 }).map((_, i) => (
                <div key={i} className="p-4 flex gap-3 border-b border-border last:border-0">
                  <div className="w-5 h-5 rounded-full bg-muted flex-shrink-0 mt-0.5" />
                  <div className="flex-1 space-y-1.5">
                    <div className="h-3 w-full bg-muted rounded" />
                    <div className="h-2.5 w-24 bg-muted rounded" />
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}

export default function Dashboard() {
  const { data: stats, isLoading: statsLoading } = useGetMyStats();
  const { data: tasks, isLoading: tasksLoading } = useGetTasks({
    date: format(new Date(), 'yyyy-MM-dd')
  });

  const [levelUpData, setLevelUpData] = useState<any | null>(null);
  const [decayDismissed, setDecayDismissed] = useState(false);
  const [editTask, setEditTask] = useState<Task | null>(null);
  const [editTitle, setEditTitle] = useState("");
  const [editDesc, setEditDesc] = useState("");
  const [editPriority, setEditPriority] = useState<TaskPriority>(TaskPriority.medium);
  const [editEstimate, setEditEstimate] = useState("");

  const queryClient = useQueryClient();
  const { toast } = useToast();
  const buyFreezeMutation = useBuyStreakFreeze();
  const updateMutation = useUpdateTask();

  const handleOpenEdit = (task: Task) => {
    setEditTask(task);
    setEditTitle(task.title);
    setEditDesc(task.description ?? "");
    setEditPriority((task.priority as TaskPriority) ?? TaskPriority.medium);
    setEditEstimate(task.estimatedMinutes ? String(task.estimatedMinutes) : "");
  };

  const handleSaveEdit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!editTask || !editTitle.trim()) return;
    const estimatedMinutes = editEstimate ? parseInt(editEstimate, 10) : undefined;
    updateMutation.mutate({
      id: editTask.id,
      data: {
        title: editTitle,
        description: editDesc,
        priority: editPriority as any,
        ...(estimatedMinutes && estimatedMinutes > 0 ? { estimatedMinutes } : {}),
      }
    }, {
      onSuccess: () => {
        toast({ title: "Quest updated", className: "border-primary bg-primary/10" });
        setEditTask(null);
        queryClient.invalidateQueries({ queryKey: getGetTasksQueryKey() });
      }
    });
  };

  if (statsLoading || tasksLoading) {
    return <DashboardSkeleton />;
  }

  if (!stats) return null;

  const pendingTasks = tasks?.filter(t => !t.completed) || [];
  const completedTasks = tasks?.filter(t => t.completed) || [];

  const handleBuyFreeze = () => {
    buyFreezeMutation.mutate(undefined, {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getGetMyStatsQueryKey() });
        toast({
          title: "Streak Shield Activated!",
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

  // Levels have variable widths (see gamification.ts), so progress is measured
  // within the current band: points earned into it vs. the band's full span.
  const levelSpan = stats.pointsIntoLevel + stats.pointsToNextLevel;
  const progressPercent = levelSpan > 0
    ? (stats.pointsIntoLevel / levelSpan) * 100
    : 100;

  const hasFreeze = stats.streakFreezes > 0;
  const canAfford = stats.totalPoints >= FREEZE_COST;

  const lastActivityIso = stats.recentActivity[0]?.createdAt ?? null;
  const daysSinceActive = lastActivityIso
    ? differenceInDays(new Date(), parseISO(lastActivityIso))
    : 999;
  const showDecayWarning = !decayDismissed && daysSinceActive >= 3;

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">

      <Link href="/focus">
        <Button className="w-full sm:w-auto gap-2">
          <Timer className="w-4 h-4" /> Start focus session
        </Button>
      </Link>

      {/* ── Stat cards ───────────────────────────────────── */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">

        {/* Level */}
        <Card className="bg-card border-primary/20 neon-glow relative overflow-hidden">
          <div className="absolute top-0 right-0 p-4 opacity-[0.07] pointer-events-none">
            <Trophy className="w-14 h-14" />
          </div>
          <CardHeader className="pb-1">
            <CardTitle className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Level</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold text-foreground">{stats.currentLevel}</div>
            <div className="text-sm text-primary font-semibold mt-0.5 truncate">{stats.levelName}</div>
          </CardContent>
        </Card>

        {/* Today's XP */}
        <Card className="bg-card relative overflow-hidden">
          <div className="absolute top-0 right-0 p-4 opacity-[0.07] pointer-events-none">
            <Zap className="w-14 h-14" />
          </div>
          <CardHeader className="pb-1">
            <CardTitle className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Today's XP</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold text-foreground">{stats.todayPoints}</div>
            <div className="text-sm text-muted-foreground mt-0.5">Total: {stats.totalPoints.toLocaleString()}</div>
          </CardContent>
        </Card>

        {/* Daily Quests */}
        <Card className="bg-card relative overflow-hidden">
          <div className="absolute top-0 right-0 p-4 opacity-[0.07] pointer-events-none">
            <Target className="w-14 h-14" />
          </div>
          <CardHeader className="pb-1">
            <CardTitle className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Quests</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold text-foreground">
              {stats.todayTasksCompleted}
              <span className="text-lg text-muted-foreground font-normal"> / {stats.todayTasksTotal}</span>
            </div>
            <div className="text-sm mt-0.5">
              {stats.allDayBonusEarned
                ? <span className="text-yellow-400 font-semibold">Bonus active!</span>
                : <span className="text-muted-foreground">Complete all for bonus</span>}
            </div>
          </CardContent>
        </Card>

        {/* Streak */}
        <Card className="bg-card relative overflow-hidden">
          <div className="absolute top-0 right-0 p-4 opacity-[0.07] pointer-events-none">
            <Flame className="w-14 h-14" />
          </div>
          <CardHeader className="pb-1">
            <CardTitle className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Streak</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold text-foreground flex items-center gap-2">
              <Flame className="w-6 h-6 text-orange-400" />
              <span>{stats.streakDays}</span>
            </div>
            <div className="text-sm text-muted-foreground mt-0.5">Days in a row</div>
          </CardContent>
        </Card>
      </div>

      {/* ── XP Progress bar ───────────────────────────────── */}
      <Card className="border-primary/20">
        <CardContent className="pt-5 pb-5">
          <div className="flex justify-between items-end mb-3">
            <div>
              <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-0.5">Progress to Next Level</div>
              <div className="font-bold text-primary">{stats.pointsToNextLevel.toLocaleString()} XP remaining</div>
            </div>
            <div className="text-2xl font-bold text-foreground tabular-nums">{Math.round(progressPercent)}%</div>
          </div>
          <Progress value={progressPercent} className="h-3 bg-muted" />
        </CardContent>
      </Card>

      {/* ── Quest Activity Heatmap + Hero + Recent Badges ── */}
      <ActivityHeatmap
        aside={
          <div className="flex flex-col sm:flex-row sm:items-center gap-5 sm:gap-6 w-full">
            <div className="sm:shrink-0">
              <HeroSummary />
            </div>
            <div className="w-full border-t border-border pt-4 sm:w-auto sm:border-t-0 sm:border-l sm:border-border sm:pt-0 sm:pl-6">
              <RecentBadges />
            </div>
          </div>
        }
      />

      {/* ── XP Decay Warning ──────────────────────────────── */}
      {showDecayWarning && (
        <div
          role="alert"
          className="relative flex items-start gap-4 p-4 rounded-xl border border-amber-500/40 bg-amber-500/8 shadow-[0_0_20px_rgba(251,191,36,0.08)] animate-in fade-in slide-in-from-top-2 duration-300"
        >
          <div className="flex-shrink-0 p-2 rounded-lg bg-amber-500/15 border border-amber-500/30 mt-0.5">
            <TrendingDown className="w-5 h-5 text-amber-400" aria-hidden />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1">
              <AlertTriangle className="w-4 h-4 text-amber-400" aria-hidden />
              <span className="text-sm font-bold uppercase tracking-wider text-amber-400">XP Ranking Sliding</span>
            </div>
            <p className="text-sm text-muted-foreground">
              {daysSinceActive >= 999
                ? "No quests completed yet — your weekly XP ranking hasn't started. Complete your first quest to get on the board."
                : `You've been away for ${daysSinceActive} day${daysSinceActive === 1 ? "" : "s"}. Weekly XP rankings reset every Monday — every quest you skip lets others pull ahead.`
              }
            </p>
            <Button
              asChild
              size="sm"
              className="mt-3 bg-amber-500/20 border border-amber-500/40 text-amber-300 hover:bg-amber-500/30 hover:text-amber-200 h-8 px-4 cursor-pointer"
            >
              <Link href="/tasks">Get Back on Track →</Link>
            </Button>
          </div>
          <button
            onClick={() => setDecayDismissed(true)}
            aria-label="Dismiss warning"
            className="flex-shrink-0 p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors cursor-pointer"
          >
            <X className="w-4 h-4" aria-hidden />
          </button>
        </div>
      )}

      {/* ── Streak Shield ─────────────────────────────────── */}
      <Card className={`border transition-all duration-300 ${hasFreeze ? "border-cyan-500/40 bg-cyan-500/5 shadow-[0_0_20px_rgba(0,255,255,0.08)]" : "border-border"}`}>
        <CardContent className="pt-5 pb-5">
          <div className="flex items-center justify-between gap-4 flex-wrap">
            <div className="flex items-center gap-4">
              <div className={`p-2.5 rounded-xl border ${hasFreeze ? "bg-cyan-500/15 border-cyan-500/40 shadow-[0_0_12px_rgba(0,255,255,0.25)]" : "bg-muted/40 border-border"}`}>
                {hasFreeze
                  ? <ShieldCheck className="w-6 h-6 text-cyan-400" aria-hidden />
                  : <ShieldOff className="w-6 h-6 text-muted-foreground" aria-hidden />
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
                    : <span className="text-muted-foreground">Protects your streak from a missed day.</span>
                  }
                </p>
              </div>
            </div>

            <Button
              onClick={handleBuyFreeze}
              disabled={hasFreeze || !canAfford || buyFreezeMutation.isPending}
              variant={hasFreeze ? "ghost" : "outline"}
              aria-label={hasFreeze ? "Streak Shield already active" : `Buy Streak Shield for ${FREEZE_COST} XP`}
              className={`cursor-pointer ${
                hasFreeze
                  ? "text-muted-foreground cursor-default"
                  : canAfford
                    ? "border-cyan-500/50 text-cyan-400 hover:bg-cyan-500/10 hover:border-cyan-500"
                    : "border-muted text-muted-foreground"
              }`}
            >
              {hasFreeze
                ? <><ShieldCheck className="w-4 h-4 mr-2" aria-hidden /> Shield Active</>
                : !canAfford
                  ? <><Shield className="w-4 h-4 mr-2" aria-hidden /> Need {FREEZE_COST} XP</>
                  : <><Shield className="w-4 h-4 mr-2" aria-hidden /> Buy for {FREEZE_COST} XP</>
              }
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* ── Main grid: Quests + Activity ──────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">

        {/* Quest list */}
        <div className="lg:col-span-2 space-y-5">
          <div className="flex items-center justify-between">
            <h2 className="text-xl font-bold tracking-tight flex items-center gap-2">
              <Target className="w-5 h-5 text-primary" aria-hidden />
              Today's Quests
            </h2>
            <Button asChild variant="outline" size="sm" className="border-primary/50 text-primary hover:bg-primary/20 cursor-pointer">
              <Link href="/tasks">View All</Link>
            </Button>
          </div>

          <div className="space-y-3">
            {pendingTasks.length === 0 && completedTasks.length === 0 && (
              <div className="text-center py-12 border-2 border-dashed border-muted rounded-xl">
                <Target className="w-10 h-10 text-muted-foreground mx-auto mb-3 opacity-40" aria-hidden />
                <h3 className="text-base font-semibold text-foreground">No quests active today</h3>
                <p className="text-sm text-muted-foreground mt-1 mb-4">Ready to start grinding?</p>
                <Button asChild size="sm" className="cursor-pointer">
                  <Link href="/tasks">Add a Quest</Link>
                </Button>
              </div>
            )}

            {pendingTasks.map(task => (
              <TaskItem key={task.id} task={task} onEdit={handleOpenEdit} onLevelUp={setLevelUpData} />
            ))}

            {completedTasks.length > 0 && (
              <>
                <h3 className="text-xs font-bold uppercase tracking-wider text-muted-foreground pt-4 pb-1 flex items-center gap-2">
                  <Check className="w-3.5 h-3.5" aria-hidden /> Completed ({completedTasks.length})
                </h3>
                <div className="opacity-60 space-y-3">
                  {completedTasks.map(task => (
                    <TaskItem key={task.id} task={task} onLevelUp={setLevelUpData} />
                  ))}
                </div>
              </>
            )}
          </div>
        </div>

        {/* Activity feed */}
        <div className="space-y-5">
          <h2 className="text-xl font-bold tracking-tight">Activity Log</h2>
          <Card>
            <CardContent className="p-0">
              <div className="divide-y divide-border">
                {stats.recentActivity.slice(0, 8).map((activity: ActivityItem) => (
                  <div key={activity.id} className="p-4 flex gap-3 hover:bg-muted/30 transition-colors">
                    <div className="mt-0.5 flex-shrink-0" aria-hidden>
                      {activity.type === 'task_completed'       && <Check       className="w-4 h-4 text-green-500" />}
                      {activity.type === 'badge_earned'         && <Award       className="w-4 h-4 text-secondary" />}
                      {activity.type === 'level_up'             && <Trophy      className="w-4 h-4 text-primary" />}
                      {activity.type === 'streak_milestone'     && <Flame       className="w-4 h-4 text-orange-400" />}
                      {activity.type === 'all_day_bonus'        && <Zap         className="w-4 h-4 text-yellow-500" />}
                      {activity.type === 'streak_freeze_bought' && <Shield      className="w-4 h-4 text-cyan-400" />}
                      {activity.type === 'streak_freeze_used'   && <ShieldCheck className="w-4 h-4 text-cyan-400" />}
                    </div>
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-foreground leading-snug">{activity.description}</p>
                      <p className="text-xs text-muted-foreground mt-0.5">
                        {format(new Date(activity.createdAt), 'MMM d, h:mm a')}
                        {activity.points !== 0 && (
                          <span className={`font-bold ml-2 tabular-nums ${activity.points < 0 ? "text-red-400" : "text-primary"}`}>
                            {activity.points > 0 ? "+" : ""}{activity.points} XP
                          </span>
                        )}
                      </p>
                    </div>
                  </div>
                ))}
                {stats.recentActivity.length === 0 && (
                  <div className="p-8 text-center text-muted-foreground text-sm">
                    No activity yet. Complete a quest to get started!
                  </div>
                )}
              </div>
            </CardContent>
          </Card>
        </div>
      </div>

      {/* ── Edit quest dialog ─────────────────────────────── */}
      <Dialog open={!!editTask && !editTask.completed} onOpenChange={(open) => { if (!open) setEditTask(null); }}>
        <DialogContent className="sm:max-w-md bg-card border-primary/30">
          <DialogHeader>
            <DialogTitle className="text-2xl font-bold text-primary">Edit Quest</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleSaveEdit} className="space-y-4 mt-4">
            <div>
              <label className="text-sm font-medium text-foreground mb-1 block">Objective</label>
              <Input
                value={editTitle}
                onChange={(e) => setEditTitle(e.target.value)}
                className="border-primary/20 focus:border-primary"
                autoFocus
              />
            </div>

            <div>
              <label className="text-sm font-medium text-foreground mb-1 block">Details (Optional)</label>
              <Textarea
                value={editDesc}
                onChange={(e) => setEditDesc(e.target.value)}
                placeholder="Add some context..."
                className="border-primary/20 focus:border-primary"
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-sm font-medium text-foreground mb-1 block">Priority</label>
                <Select value={editPriority} onValueChange={(val: TaskPriority) => setEditPriority(val)}>
                  <SelectTrigger className="border-primary/20">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="low">Low</SelectItem>
                    <SelectItem value="medium">Medium</SelectItem>
                    <SelectItem value="high">High</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <label className="text-sm font-medium text-foreground mb-1 block">
                  Est. Time <span className="text-muted-foreground font-normal">(optional)</span>
                </label>
                <div className="relative">
                  <Clock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" />
                  <Input
                    type="number"
                    min={1}
                    max={1440}
                    value={editEstimate}
                    onChange={(e) => setEditEstimate(e.target.value)}
                    placeholder="e.g. 30"
                    className="pl-9 border-primary/20 focus:border-primary"
                  />
                  <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">min</span>
                </div>
              </div>
            </div>

            <div className="pt-4 flex justify-end gap-3">
              <Button type="button" variant="ghost" onClick={() => setEditTask(null)}>Cancel</Button>
              <Button
                type="submit"
                disabled={!editTitle.trim() || updateMutation.isPending}
                className="bg-primary hover:bg-primary/90 text-primary-foreground"
              >
                {updateMutation.isPending ? "Saving..." : "Save Changes"}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      {/* ── Level-up dialog ───────────────────────────────── */}
      <Dialog open={!!levelUpData} onOpenChange={() => setLevelUpData(null)}>
        <DialogContent className="sm:max-w-md bg-card border-primary neon-glow text-center">
          <DialogHeader>
            <DialogTitle className="text-2xl font-bold text-primary uppercase tracking-wider text-center">
              Level Up!
            </DialogTitle>
          </DialogHeader>
          <div className="py-8 animate-level-up">
            <Trophy className="w-20 h-20 text-primary mx-auto mb-6 drop-shadow-[0_0_15px_rgba(0,255,255,0.8)]" aria-hidden />
            <h3 className="text-3xl font-bold text-foreground mb-2">Level {levelUpData?.newLevel}!</h3>
            <p className="text-muted-foreground">{levelUpData?.levelName ?? "Keep the momentum going."}</p>

            {levelUpData?.newBadges?.length > 0 && (
              <div className="mt-8">
                <h4 className="text-xs font-bold uppercase tracking-wider text-secondary mb-4">Badges Unlocked</h4>
                <div className="flex justify-center gap-4 flex-wrap">
                  {levelUpData.newBadges.map((b: any) => (
                    <div key={b.id} className="p-3 bg-secondary/20 border border-secondary/50 rounded-lg">
                      <Award className="w-8 h-8 text-secondary mx-auto mb-2" aria-hidden />
                      <div className="text-xs font-bold">{b.name}</div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
          <Button
            onClick={() => setLevelUpData(null)}
            className="w-full bg-primary hover:bg-primary/80 text-background font-bold text-lg h-12 cursor-pointer"
          >
            Continue Quest
          </Button>
        </DialogContent>
      </Dialog>
    </div>
  );
}
