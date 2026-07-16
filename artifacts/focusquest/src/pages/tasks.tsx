import { useState, useEffect } from "react";
import { format } from "date-fns";
import { Calendar as CalendarIcon, Clock, Plus, Filter, Target, Zap, Info, Sparkles, RefreshCw, Pin } from "lucide-react";
import { Task, useGetTasks, useCreateTask, useUpdateTask, useBreakdownTask, useGetQuestlines, TaskPriority, useGetTasksMomentum, BrainMode, useGetMyPatterns } from "@workspace/api-client-react";
import { TaskItem } from "@/components/task-item";
import { QuickAddBar } from "@/components/quick-add-bar";
import { MomentumCard } from "@/components/momentum-card";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { useToast } from "@/hooks/use-toast";
import { useQueryClient } from "@tanstack/react-query";
import { getGetTasksQueryKey, getGetTasksMomentumQueryKey, getGetMyPatternsQueryKey } from "@workspace/api-client-react";
import { CATEGORIES, CATEGORY_HEX_COLORS } from "@/lib/categories";
import { parseDueDate, toDueDateString } from "@/lib/reschedule";
import { momentumBoardState } from "@/lib/momentum-board";
import { MODE_META } from "@/lib/brain-mode-meta";
import { inWindowNow } from "@/lib/steering";
import { formatPowerHours } from "@/lib/rhythms";
import { browserTimeZone } from "@/lib/timezone";
import { apiErrorMessage } from "@/lib/api-error";

interface PointPreview {
  points: number;
  category: string;
  categoryLabel: string;
}

const PRIORITY_LABEL: Record<string, string> = {
  high: "High Priority",
  medium: "Medium Priority",
  low: "Low Priority",
};

function usePointPreview(title: string, priority: string): PointPreview | null {
  const [preview, setPreview] = useState<PointPreview | null>(null);

  useEffect(() => {
    if (!title.trim()) { setPreview(null); return; }
    const timer = setTimeout(() => {
      fetch(`/api/tasks/suggest-points?title=${encodeURIComponent(title)}&priority=${priority}`)
        .then((r) => r.json())
        .then((data: PointPreview) => setPreview(data))
        .catch(() => {});
    }, 300);
    return () => clearTimeout(timer);
  }, [title, priority]);

  return preview;
}

function formatMinutes(minutes: number | null | undefined): string {
  if (!minutes) return "";
  if (minutes < 60) return `${minutes}m`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m > 0 ? `${h}h ${m}m` : `${h}h`;
}

function questlineLabel(ql: { title: string; status: string }): string {
  return ql.status === "completed" ? `${ql.title} · done` : ql.title;
}

function TimeInput({
  value,
  onChange,
  placeholder = "e.g. 30",
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
}) {
  return (
    <div className="relative">
      <Clock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" />
      <Input
        type="number"
        min={1}
        max={1440}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="pl-9 border-primary/20 focus:border-primary"
      />
      <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">min</span>
    </div>
  );
}

export default function Tasks() {
  const [date, setDate] = useState<Date | undefined>(new Date());
  const [filter, setFilter] = useState<string>("all");
  const [categoryFilter, setCategoryFilter] = useState<string>("all");
  const [questlineFilter, setQuestlineFilter] = useState<string>("all");
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [newTaskTitle, setNewTaskTitle] = useState("");
  const [newTaskDesc, setNewTaskDesc] = useState("");
  const [newTaskPriority, setNewTaskPriority] = useState<TaskPriority>(TaskPriority.medium);
  const [newTaskEstimate, setNewTaskEstimate] = useState("");
  const [newTaskCategory, setNewTaskCategory] = useState("");
  const [newTaskAnchored, setNewTaskAnchored] = useState(false);
  const [newTaskQuestlineId, setNewTaskQuestlineId] = useState<string>("none");
  const [categoryManuallySet, setCategoryManuallySet] = useState(false);
  const [createdTask, setCreatedTask] = useState<Task | null>(null);

  const [editTask, setEditTask] = useState<Task | null>(null);
  const [editTitle, setEditTitle] = useState("");
  const [editDesc, setEditDesc] = useState("");
  const [editPriority, setEditPriority] = useState<TaskPriority>(TaskPriority.medium);
  const [editEstimate, setEditEstimate] = useState("");
  const [editCategory, setEditCategory] = useState("");
  const [editDueDate, setEditDueDate] = useState<Date | undefined>(undefined);
  const [editAnchored, setEditAnchored] = useState(false);
  const [editQuestlineId, setEditQuestlineId] = useState<string>("none");

  const { toast } = useToast();
  const queryClient = useQueryClient();

  const tz = browserTimeZone();
  const todayStrKey = format(new Date(), "yyyy-MM-dd");
  const [skippedIds, setSkippedIds] = useState<number[]>([]);
  const [altIndex, setAltIndex] = useState(0);
  const [momentumMinutes, setMomentumMinutes] = useState<number | null>(() => {
    try {
      const raw = sessionStorage.getItem("momentumMinutes");
      if (!raw) return null;
      const [day, val] = raw.split(":");
      return day === todayStrKey ? Number(val) || null : null; // cleared daily
    } catch {
      return null; // storage unavailable — chips just don't persist
    }
  });
  const setMinutes = (m: number | null) => {
    setMomentumMinutes(m);
    try {
      if (m) sessionStorage.setItem("momentumMinutes", `${todayStrKey}:${m}`);
      else sessionStorage.removeItem("momentumMinutes");
    } catch {
      // storage unavailable — in-memory state still works for this visit
    }
  };
  const { data: momentum, isFetching: momentumLoading } = useGetTasksMomentum({
    tz,
    ...(momentumMinutes ? { minutes: momentumMinutes } : {}),
    ...(skippedIds.length ? { exclude: skippedIds.join(",") } : {}),
  });
  const { data: patterns } = useGetMyPatterns({ tz }, { query: { queryKey: getGetMyPatternsQueryKey({ tz }), staleTime: 5 * 60_000 } });
  // "Not this one": walk the returned alternates first (instant), then refetch with exclude.
  const batch = momentum?.suggestions ?? [];
  // Clamp: an invalidation-driven refetch can shrink the batch below a stale altIndex.
  const visibleSuggestions = batch.slice(altIndex < batch.length ? altIndex : 0);
  const handleSkip = () => {
    const current = visibleSuggestions[0];
    if (!current) return;
    if (visibleSuggestions.length > 1) {
      setAltIndex((i) => i + 1);
    } else {
      // Exclude EVERY suggestion the user walked past in this batch — a
      // rejected suggestion must not resurface on the refetch.
      const batchIds = batch.map((s) => s.task.id);
      setSkippedIds((ids) => [...ids, ...batchIds.filter((id) => !ids.includes(id))]);
      setAltIndex(0);
    }
  };

  const { data: tasks, isLoading } = useGetTasks({
    date: date ? format(date, 'yyyy-MM-dd') : undefined,
    completed: filter === "completed" ? true : filter === "pending" ? false : undefined,
    category: categoryFilter !== "all" ? (categoryFilter as any) : undefined,
    // Enables server-side adaptive-difficulty offer flags (local-day struggle math).
    tz: browserTimeZone(),
  });

  const { data: questlines } = useGetQuestlines();
  const activeQuestlines = (questlines ?? []).filter((q) => q.status === "active");

  const visibleTasks = (tasks ?? []).filter((t) =>
    questlineFilter === "all" ? true : String(t.questlineId ?? "") === questlineFilter,
  );

  const createMutation = useCreateTask();
  const updateMutation = useUpdateTask();
  const breakdownMutation = useBreakdownTask();
  const pointPreview = usePointPreview(newTaskTitle, newTaskPriority);

  useEffect(() => {
    if (pointPreview && !categoryManuallySet) {
      setNewTaskCategory(pointPreview.category);
    }
  }, [pointPreview, categoryManuallySet]);

  const handleCreateTask = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newTaskTitle.trim()) return;
    if (!newTaskAnchored && !date) return;

    const estimatedMinutes = newTaskEstimate ? parseInt(newTaskEstimate, 10) : undefined;

    createMutation.mutate({
      data: {
        title: newTaskTitle,
        description: newTaskDesc,
        priority: newTaskPriority as any,
        ...(newTaskAnchored
          ? { isAnchored: true }
          : { dueDate: format(date!, 'yyyy-MM-dd') }),
        ...(estimatedMinutes && estimatedMinutes > 0 ? { estimatedMinutes } : {}),
        ...(newTaskCategory ? { category: newTaskCategory as any } : {}),
        ...(newTaskQuestlineId !== "none" ? { questlineId: parseInt(newTaskQuestlineId, 10) } : {}),
      }
    }, {
      onSuccess: (task) => {
        toast({
          title: `Quest added — ${task.points} XP`,
          description: `Category: ${task.categoryLabel}`,
          className: "border-primary",
        });
        setCreatedTask(task);
        queryClient.invalidateQueries({ queryKey: getGetTasksQueryKey() });
        queryClient.invalidateQueries({ queryKey: getGetTasksMomentumQueryKey() });
      }
    });
  };

  const handleCloseCreate = () => {
    setIsCreateOpen(false);
    setNewTaskTitle("");
    setNewTaskDesc("");
    setNewTaskPriority(TaskPriority.medium);
    setNewTaskEstimate("");
    setNewTaskCategory("");
    setNewTaskAnchored(false);
    setNewTaskQuestlineId("none");
    setCategoryManuallySet(false);
    setCreatedTask(null);
  };

  const handleBreakdownNew = () => {
    if (!createdTask) return;
    breakdownMutation.mutate({ id: createdTask.id }, {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getGetTasksQueryKey() });
        queryClient.invalidateQueries({ queryKey: getGetTasksMomentumQueryKey() });
        toast({ title: "Broke it into first steps ✦", className: "border-primary" });
        handleCloseCreate();
      },
      onError: (err: any) => {
        const status = err?.status;
        const msg =
          status === 503 ? "AI breakdown isn't set up yet."
          : status === 429 ? "Give it a moment and try again."
          : status === 502 ? "Couldn't generate a breakdown — try again."
          : err?.data?.error ?? "Something went wrong.";
        toast({ title: msg, variant: "destructive" });
      },
    });
  };

  const handleOpenEdit = (task: Task) => {
    setEditTask(task);
    setEditTitle(task.title);
    setEditDesc(task.description ?? "");
    setEditPriority((task.priority as TaskPriority) ?? TaskPriority.medium);
    setEditEstimate(task.estimatedMinutes ? String(task.estimatedMinutes) : "");
    setEditCategory(task.category ?? "default");
    setEditDueDate(task.dueDate ? parseDueDate(task.dueDate) : undefined);
    setEditAnchored(task.isAnchored ?? false);
    setEditQuestlineId(task.questlineId != null ? String(task.questlineId) : "none");
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
        isAnchored: editAnchored,
        ...(editAnchored
          ? {}
          : (editDueDate ? { dueDate: toDueDateString(editDueDate) } : {})),
        ...(estimatedMinutes && estimatedMinutes > 0 ? { estimatedMinutes } : {}),
        category: editCategory as any,
        questlineId: editQuestlineId !== "none" ? parseInt(editQuestlineId, 10) : null,
      }
    }, {
      onSuccess: () => {
        toast({ title: "Quest updated", className: "border-primary" });
        setEditTask(null);
        queryClient.invalidateQueries({ queryKey: getGetTasksQueryKey() });
        queryClient.invalidateQueries({ queryKey: getGetTasksMomentumQueryKey() });
      },
      onError: (err: any) => {
        const msg = apiErrorMessage(err, "Could not update quest");
        toast({ title: msg, variant: "destructive" });
      },
    });
  };

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h1 className="text-3xl font-bold text-foreground">Quest Log</h1>
          <p className="text-muted-foreground mt-1">Manage your active and completed objectives.</p>
        </div>
        <div className="flex items-center gap-2 self-start sm:self-auto">
          <Button onClick={() => setIsCreateOpen(true)} className="bg-primary hover:bg-primary/90 text-primary-foreground shadow-[0_0_15px_rgba(0,255,255,0.3)]">
            <Plus className="w-5 h-5 mr-2" /> New Quest
          </Button>
        </div>
      </div>

      <QuickAddBar selectedDate={date} />

      <div className="flex flex-col sm:flex-row gap-4 items-center bg-card p-4 rounded-xl border border-border">
        <Popover>
          <PopoverTrigger asChild>
            <Button variant="outline" className={`w-full sm:w-[240px] justify-start text-left font-normal ${!date && "text-muted-foreground"}`}>
              <CalendarIcon className="mr-2 h-4 w-4 text-primary" />
              {date ? format(date, "PPP") : <span>Pick a date</span>}
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-auto p-0 border-primary/20" align="start">
            <Calendar mode="single" selected={date} onSelect={setDate} initialFocus />
          </PopoverContent>
        </Popover>

        <Select value={filter} onValueChange={setFilter}>
          <SelectTrigger className="w-full sm:w-[180px]">
            <Filter className="w-4 h-4 mr-2 text-primary" />
            <SelectValue placeholder="Filter by status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Quests</SelectItem>
            <SelectItem value="pending">Pending</SelectItem>
            <SelectItem value="completed">Completed</SelectItem>
          </SelectContent>
        </Select>

        <Select value={categoryFilter} onValueChange={setCategoryFilter}>
          <SelectTrigger className="w-full sm:w-[180px]">
            <SelectValue placeholder="Filter by category" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Categories</SelectItem>
            {CATEGORIES.map((c) => (
              <SelectItem key={c.slug} value={c.slug}>{c.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select value={questlineFilter} onValueChange={setQuestlineFilter}>
          <SelectTrigger className="w-full sm:w-[180px]">
            <SelectValue placeholder="All questlines" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All questlines</SelectItem>
            {(questlines ?? []).map((ql) => (
              <SelectItem key={ql.id} value={String(ql.id)}>
                {questlineLabel(ql)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        {date && (
          <Button variant="ghost" onClick={() => setDate(undefined)} className="w-full sm:w-auto text-muted-foreground">
            Clear Date
          </Button>
        )}
      </div>

      {/* Today's Focus section */}
      {(() => {
        const board = momentumBoardState(tasks ?? [], visibleSuggestions, todayStrKey);
        const flavor = MODE_META[momentum?.mode ?? BrainMode.neutral].flavor;
        // Power-window banner: confidence-gated, hidden for frozen brains, only
        // while the current hour actually is a window (spec §Client).
        const showPowerBanner =
          patterns?.confidence === "ok" &&
          inWindowNow(new Date(), patterns.powerHours) &&
          momentum?.mode !== BrainMode.frozen;
        const powerBanner = showPowerBanner ? (
          <p className="text-xs text-primary mb-1 flex items-center gap-1">
            <Zap className="w-3 h-3" aria-hidden />
            {formatPowerHours(patterns!.powerHours)} — your power window
          </p>
        ) : null;
        const heading = (
          <div className="flex items-center gap-2">
            <Target className="w-4 h-4 text-primary" />
            <h2 className="text-sm font-semibold uppercase tracking-wider text-primary">Today's Focus</h2>
          </div>
        );
        if (board.kind === "empty") {
          return (
            <div className="mb-6">
              <div className="mb-3">{heading}</div>
              <div className="flex items-center gap-3 p-4 rounded-xl border-2 border-dashed border-primary/25 bg-primary/[0.03]">
                <Pin className="w-4 h-4 text-primary/70 flex-shrink-0" aria-hidden />
                <p className="text-sm text-muted-foreground">
                  Nothing queued — add a quest below and the board takes it from there.
                </p>
              </div>
            </div>
          );
        }
        if (board.kind === "all-done") {
          return (
            <div className="mb-6 space-y-3">
              <div className="mb-3">{heading}</div>
              <p className="text-sm text-primary/90 px-1">Focus cleared for today ✦</p>
              {board.suggestion && (
                <div className="px-1">
                  <p className="text-xs text-muted-foreground mb-2">One more tiny win, only if you feel like it:</p>
                  <MomentumCard suggestion={board.suggestion}
                    minutes={momentumMinutes} onMinutes={setMinutes} onSkip={handleSkip} skipping={momentumLoading} />
                </div>
              )}
            </div>
          );
        }
        return (
          <div className="mb-6">
            <div className="flex items-center justify-between mb-1">
              {heading}
              {board.totalPinned > 0 && (
                <span className="text-xs text-muted-foreground px-2 py-0.5 rounded-full bg-muted border border-border">
                  {board.completedCount} / {board.totalPinned} done
                </span>
              )}
            </div>
            {powerBanner}
            {flavor && <p className="text-xs text-muted-foreground mb-3">{flavor}</p>}
            <div className="space-y-2">
              {board.suggestion && (
                <MomentumCard suggestion={board.suggestion}
                  minutes={momentumMinutes} onMinutes={setMinutes} onSkip={handleSkip} skipping={momentumLoading} />
              )}
              {board.pinned.length > 0 && (
                <div className="space-y-2 pl-1 border-l-2 border-primary/30">
                  {board.pinned.map((task) => (
                    <TaskItem key={task.id} task={task} onEdit={handleOpenEdit} />
                  ))}
                </div>
              )}
            </div>
          </div>
        );
      })()}

      <div className="space-y-4">
        {isLoading ? (
          Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="h-24 bg-muted/20 animate-pulse rounded-xl border border-border" />
          ))
        ) : visibleTasks.length > 0 ? (
          visibleTasks.map(task => (
            <TaskItem key={task.id} task={task} onEdit={handleOpenEdit} />
          ))
        ) : (
          <div className="text-center py-20 border-2 border-dashed border-muted rounded-xl bg-card/50">
            <h3 className="text-xl font-bold text-foreground mb-2">Log is empty</h3>
            <p className="text-muted-foreground">No quests found for the selected filters.</p>
          </div>
        )}
      </div>

      {/* Create dialog */}
      <Dialog open={isCreateOpen} onOpenChange={(open) => { if (!open) handleCloseCreate(); }}>
        <DialogContent className="sm:max-w-md bg-card border-primary/30">
          <DialogHeader>
            <DialogTitle className="text-2xl font-bold text-primary">
              {createdTask ? "Quest Added" : "New Quest"}
            </DialogTitle>
          </DialogHeader>
          {createdTask ? (
            <div className="space-y-4 mt-4">
              <p className="text-sm text-muted-foreground">
                <span className="text-foreground font-medium">{createdTask.title}</span> is in your log ✦ Want a head start?
              </p>
              <p className="text-xs text-muted-foreground">
                Let AI break it into a few concrete first steps to beat the initiation wall.
              </p>
              <div className="pt-2 flex justify-end gap-3">
                <Button type="button" variant="ghost" onClick={handleCloseCreate}>Done</Button>
                <Button
                  onClick={handleBreakdownNew}
                  disabled={breakdownMutation.isPending}
                  className="bg-primary hover:bg-primary/90 text-primary-foreground gap-2"
                >
                  {breakdownMutation.isPending
                    ? <RefreshCw className="w-4 h-4 animate-spin" />
                    : <Sparkles className="w-4 h-4" />}
                  Break it down
                </Button>
              </div>
            </div>
          ) : (
          <form onSubmit={handleCreateTask} className="space-y-4 mt-4">
            <div>
              <label className="text-sm font-medium text-foreground mb-1 block">Objective</label>
              <Input
                value={newTaskTitle}
                onChange={(e) => setNewTaskTitle(e.target.value)}
                placeholder="e.g. Morning workout, Read for 20 min..."
                className="border-primary/20 focus:border-primary"
                autoFocus
              />
            </div>

            {/* Live XP Preview */}
            <div className={`rounded-lg border px-4 py-3 transition-all duration-300 ${
              pointPreview
                ? "border-primary/40 bg-primary/5"
                : "border-border bg-muted/20"
            }`}>
              {pointPreview ? (
                <div className="flex items-center justify-between">
                  <div>
                    <div className="text-xs uppercase tracking-wider text-muted-foreground mb-0.5">Auto-assigned XP</div>
                    <div className="flex items-center gap-2">
                      <Zap className="w-4 h-4 text-primary" />
                      <span className="text-2xl font-bold text-primary">{pointPreview.points} XP</span>
                      <span className="text-xs text-muted-foreground px-2 py-0.5 rounded-full bg-muted border border-border">
                        {pointPreview.categoryLabel}
                      </span>
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="text-xs text-muted-foreground flex items-center gap-1">
                      <Info className="w-3 h-3" />
                      Set by task type
                    </div>
                  </div>
                </div>
              ) : (
                <div className="flex items-center gap-2 text-muted-foreground">
                  <Zap className="w-4 h-4" />
                  <span className="text-sm">XP auto-assigned when you type your objective</span>
                </div>
              )}
            </div>

            <div>
              <label className="text-sm font-medium text-foreground mb-1 block">Category</label>
              <Select
                value={newTaskCategory || "default"}
                onValueChange={(val) => {
                  setNewTaskCategory(val);
                  setCategoryManuallySet(true);
                }}
              >
                <SelectTrigger className="border-primary/20">
                  <SelectValue placeholder="Select category" />
                </SelectTrigger>
                <SelectContent>
                  {CATEGORIES.map((c) => (
                    <SelectItem key={c.slug} value={c.slug}>
                      <span className="flex items-center gap-2">
                        <span className="w-2 h-2 rounded-full" style={{ backgroundColor: CATEGORY_HEX_COLORS[c.slug] }} />
                        {c.label}
                      </span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div>
              <label className="text-sm text-muted-foreground">Questline (optional)</label>
              <Select value={newTaskQuestlineId} onValueChange={setNewTaskQuestlineId}>
                <SelectTrigger className="border-primary/20"><SelectValue placeholder="None" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">None</SelectItem>
                  {activeQuestlines.map((ql) => (
                    <SelectItem key={ql.id} value={String(ql.id)}>{ql.title}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div>
              <label className="text-sm font-medium text-foreground mb-1 block">Details (Optional)</label>
              <Textarea
                value={newTaskDesc}
                onChange={(e) => setNewTaskDesc(e.target.value)}
                placeholder="Add some context..."
                className="border-primary/20 focus:border-primary"
              />
            </div>

            <label className="flex items-center gap-2 cursor-pointer select-none">
              <Checkbox
                checked={newTaskAnchored}
                onCheckedChange={(v) => setNewTaskAnchored(v === true)}
              />
              <span className="text-sm text-foreground">Anchor — no deadline, keep until done</span>
            </label>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-sm font-medium text-foreground mb-1 block">Priority</label>
                <Select value={newTaskPriority} onValueChange={(val: TaskPriority) => setNewTaskPriority(val)}>
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
                <TimeInput value={newTaskEstimate} onChange={setNewTaskEstimate} />
              </div>
            </div>
            <p className="text-xs text-muted-foreground -mt-2">Priority adjusts XP. Time estimate is for your own tracking.</p>

            <div className="pt-4 flex justify-end gap-3">
              <Button type="button" variant="ghost" onClick={handleCloseCreate}>Cancel</Button>
              <Button
                type="submit"
                disabled={!newTaskTitle.trim() || createMutation.isPending}
                className="bg-primary hover:bg-primary/90 text-primary-foreground"
              >
                {createMutation.isPending ? "Adding..." : "Add to Log"}
              </Button>
            </div>
          </form>
          )}
        </DialogContent>
      </Dialog>

      {/* Edit dialog (incomplete tasks only) */}
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

            <div>
              <label className="text-sm font-medium text-foreground mb-1 block">Category</label>
              <Select value={editCategory} onValueChange={setEditCategory}>
                <SelectTrigger className="border-primary/20">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {CATEGORIES.map((c) => (
                    <SelectItem key={c.slug} value={c.slug}>
                      <span className="flex items-center gap-2">
                        <span className="w-2 h-2 rounded-full" style={{ backgroundColor: CATEGORY_HEX_COLORS[c.slug] }} />
                        {c.label}
                      </span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div>
              <label className="text-sm text-muted-foreground">Questline (optional)</label>
              <Select value={editQuestlineId} onValueChange={setEditQuestlineId}>
                <SelectTrigger className="border-primary/20"><SelectValue placeholder="None" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">None</SelectItem>
                  {(questlines ?? []).map((ql) => (
                    <SelectItem key={ql.id} value={String(ql.id)}>
                      {questlineLabel(ql)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {!editAnchored && (
            <div>
              <label className="text-sm font-medium text-foreground mb-1 block">Due date</label>
              <Popover>
                <PopoverTrigger asChild>
                  <Button
                    type="button"
                    variant="outline"
                    className={`w-full justify-start text-left font-normal border-primary/20 ${!editDueDate && "text-muted-foreground"}`}
                  >
                    <CalendarIcon className="mr-2 h-4 w-4 text-primary" />
                    {editDueDate ? format(editDueDate, "PPP") : <span>Pick a date</span>}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0 border-primary/20" align="start">
                  <Calendar mode="single" selected={editDueDate} onSelect={setEditDueDate} initialFocus />
                </PopoverContent>
              </Popover>
            </div>
            )}

            <label className="flex items-center gap-2 cursor-pointer select-none">
              <Checkbox
                checked={editAnchored}
                onCheckedChange={(v) => setEditAnchored(v === true)}
              />
              <span className="text-sm text-foreground">Anchor — no deadline, keep until done</span>
            </label>

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
                <TimeInput value={editEstimate} onChange={setEditEstimate} />
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
    </div>
  );
}
