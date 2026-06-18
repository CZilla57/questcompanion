import { useState } from "react";
import { Check, Clock, Edit2, Flame, Pin, PinOff, Shield, Timer, Trash2, Zap } from "lucide-react";
import { format } from "date-fns";
import { Task, TaskPriority, useCompleteTask, useDeleteTask, usePatchTaskFocus, useUncompleteTask, useUpdateTask, useGetMyStats } from "@workspace/api-client-react";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { useToast } from "@/hooks/use-toast";
import { useQueryClient } from "@tanstack/react-query";
import { getGetTasksQueryKey, getGetMyStatsQueryKey } from "@workspace/api-client-react";
import { dispatchQuestCompleted } from "./dopamine-overlay";

interface TaskItemProps {
  task: Task;
  onEdit?: (task: Task) => void;
  onLevelUp?: (result: any) => void;
}

const priorityColors: Record<TaskPriority, string> = {
  [TaskPriority.low]: "bg-green-500/20 text-green-400 border-green-500/30",
  [TaskPriority.medium]: "bg-yellow-500/20 text-yellow-400 border-yellow-500/30",
  [TaskPriority.high]: "bg-red-500/20 text-red-400 border-red-500/30",
};

interface MultiplierDisplay {
  label: string;
  pct: number;
  tier: "warming" | "focused" | "driven" | "elite";
}

function getMultiplierDisplay(streakDays: number): MultiplierDisplay | null {
  if (streakDays >= 30) return { label: "1.15×", pct: 15, tier: "elite" };
  if (streakDays >= 21) return { label: "1.10×", pct: 10, tier: "driven" };
  if (streakDays >= 14) return { label: "1.08×", pct: 8,  tier: "focused" };
  if (streakDays >= 7)  return { label: "1.05×", pct: 5,  tier: "warming" };
  return null;
}

const tierStyles: Record<NonNullable<MultiplierDisplay["tier"]>, string> = {
  warming: "bg-cyan-500/10 border-cyan-500/30 text-cyan-400 shadow-[0_0_6px_rgba(0,255,255,0.2)]",
  focused: "bg-cyan-400/15 border-cyan-400/40 text-cyan-300 shadow-[0_0_8px_rgba(0,255,255,0.3)]",
  driven:  "bg-violet-500/15 border-violet-400/40 text-violet-300 shadow-[0_0_8px_rgba(139,92,246,0.35)]",
  elite:   "bg-amber-500/15 border-amber-400/40 text-amber-300 shadow-[0_0_10px_rgba(251,191,36,0.4)]",
};

function formatMinutes(minutes: number): string {
  if (minutes < 60) return `${minutes}m`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m > 0 ? `${h}h ${m}m` : `${h}h`;
}

export function TaskItem({ task, onEdit, onLevelUp }: TaskItemProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [loggingTime, setLoggingTime] = useState(false);
  const [actualInput, setActualInput] = useState(task.actualMinutes ? String(task.actualMinutes) : "");

  const { data: stats } = useGetMyStats();
  const multiplier = !task.completed && stats ? getMultiplierDisplay(stats.streakDays) : null;

  const completeMutation = useCompleteTask();
  const uncompleteMutation = useUncompleteTask();
  const deleteMutation = useDeleteTask();
  const updateMutation = useUpdateTask();
  const focusMutation = usePatchTaskFocus();

  const todayStr = new Date().toISOString().split("T")[0];
  const isPinned = task.isDailyFocus && task.focusDate === todayStr;

  const handleToggleFocus = () => {
    focusMutation.mutate({ id: task.id, data: { pin: !isPinned } }, {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getGetTasksQueryKey() });
        toast({
          title: isPinned ? "Quest unpinned" : "Quest pinned to Today's Focus",
          className: isPinned ? "" : "border-primary bg-primary/10",
        });
      },
      onError: (err: any) => {
        const msg = err?.response?.data?.error ?? err?.message ?? "Could not update focus";
        toast({ title: msg, variant: "destructive" });
      },
    });
  };

  const handleToggle = () => {
    if (task.completed) {
      uncompleteMutation.mutate({ id: task.id }, {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getGetTasksQueryKey() });
          queryClient.invalidateQueries({ queryKey: getGetMyStatsQueryKey() });
        }
      });
    } else {
      completeMutation.mutate({ id: task.id }, {
        onSuccess: (res) => {
          queryClient.invalidateQueries({ queryKey: getGetTasksQueryKey() });
          queryClient.invalidateQueries({ queryKey: getGetMyStatsQueryKey() });

          const descParts: string[] = [];
          if ((res.streakBonus ?? 0) > 0) {
            const pct = Math.round(((res.xpMultiplier ?? 1) - 1) * 100);
            descParts.push(`+${res.streakBonus} streak bonus (${pct}% curve)`);
          }
          if (res.bonusAwarded) {
            descParts.push(`All tasks done! +${res.bonusPoints} bonus`);
          }
          if (res.focusBonusAwarded) {
            descParts.push(`All focus quests done! +${res.focusBonusPoints} focus bonus`);
          }
          const description = descParts.length > 0 ? descParts.join(" · ") : task.title;

          toast({
            title: `Quest Complete! +${res.pointsAwarded} XP`,
            description,
            className: "border-primary bg-primary/10 text-primary-foreground",
          });

          if (res.gearReward) {
            const rarityStyles: Record<string, string> = {
              legendary: "border-amber-400 bg-amber-500/10 text-amber-300",
              epic:      "border-violet-400 bg-violet-500/10 text-violet-300",
              rare:      "border-blue-400 bg-blue-500/10 text-blue-300",
              common:    "border-slate-400 bg-slate-500/10 text-slate-300",
            };
            const styleClass = rarityStyles[res.gearReward.rarity] ?? rarityStyles.common;
            toast({
              title: `${res.gearReward.icon} Gear Reward Unlocked!`,
              description: `${res.gearReward.name} (${res.gearReward.rarity}) — equip it on your Hero page`,
              className: `border ${styleClass}`,
            });
          }

          if (res.surpriseReward) {
            if (res.surpriseReward.type === "xp") {
              toast({
                title: `✨ Surprise! +${res.surpriseReward.xpAmount} Bonus XP`,
                description: "A lucky drop from completing your quest!",
                className: "border-yellow-400 bg-yellow-500/10 text-yellow-300",
              });
            } else if (res.surpriseReward.type === "gear" && res.surpriseReward.gear) {
              const rarityStyles: Record<string, string> = {
                legendary: "border-amber-400 bg-amber-500/10 text-amber-300",
                epic:      "border-violet-400 bg-violet-500/10 text-violet-300",
                rare:      "border-blue-400 bg-blue-500/10 text-blue-300",
                common:    "border-slate-400 bg-slate-500/10 text-slate-300",
              };
              const g = res.surpriseReward.gear;
              toast({
                title: `🎲 Surprise Drop! ${g.icon} ${g.name}`,
                description: `A random ${g.rarity} item appeared — check your Hero page!`,
                className: `border ${rarityStyles[g.rarity] ?? rarityStyles.common}`,
              });
            }
          }

          if (res.leveledUp || (res.newBadges && res.newBadges.length > 0)) {
            onLevelUp?.(res);
          }

          dispatchQuestCompleted();
        }
      });
    }
  };

  const handleDelete = () => {
    deleteMutation.mutate({ id: task.id }, {
      onSuccess: () => {
        toast({ title: "Quest abandoned", variant: "destructive" });
        queryClient.invalidateQueries({ queryKey: getGetTasksQueryKey() });
      }
    });
  };

  const handleSaveActualTime = () => {
    const mins = parseInt(actualInput, 10);
    if (!actualInput || isNaN(mins) || mins < 1) {
      setLoggingTime(false);
      return;
    }
    updateMutation.mutate({ id: task.id, data: { actualMinutes: mins } }, {
      onSuccess: () => {
        toast({ title: `⏱ Time logged: ${formatMinutes(mins)}`, className: "border-primary bg-primary/10" });
        setLoggingTime(false);
        queryClient.invalidateQueries({ queryKey: getGetTasksQueryKey() });
      }
    });
  };

  const isBusy = completeMutation.isPending || uncompleteMutation.isPending;

  const hasEstimate = !!task.estimatedMinutes;
  const hasActual = !!task.actualMinutes;

  return (
    <div className={`
      relative group flex items-start gap-4 p-4 rounded-xl border transition-all duration-300
      ${task.completed
        ? "bg-muted/30 border-muted opacity-70"
        : "bg-card border-border hover:border-primary/50 hover:shadow-[0_0_15px_rgba(0,255,255,0.1)]"}
    `}>
      {/* Complete toggle */}
      <button
        onClick={handleToggle}
        disabled={isBusy}
        aria-label={task.completed ? "Mark quest incomplete" : "Complete quest"}
        className={`
          flex-shrink-0 w-10 h-10 mt-0.5 rounded-full border-2 flex items-center justify-center
          transition-all duration-300 cursor-pointer
          ${task.completed
            ? "bg-primary border-primary text-background neon-glow"
            : "border-muted-foreground/40 hover:border-primary hover:bg-primary/10 active:scale-95"}
        `}
      >
        {task.completed && <Check className="w-5 h-5" />}
      </button>

      {/* Content */}
      <div className="flex-1 min-w-0">
        <h4 className={`font-semibold truncate transition-colors ${task.completed ? "line-through text-muted-foreground" : "text-foreground"}`}>
          {task.title}
        </h4>
        {task.description && (
          <p className="text-sm text-muted-foreground truncate">{task.description}</p>
        )}

        <div className="flex items-center gap-3 mt-2 flex-wrap">
          <div className="flex items-center gap-1 text-xs text-muted-foreground">
            <Clock className="w-3 h-3" />
            <span>{format(new Date(task.dueDate), 'MMM d, yyyy')}</span>
          </div>

          <div className="flex items-center gap-1.5">
            <div className="flex items-center gap-1 text-xs font-bold text-primary">
              <Flame className="w-3 h-3" />
              <span>{task.points} XP</span>
            </div>
            {multiplier && (
              <span
                title={`${multiplier.pct}% streak difficulty curve active`}
                className={`inline-flex items-center gap-0.5 text-[10px] font-bold px-1.5 py-0.5 rounded-full border transition-all ${tierStyles[multiplier.tier]}`}
              >
                <Zap className="w-2.5 h-2.5" />
                {multiplier.label}
              </span>
            )}
          </div>

          <span className={`text-[10px] px-2 py-0.5 rounded-full border uppercase tracking-wider font-bold ${priorityColors[task.priority]}`}>
            {task.priority}
          </span>

          {/* Time badges */}
          {!task.completed && hasEstimate && (
            <span className="inline-flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full border border-sky-500/30 bg-sky-500/10 text-sky-400 font-medium">
              <Timer className="w-2.5 h-2.5" />
              ~{formatMinutes(task.estimatedMinutes!)}
            </span>
          )}

          {task.completed && (
            <span className="inline-flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full border border-emerald-500/30 bg-emerald-500/10 text-emerald-400 font-medium">
              <Timer className="w-2.5 h-2.5" />
              {hasActual && hasEstimate
                ? `${formatMinutes(task.actualMinutes!)} / ~${formatMinutes(task.estimatedMinutes!)}`
                : hasActual
                  ? formatMinutes(task.actualMinutes!)
                  : hasEstimate
                    ? `~${formatMinutes(task.estimatedMinutes!)}`
                    : "No time logged"}
            </span>
          )}
        </div>

        {/* Log actual time — inline input for completed tasks */}
        {task.completed && loggingTime && (
          <div className="mt-3 flex items-center gap-2">
            <div className="relative flex-1 max-w-[160px]">
              <Timer className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground pointer-events-none" />
              <Input
                type="number"
                min={1}
                max={1440}
                value={actualInput}
                onChange={(e) => setActualInput(e.target.value)}
                placeholder="minutes"
                className="pl-8 pr-10 h-8 text-sm border-primary/30 focus:border-primary"
                autoFocus
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleSaveActualTime();
                  if (e.key === "Escape") setLoggingTime(false);
                }}
              />
              <span className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[10px] text-muted-foreground">min</span>
            </div>
            <Button
              size="sm"
              className="h-8 px-3 text-xs bg-primary hover:bg-primary/90"
              onClick={handleSaveActualTime}
              disabled={updateMutation.isPending}
            >
              {updateMutation.isPending ? "..." : "Save"}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              className="h-8 px-2 text-xs"
              onClick={() => setLoggingTime(false)}
            >
              Cancel
            </Button>
          </div>
        )}
      </div>

      {/* Actions — always visible on mobile, hover-reveal on desktop */}
      <div className="flex items-center gap-1 md:opacity-0 md:group-hover:opacity-100 transition-opacity flex-shrink-0 mt-0.5">
        {!task.completed && (
          <Button
            variant="ghost"
            size="icon"
            aria-label={isPinned ? "Unpin from Today's Focus" : "Pin to Today's Focus"}
            title={isPinned ? "Unpin from Today's Focus" : "Pin to Today's Focus"}
            className={`h-9 w-9 cursor-pointer ${isPinned ? "text-primary" : "text-muted-foreground hover:text-primary"}`}
            onClick={handleToggleFocus}
            disabled={focusMutation.isPending}
          >
            {isPinned ? <PinOff className="w-4 h-4" /> : <Pin className="w-4 h-4" />}
          </Button>
        )}
        {task.completed && !loggingTime && (
          <Button
            variant="ghost"
            size="icon"
            aria-label="Log actual time"
            title={hasActual ? "Edit logged time" : "Log how long this took"}
            className="h-9 w-9 cursor-pointer"
            onClick={() => { setActualInput(task.actualMinutes ? String(task.actualMinutes) : ""); setLoggingTime(true); }}
          >
            <Timer className="w-4 h-4 text-sky-400" />
          </Button>
        )}
        {onEdit && !task.completed && (
          <Button
            variant="ghost"
            size="icon"
            aria-label="Edit quest"
            className="h-9 w-9 cursor-pointer"
            onClick={() => onEdit(task)}
          >
            <Edit2 className="w-4 h-4 text-muted-foreground" />
          </Button>
        )}
        <Button
          variant="ghost"
          size="icon"
          aria-label="Delete quest"
          className="h-9 w-9 cursor-pointer hover:bg-destructive/20 hover:text-destructive"
          onClick={handleDelete}
          disabled={deleteMutation.isPending}
        >
          <Trash2 className="w-4 h-4" />
        </Button>
      </div>
    </div>
  );
}
