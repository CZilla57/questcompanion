import { useState } from "react";
import { format, parseISO } from "date-fns";
import {
  Plus, Repeat, Trash2, ToggleLeft, ToggleRight, Edit2,
  Calendar as CalendarIcon, Clock, Zap, ChevronDown, ChevronUp,
  Flame, Trophy, CheckCircle2,
} from "lucide-react";
import {
  useGetRecurringTasks,
  useCreateRecurringTask,
  useUpdateRecurringTask,
  useDeleteRecurringTask,
  useToggleRecurringTask,
  getGetRecurringTasksQueryKey,
  RecurringTask,
} from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/hooks/use-toast";
import { useQueryClient } from "@tanstack/react-query";

const DAYS = [
  { value: 0, short: "Su", label: "Sunday" },
  { value: 1, short: "Mo", label: "Monday" },
  { value: 2, short: "Tu", label: "Tuesday" },
  { value: 3, short: "We", label: "Wednesday" },
  { value: 4, short: "Th", label: "Thursday" },
  { value: 5, short: "Fr", label: "Friday" },
  { value: 6, short: "Sa", label: "Saturday" },
];

const PRIORITY_COLORS: Record<string, string> = {
  high: "text-red-400 border-red-500/30 bg-red-500/10",
  medium: "text-yellow-400 border-yellow-500/30 bg-yellow-500/10",
  low: "text-green-400 border-green-500/30 bg-green-500/10",
};

function getStreakColor(streak: number): string {
  if (streak >= 30) return "text-orange-300";
  if (streak >= 14) return "text-orange-400";
  if (streak >= 7) return "text-amber-400";
  if (streak >= 3) return "text-yellow-400";
  return "text-muted-foreground";
}

function StreakBadge({ streak, longest, total }: { streak: number; longest: number; total: number }) {
  if (total === 0) return null;
  return (
    <div className="flex items-center gap-3 text-xs flex-wrap">
      <span className={`flex items-center gap-1 font-bold ${getStreakColor(streak)}`}>
        <Flame className={`w-3.5 h-3.5 ${streak > 0 ? "drop-shadow-[0_0_4px_rgba(251,146,60,0.7)]" : ""}`} />
        {streak} day streak
      </span>
      {longest > 0 && (
        <span className="flex items-center gap-1 text-muted-foreground">
          <Trophy className="w-3 h-3" />
          Best: {longest}
        </span>
      )}
      <span className="flex items-center gap-1 text-muted-foreground">
        <CheckCircle2 className="w-3 h-3" />
        {total} total
      </span>
    </div>
  );
}

function DaySelector({
  value,
  onChange,
}: {
  value: number[];
  onChange: (days: number[]) => void;
}) {
  const toggle = (day: number) => {
    if (value.includes(day)) {
      onChange(value.filter((d) => d !== day));
    } else {
      onChange([...value, day].sort());
    }
  };

  const presets = [
    { label: "Every day", days: [0, 1, 2, 3, 4, 5, 6] },
    { label: "Weekdays", days: [1, 2, 3, 4, 5] },
    { label: "Weekends", days: [0, 6] },
  ];

  return (
    <div className="space-y-3">
      <div className="flex gap-1.5">
        {DAYS.map((d) => (
          <button
            key={d.value}
            type="button"
            onClick={() => toggle(d.value)}
            className={`
              flex-1 py-2 rounded-lg text-xs font-bold transition-all duration-200 border
              ${value.includes(d.value)
                ? "bg-primary text-background border-primary shadow-[0_0_8px_rgba(0,255,255,0.4)]"
                : "bg-muted/30 text-muted-foreground border-border hover:border-primary/40 hover:text-foreground"}
            `}
          >
            {d.short}
          </button>
        ))}
      </div>
      <div className="flex gap-2">
        {presets.map((p) => (
          <button
            key={p.label}
            type="button"
            onClick={() => onChange(p.days)}
            className="text-xs text-muted-foreground hover:text-primary transition-colors underline underline-offset-2"
          >
            {p.label}
          </button>
        ))}
      </div>
    </div>
  );
}

function formatDays(days: number[]): string {
  if (days.length === 7) return "Every day";
  if (JSON.stringify(days) === JSON.stringify([1, 2, 3, 4, 5])) return "Weekdays";
  if (JSON.stringify(days) === JSON.stringify([0, 6])) return "Weekends";
  return days.map((d) => DAYS[d]?.short ?? "").join(", ");
}

interface TaskFormState {
  title: string;
  description: string;
  priority: string;
  daysOfWeek: number[];
  timeOfDay: string;
  startDate: Date;
  hasEndDate: boolean;
  endDate: Date | undefined;
}

function getDefaultForm(): TaskFormState {
  return {
    title: "",
    description: "",
    priority: "medium",
    daysOfWeek: [1, 2, 3, 4, 5],
    timeOfDay: "08:00",
    startDate: new Date(),
    hasEndDate: false,
    endDate: undefined,
  };
}

function RecurringTaskForm({
  initial,
  onSave,
  onCancel,
  isPending,
}: {
  initial?: TaskFormState;
  onSave: (form: TaskFormState) => void;
  onCancel: () => void;
  isPending: boolean;
}) {
  const [form, setForm] = useState<TaskFormState>(initial ?? getDefaultForm());
  const set = (key: keyof TaskFormState, val: unknown) =>
    setForm((f) => ({ ...f, [key]: val }));

  const valid = form.title.trim() && form.daysOfWeek.length > 0;

  return (
    <form
      onSubmit={(e) => { e.preventDefault(); if (valid) onSave(form); }}
      className="space-y-5"
    >
      <div>
        <label className="text-sm font-medium text-foreground mb-1 block">Objective</label>
        <Input
          value={form.title}
          onChange={(e) => set("title", e.target.value)}
          placeholder="e.g. Morning workout, Take medication..."
          className="border-primary/20 focus:border-primary"
          autoFocus
        />
      </div>

      <div>
        <label className="text-sm font-medium text-foreground mb-1 block">Details (Optional)</label>
        <Textarea
          value={form.description}
          onChange={(e) => set("description", e.target.value)}
          placeholder="Any context..."
          className="border-primary/20 focus:border-primary"
          rows={2}
        />
      </div>

      <div>
        <label className="text-sm font-medium text-foreground mb-1 block">Priority</label>
        <Select value={form.priority} onValueChange={(v) => set("priority", v)}>
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
        <label className="text-sm font-medium text-foreground mb-2 block">Repeat on</label>
        <DaySelector value={form.daysOfWeek} onChange={(d) => set("daysOfWeek", d)} />
        {form.daysOfWeek.length === 0 && (
          <p className="text-xs text-red-400 mt-1">Select at least one day.</p>
        )}
      </div>

      <div>
        <label className="text-sm font-medium text-foreground mb-1 block">
          <Clock className="inline w-3.5 h-3.5 mr-1 text-primary" />
          Time (tasks created at this time each day)
        </label>
        <Input
          type="time"
          value={form.timeOfDay}
          onChange={(e) => set("timeOfDay", e.target.value)}
          className="border-primary/20 focus:border-primary w-40"
        />
      </div>

      <div>
        <label className="text-sm font-medium text-foreground mb-1 block">
          <CalendarIcon className="inline w-3.5 h-3.5 mr-1 text-primary" />
          Start date
        </label>
        <Popover>
          <PopoverTrigger asChild>
            <Button variant="outline" className="w-48 justify-start text-left font-normal border-primary/20">
              {format(form.startDate, "MMM d, yyyy")}
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-auto p-0 border-primary/20" align="start">
            <Calendar
              mode="single"
              selected={form.startDate}
              onSelect={(d) => d && set("startDate", d)}
              initialFocus
            />
          </PopoverContent>
        </Popover>
      </div>

      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <div>
            <label className="text-sm font-medium text-foreground">End date</label>
            <p className="text-xs text-muted-foreground">Leave off for no end date (runs forever)</p>
          </div>
          <Switch
            checked={form.hasEndDate}
            onCheckedChange={(v) => {
              set("hasEndDate", v);
              if (!v) set("endDate", undefined);
            }}
          />
        </div>

        {form.hasEndDate && (
          <Popover>
            <PopoverTrigger asChild>
              <Button variant="outline" className="w-48 justify-start text-left font-normal border-primary/20">
                {form.endDate ? format(form.endDate, "MMM d, yyyy") : "Pick end date"}
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-auto p-0 border-primary/20" align="start">
              <Calendar
                mode="single"
                selected={form.endDate}
                onSelect={(d) => d && set("endDate", d)}
                disabled={(d) => d < form.startDate}
                initialFocus
              />
            </PopoverContent>
          </Popover>
        )}
      </div>

      <div className="pt-2 flex justify-end gap-3">
        <Button type="button" variant="ghost" onClick={onCancel}>Cancel</Button>
        <Button
          type="submit"
          disabled={!valid || isPending}
          className="bg-primary hover:bg-primary/90 text-primary-foreground"
        >
          {isPending ? "Saving..." : "Save Template"}
        </Button>
      </div>
    </form>
  );
}

function RecurringTaskCard({ task }: { task: RecurringTask }) {
  const [expanded, setExpanded] = useState(false);
  const [editing, setEditing] = useState(false);
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const toggleMutation = useToggleRecurringTask();
  const deleteMutation = useDeleteRecurringTask();
  const updateMutation = useUpdateRecurringTask();

  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: getGetRecurringTasksQueryKey() });

  const handleToggle = () => {
    toggleMutation.mutate({ id: task.id }, {
      onSuccess: (updated) => {
        invalidate();
        toast({ title: updated.isActive ? "Template activated" : "Template paused" });
      },
    });
  };

  const handleDelete = () => {
    deleteMutation.mutate({ id: task.id }, {
      onSuccess: () => { invalidate(); toast({ title: "Template deleted", variant: "destructive" }); },
    });
  };

  const handleSave = (form: TaskFormState) => {
    updateMutation.mutate({
      id: task.id,
      data: {
        title: form.title,
        description: form.description || undefined,
        priority: form.priority as "low" | "medium" | "high",
        daysOfWeek: form.daysOfWeek,
        timeOfDay: form.timeOfDay,
        startDate: format(form.startDate, "yyyy-MM-dd"),
        endDate: form.hasEndDate && form.endDate ? format(form.endDate, "yyyy-MM-dd") : null,
      } as Parameters<typeof updateMutation.mutate>[0]["data"],
    }, {
      onSuccess: () => { invalidate(); setEditing(false); toast({ title: "Template updated" }); },
    });
  };

  if (editing) {
    const initial: TaskFormState = {
      title: task.title,
      description: task.description ?? "",
      priority: task.priority,
      daysOfWeek: task.daysOfWeek,
      timeOfDay: task.timeOfDay,
      startDate: parseISO(task.startDate),
      hasEndDate: !!task.endDate,
      endDate: task.endDate ? parseISO(task.endDate) : undefined,
    };
    return (
      <div className="bg-card border border-primary/30 rounded-xl p-5">
        <h3 className="text-sm font-bold text-primary uppercase tracking-wider mb-4">Edit Template</h3>
        <RecurringTaskForm
          initial={initial}
          onSave={handleSave}
          onCancel={() => setEditing(false)}
          isPending={updateMutation.isPending}
        />
      </div>
    );
  }

  const hasStreak = task.totalCompletions > 0;

  return (
    <div className={`
      bg-card border rounded-xl transition-all duration-200
      ${task.isActive ? "border-border hover:border-primary/40" : "border-border opacity-60"}
      ${task.currentStreak >= 7 ? "shadow-[0_0_12px_rgba(251,146,60,0.15)]" : ""}
    `}>
      <div className="flex items-center gap-4 p-4">
        {/* Active toggle */}
        <button
          onClick={handleToggle}
          disabled={toggleMutation.isPending}
          className="flex-shrink-0 text-muted-foreground hover:text-primary transition-colors"
          title={task.isActive ? "Pause template" : "Activate template"}
        >
          {task.isActive
            ? <ToggleRight className="w-7 h-7 text-primary drop-shadow-[0_0_4px_rgba(0,255,255,0.6)]" />
            : <ToggleLeft className="w-7 h-7" />}
        </button>

        {/* Main info */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <h3 className="font-semibold text-foreground truncate">{task.title}</h3>
            <span className={`text-[10px] px-2 py-0.5 rounded-full border uppercase tracking-wider font-bold ${PRIORITY_COLORS[task.priority]}`}>
              {task.priority}
            </span>
            {!task.isActive && (
              <span className="text-[10px] px-2 py-0.5 rounded-full border border-muted text-muted-foreground uppercase tracking-wider font-bold">
                Paused
              </span>
            )}
          </div>

          <div className="flex items-center gap-4 mt-1.5 text-xs text-muted-foreground flex-wrap">
            <span className="flex items-center gap-1">
              <Repeat className="w-3 h-3" />
              {formatDays(task.daysOfWeek)}
            </span>
            <span className="flex items-center gap-1">
              <Clock className="w-3 h-3" />
              {task.timeOfDay}
            </span>
            <span className="flex items-center gap-1 text-primary font-bold">
              <Zap className="w-3 h-3" />
              {task.estimatedPoints} XP · {task.categoryLabel}
            </span>
          </div>

          {/* Streak row */}
          {hasStreak && (
            <div className="mt-2">
              <StreakBadge
                streak={task.currentStreak}
                longest={task.longestStreak}
                total={task.totalCompletions}
              />
            </div>
          )}
        </div>

        {/* Actions */}
        <div className="flex items-center gap-1 flex-shrink-0">
          <Button variant="ghost" size="icon" onClick={() => setEditing(true)} title="Edit">
            <Edit2 className="w-4 h-4 text-muted-foreground" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            onClick={handleDelete}
            disabled={deleteMutation.isPending}
            className="hover:bg-destructive/20 hover:text-destructive"
            title="Delete template"
          >
            <Trash2 className="w-4 h-4" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setExpanded((v) => !v)}
            className="text-muted-foreground"
          >
            {expanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
          </Button>
        </div>
      </div>

      {/* Expanded details */}
      {expanded && (
        <div className="px-5 pb-4 pt-0 border-t border-border/50 mt-0">
          <div className="pt-3 grid grid-cols-2 gap-4 text-sm">
            {task.description && (
              <div className="col-span-2">
                <span className="text-xs text-muted-foreground uppercase tracking-wider">Details</span>
                <p className="text-foreground mt-0.5">{task.description}</p>
              </div>
            )}
            <div>
              <span className="text-xs text-muted-foreground uppercase tracking-wider">Start date</span>
              <p className="text-foreground mt-0.5">{format(parseISO(task.startDate), "MMM d, yyyy")}</p>
            </div>
            <div>
              <span className="text-xs text-muted-foreground uppercase tracking-wider">End date</span>
              <p className="text-foreground mt-0.5">
                {task.endDate ? format(parseISO(task.endDate), "MMM d, yyyy") : "No end date"}
              </p>
            </div>
            <div>
              <span className="text-xs text-muted-foreground uppercase tracking-wider">Days selected</span>
              <p className="text-foreground mt-0.5">
                {task.daysOfWeek.map((d) => DAYS[d]?.label).join(", ")}
              </p>
            </div>
            {hasStreak && (
              <div>
                <span className="text-xs text-muted-foreground uppercase tracking-wider">Last completed</span>
                <p className="text-foreground mt-0.5">
                  {task.lastCompletedDate
                    ? format(parseISO(task.lastCompletedDate), "MMM d, yyyy")
                    : "—"}
                </p>
              </div>
            )}
          </div>

          {/* Streak details panel */}
          {hasStreak && (
            <div className="mt-4 grid grid-cols-3 gap-3">
              {[
                { label: "Current streak", value: task.currentStreak, icon: <Flame className={`w-4 h-4 ${getStreakColor(task.currentStreak)}`} />, suffix: "days" },
                { label: "Longest streak", value: task.longestStreak, icon: <Trophy className="w-4 h-4 text-amber-400" />, suffix: "days" },
                { label: "Total done", value: task.totalCompletions, icon: <CheckCircle2 className="w-4 h-4 text-primary" />, suffix: "times" },
              ].map((s) => (
                <div key={s.label} className="bg-muted/20 rounded-lg p-3 text-center border border-border/50">
                  <div className="flex justify-center mb-1">{s.icon}</div>
                  <div className="text-lg font-bold text-foreground">{s.value}</div>
                  <div className="text-[10px] text-muted-foreground uppercase tracking-wider">{s.label}</div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default function Recurring() {
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: tasks, isLoading } = useGetRecurringTasks();
  const createMutation = useCreateRecurringTask();

  const activeTasks = tasks?.filter((t) => t.isActive) ?? [];
  const pausedTasks = tasks?.filter((t) => !t.isActive) ?? [];
  const totalStreak = tasks?.reduce((sum, t) => sum + t.currentStreak, 0) ?? 0;
  const topStreak = tasks ? Math.max(0, ...tasks.map((t) => t.currentStreak)) : 0;

  const handleCreate = (form: TaskFormState) => {
    createMutation.mutate({
      data: {
        title: form.title,
        description: form.description || undefined,
        priority: form.priority as "low" | "medium" | "high",
        daysOfWeek: form.daysOfWeek,
        timeOfDay: form.timeOfDay,
        startDate: format(form.startDate, "yyyy-MM-dd"),
        endDate: form.hasEndDate && form.endDate ? format(form.endDate, "yyyy-MM-dd") : undefined,
      },
    }, {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getGetRecurringTasksQueryKey() });
        setIsCreateOpen(false);
        toast({
          title: "Recurring quest created",
          description: "Tasks will appear in your Quest Log automatically.",
          className: "border-primary bg-primary/10",
        });
      },
    });
  };

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      {/* Header */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h1 className="text-3xl font-bold text-foreground">Recurring Quests</h1>
          <p className="text-muted-foreground mt-1">
            Templates that auto-populate your Quest Log on a schedule.
          </p>
        </div>
        <Button
          onClick={() => setIsCreateOpen(true)}
          className="bg-primary hover:bg-primary/90 text-primary-foreground shadow-[0_0_15px_rgba(0,255,255,0.3)]"
        >
          <Plus className="w-5 h-5 mr-2" /> New Template
        </Button>
      </div>

      {/* Stats bar */}
      {tasks && tasks.length > 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          {[
            { label: "Active templates", value: activeTasks.length },
            { label: "Paused", value: pausedTasks.length },
            { label: "🔥 Top streak", value: `${topStreak}d` },
            { label: "Total streak days", value: totalStreak },
          ].map((s) => (
            <div key={s.label} className="bg-card border border-border rounded-xl p-4 text-center">
              <div className="text-2xl font-bold text-foreground">{s.value}</div>
              <div className="text-xs text-muted-foreground uppercase tracking-wider mt-0.5">{s.label}</div>
            </div>
          ))}
        </div>
      )}

      {/* Task list */}
      {isLoading ? (
        Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="h-20 bg-muted/20 animate-pulse rounded-xl border border-border" />
        ))
      ) : tasks && tasks.length > 0 ? (
        <div className="space-y-4">
          {activeTasks.length > 0 && (
            <div className="space-y-3">
              <h2 className="text-xs font-bold uppercase tracking-wider text-muted-foreground flex items-center gap-2">
                <Repeat className="w-3.5 h-3.5 text-primary" /> Active
              </h2>
              {activeTasks.map((t) => <RecurringTaskCard key={t.id} task={t} />)}
            </div>
          )}
          {pausedTasks.length > 0 && (
            <div className="space-y-3 mt-6">
              <h2 className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Paused</h2>
              {pausedTasks.map((t) => <RecurringTaskCard key={t.id} task={t} />)}
            </div>
          )}
        </div>
      ) : (
        <div className="text-center py-24 border-2 border-dashed border-muted rounded-xl bg-card/50">
          <Repeat className="w-14 h-14 text-muted-foreground mx-auto mb-4 opacity-40" />
          <h3 className="text-xl font-bold text-foreground mb-2">No recurring quests yet</h3>
          <p className="text-muted-foreground mb-6 max-w-sm mx-auto">
            Create templates for habits and routines — they'll appear in your Quest Log automatically on the days you choose.
          </p>
          <Button
            onClick={() => setIsCreateOpen(true)}
            className="bg-primary hover:bg-primary/90 text-primary-foreground"
          >
            <Plus className="w-5 h-5 mr-2" /> Create your first template
          </Button>
        </div>
      )}

      {/* Create dialog */}
      <Dialog open={isCreateOpen} onOpenChange={(open) => { if (!open) setIsCreateOpen(false); }}>
        <DialogContent className="sm:max-w-lg bg-card border-primary/30 max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="text-2xl font-bold text-primary">New Recurring Quest</DialogTitle>
          </DialogHeader>
          <div className="mt-4">
            <RecurringTaskForm
              onSave={handleCreate}
              onCancel={() => setIsCreateOpen(false)}
              isPending={createMutation.isPending}
            />
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
