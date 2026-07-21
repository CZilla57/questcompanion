import { useState } from "react";
import { format, differenceInDays, parseISO } from "date-fns";
import { Task, TaskPriority, useGetMyStats, useGetTasks, useUpdateTask } from "@workspace/api-client-react";
import { TaskItem } from "@/components/task-item";
import { browserTimeZone } from "@/lib/timezone";
import { BrainCheckinPrompt } from "@/components/brain-checkin-prompt";
import { EveningReflectionCard } from "@/components/evening-reflection-card";
import { TodaysFocus } from "@/components/todays-focus";
import { StatusRow } from "@/components/status-row";
import { QuickAddBar } from "@/components/quick-add-bar";
import { OutboxBlock } from "@/components/outbox-block";
import { Target, Check, X, Clock, Sunrise, Sparkles, Trophy, Award } from "lucide-react";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useQueryClient } from "@tanstack/react-query";
import { getGetTasksQueryKey } from "@workspace/api-client-react";
import { useToast } from "@/hooks/use-toast";

function NowSkeleton() {
  return (
    <div className="space-y-4" aria-busy="true" aria-label="Loading">
      <div className="h-8 w-48 bg-muted rounded-full animate-pulse" />
      <div className="h-28 bg-muted/20 animate-pulse rounded-xl border border-border" />
      <div className="h-12 bg-muted/20 animate-pulse rounded-xl border border-border" />
      {Array.from({ length: 3 }).map((_, i) => (
        <div key={i} className="h-20 bg-muted/20 animate-pulse rounded-xl border border-border" />
      ))}
    </div>
  );
}

export default function NowScreen() {
  const { data: stats, isLoading: statsLoading } = useGetMyStats({ tz: browserTimeZone() });
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
        toast({ title: "Quest updated", className: "border-primary" });
        setEditTask(null);
        queryClient.invalidateQueries({ queryKey: getGetTasksQueryKey() });
      }
    });
  };

  if (statsLoading || tasksLoading) {
    return <NowSkeleton />;
  }

  // Can't reach the server (offline, cold start): capture-first shell instead
  // of a blank page. Layout already shows the offline banner.
  if (!stats) {
    return (
      <div className="space-y-4 animate-in fade-in duration-300">
        <p className="text-sm text-muted-foreground">Capture now — sort it out later.</p>
        <div id="quick-add">
          <QuickAddBar selectedDate={new Date()} />
        </div>
        <OutboxBlock />
      </div>
    );
  }

  const pendingTasks = tasks?.filter(t => !t.completed) || [];
  const completedTasks = tasks?.filter(t => t.completed) || [];

  const lastActivityIso = stats.recentActivity[0]?.createdAt ?? null;
  const daysSinceActive = lastActivityIso
    ? differenceInDays(new Date(), parseISO(lastActivityIso))
    : 999;
  const showDecayWarning = !decayDismissed && daysSinceActive >= 3;

  return (
    <div className="space-y-4 md:space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">

      {/* ── Prompt chips ───────────────────────────────────── */}
      <div className="flex flex-wrap items-center gap-2 empty:hidden">
        <BrainCheckinPrompt variant="chip" />
        <EveningReflectionCard variant="chip" />
      </div>

      {/* ── Today's Focus (suggestion only — pinned rail lives on /tasks) ── */}
      <TodaysFocus tasks={tasks ?? []} showPinned={false} />

      {/* ── Quick add ──────────────────────────────────────── */}
      <div id="quick-add">
        <QuickAddBar selectedDate={new Date()} />
      </div>

      <OutboxBlock />

      {/* ── Today's Quests ─────────────────────────────────── */}
      <div className="space-y-5">
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
              <h3 className="text-base font-semibold text-foreground">Nothing queued today</h3>
              <p className="text-sm text-muted-foreground mt-1 mb-4">Capture one above — text or voice.</p>
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

      {/* ── Status row ─────────────────────────────────────── */}
      {stats && <StatusRow stats={stats} />}

      {/* ── XP Decay Warning ──────────────────────────────── */}
      {showDecayWarning && (
        <div
          role="alert"
          className="relative flex items-start gap-4 p-4 rounded-xl border border-amber-500/40 bg-amber-500/8 shadow-[0_0_20px_rgba(251,191,36,0.08)] animate-in fade-in slide-in-from-top-2 duration-300"
        >
          <div className="flex-shrink-0 p-2 rounded-lg bg-amber-500/15 border border-amber-500/30 mt-0.5">
            <Sunrise className="w-5 h-5 text-amber-400" aria-hidden />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1">
              <Sparkles className="w-4 h-4 text-amber-400" aria-hidden />
              <span className="text-sm font-bold uppercase tracking-wider text-amber-400">{daysSinceActive >= 999 ? "Ready for quest one?" : "Welcome back"}</span>
            </div>
            <p className="text-sm text-muted-foreground">
              {daysSinceActive >= 999
                ? "No quests completed yet — your weekly XP ranking hasn't started. Complete your first quest to get on the board."
                : `It's been ${daysSinceActive} day${daysSinceActive === 1 ? "" : "s"} — today starts fresh. One small quest gets your week moving.`
              }
            </p>
            <Button
              size="sm"
              className="mt-3 bg-amber-500/20 border border-amber-500/40 text-amber-300 hover:bg-amber-500/30 hover:text-amber-200 h-8 px-4 cursor-pointer"
              onClick={() => document.getElementById("quick-add")?.scrollIntoView({ behavior: "smooth", block: "center" })}
            >
              Capture a small quest →
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
