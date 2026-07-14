import { useQueryClient } from "@tanstack/react-query";
import {
  Task, useCompleteTask, usePatchTaskStep,
  getGetTasksQueryKey, getGetMyStatsQueryKey, getGetTasksMomentumQueryKey,
  getGetQuestlinesQueryKey, getGetQuestlineQueryKey, getGetHeroStatusQueryKey,
} from "@workspace/api-client-react";
import { useToast } from "@/hooks/use-toast";
import { initiationToast } from "@/lib/initiation-toast";
import { dispatchQuestCompleted } from "@/components/dopamine-overlay";
import { apiErrorMessage } from "@/lib/api-error";
import { browserTimeZone } from "@/lib/timezone";

/**
 * The one thing a micro-start acts on: the task's first open step, or the
 * whole (stepless) task. Checking off a step fires the existing initiation
 * XP celebration (StepToggleResponse carries `initiationXp`); completing a
 * stepless quest fires the normal quest-completed dopamine beat instead —
 * TaskCompletionResult has no initiationXp field, so there's no award to
 * surface there. Either way this hook adds nothing to the reward math.
 */
export function useMicroStep(task: Task | null) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const patchStep = usePatchTaskStep();
  const completeTask = useCompleteTask();

  const firstOpenStep = task?.steps?.find((s) => !s.done) ?? null;
  const targetLabel = firstOpenStep ? firstOpenStep.text : task?.title ?? "";

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: getGetTasksQueryKey() });
    queryClient.invalidateQueries({ queryKey: getGetMyStatsQueryKey() });
    queryClient.invalidateQueries({ queryKey: getGetTasksMomentumQueryKey() });
  };

  const complete = (onDone?: () => void) => {
    if (!task) return;
    if (firstOpenStep) {
      patchStep.mutate(
        {
          id: task.id,
          stepId: firstOpenStep.id,
          data: { done: true },
          params: { tz: browserTimeZone() },
        },
        {
          onSuccess: (res) => {
            invalidate();
            const t = initiationToast(res.initiationXp);
            if (t) toast({ ...t, className: "border-primary" });
            onDone?.();
          },
          onError: (err: any) => toast({ title: apiErrorMessage(err, "Couldn't check that off"), variant: "destructive" }),
        },
      );
    } else {
      completeTask.mutate(
        { id: task.id },
        {
          onSuccess: () => {
            invalidate();
            // Match task-item.tsx's complete-branch invalidation set: a full
            // quest completion (unlike a step toggle) can move a questline's
            // progress tally and the hero's feed/vitality state.
            queryClient.invalidateQueries({ queryKey: getGetQuestlinesQueryKey() });
            if (task.questlineId != null) {
              queryClient.invalidateQueries({ queryKey: getGetQuestlineQueryKey(task.questlineId) });
            }
            queryClient.invalidateQueries({ queryKey: getGetHeroStatusQueryKey() });
            dispatchQuestCompleted();
            onDone?.();
          },
          onError: (err: any) => toast({ title: apiErrorMessage(err, "Couldn't complete that"), variant: "destructive" }),
        },
      );
    }
  };

  return { targetLabel, isStep: !!firstOpenStep, complete, isPending: patchStep.isPending || completeTask.isPending };
}
