import { Sparkles, RefreshCw, MoreVertical, Trash2, ListTree } from "lucide-react";
import {
  Task,
  useBreakdownTask,
  usePatchTaskStep,
  useDeleteTaskSteps,
  getGetTasksQueryKey,
  getGetMyStatsQueryKey,
  getGetTasksMomentumQueryKey,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "./ui/button";
import { Checkbox } from "./ui/checkbox";
import { Progress } from "./ui/progress";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "./ui/dropdown-menu";
import { useToast } from "@/hooks/use-toast";
import { initiationToast } from "@/lib/initiation-toast";
import { browserTimeZone } from "@/lib/timezone";

function breakdownErrorMessage(err: any): string {
  const status = err?.status;
  if (status === 503) return "AI breakdown isn't set up yet.";
  if (status === 429) return "Give it a moment before generating another breakdown.";
  if (status === 502) return "Couldn't generate a breakdown — try again.";
  return err?.data?.error ?? "Something went wrong.";
}

export function TaskSteps({ task }: { task: Task }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const breakdownMutation = useBreakdownTask();
  const patchStepMutation = usePatchTaskStep();
  const deleteStepsMutation = useDeleteTaskSteps();

  const steps = task.steps ?? [];
  const doneCount = steps.filter((s) => s.done).length;
  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: getGetTasksQueryKey() });

  const handleBreakdown = () => {
    breakdownMutation.mutate(
      { id: task.id },
      {
        onSuccess: () => invalidate(),
        onError: (err) => toast({ title: breakdownErrorMessage(err), variant: "destructive" }),
      },
    );
  };

  const handleToggle = (stepId: number, done: boolean) => {
    patchStepMutation.mutate(
      { id: task.id, stepId, data: { done }, params: { tz: browserTimeZone() } },
      {
        onSuccess: (res) => {
          invalidate();
          queryClient.invalidateQueries({ queryKey: getGetTasksMomentumQueryKey() });
          queryClient.invalidateQueries({ queryKey: getGetMyStatsQueryKey() });
          const t = initiationToast(res.initiationXp);
          if (t) toast({ ...t, className: "border-primary" });
        },
        onError: () =>
          toast({ title: "Couldn't update that step — try again.", variant: "destructive" }),
      },
    );
  };

  const handleRemove = () => {
    deleteStepsMutation.mutate(
      { id: task.id },
      {
        onSuccess: () => {
          invalidate();
          toast({ title: "Breakdown removed" });
        },
        onError: () =>
          toast({ title: "Couldn't remove the breakdown — try again.", variant: "destructive" }),
      },
    );
  };

  // No steps yet: offer to break it down (incomplete quests only).
  if (steps.length === 0) {
    if (task.completed) return null;
    return (
      <div className="mt-3">
        <Button
          variant="ghost"
          size="sm"
          onClick={handleBreakdown}
          disabled={breakdownMutation.isPending}
          className="h-7 px-2 gap-1.5 text-xs text-primary/80 hover:text-primary hover:bg-primary/10"
        >
          {breakdownMutation.isPending ? (
            <RefreshCw className="w-3.5 h-3.5 animate-spin" />
          ) : (
            <Sparkles className="w-3.5 h-3.5" />
          )}
          Break it down
        </Button>
      </div>
    );
  }

  const pct = Math.round((doneCount / steps.length) * 100);
  const allDone = doneCount === steps.length;

  return (
    <div className="mt-3 rounded-lg border border-primary/15 bg-primary/[0.03] p-3">
      <div className="flex items-center gap-2 mb-2">
        <ListTree className="w-3.5 h-3.5 text-primary" />
        <span className="text-[10px] font-bold uppercase tracking-[0.15em] text-primary flex-1">
          First steps · {doneCount}/{steps.length}
        </span>
        {!task.completed && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                aria-label="Step options"
                className="h-6 w-6 text-muted-foreground hover:text-foreground"
              >
                <MoreVertical className="w-3.5 h-3.5" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={handleBreakdown} disabled={breakdownMutation.isPending}>
                <RefreshCw className="w-3.5 h-3.5 mr-2" /> Regenerate
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={handleRemove}
                className="text-destructive focus:text-destructive"
              >
                <Trash2 className="w-3.5 h-3.5 mr-2" /> Remove
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>

      <Progress value={pct} className="h-1.5 mb-3" />

      <ul className="space-y-1.5">
        {steps.map((step) => (
          <li key={step.id} className="flex items-start gap-2">
            <Checkbox
              id={`step-${step.id}`}
              checked={step.done}
              disabled={task.completed || patchStepMutation.isPending}
              onCheckedChange={(v) => handleToggle(step.id, v === true)}
              className="mt-0.5"
            />
            <label
              htmlFor={`step-${step.id}`}
              className={`text-sm leading-snug cursor-pointer ${
                step.done ? "line-through text-muted-foreground" : "text-foreground"
              }`}
            >
              {step.text}
            </label>
          </li>
        ))}
      </ul>

      {allDone && !task.completed && (
        <p className="text-[11px] text-primary/80 mt-2.5 italic">
          All steps done — ready to complete the quest?
        </p>
      )}
    </div>
  );
}
