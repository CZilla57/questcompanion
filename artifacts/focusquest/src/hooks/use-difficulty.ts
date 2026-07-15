import { useQueryClient } from "@tanstack/react-query";
import {
  Task, useApplyDifficulty, useSnoozeDifficultyOffer,
  getGetTasksQueryKey, getGetTasksMomentumQueryKey,
} from "@workspace/api-client-react";
import { useToast } from "@/hooks/use-toast";
import { apiErrorMessage } from "@/lib/api-error";

type Level = "easy" | "medium" | "hard";

/**
 * Manual easier/harder controls + offer actions for one quest. Any success is a
 * task mutation, so it invalidates BOTH the tasks and momentum query keys
 * (momentum never refetches on focus — Act III invariant).
 */
export function useDifficulty(task: Task | null) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const apply = useApplyDifficulty();
  const snooze = useSnoozeDifficultyOffer();

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: getGetTasksQueryKey() });
    queryClient.invalidateQueries({ queryKey: getGetTasksMomentumQueryKey() });
  };

  const current = (task?.difficulty ?? "medium") as Level;

  const applyLevel = (level: Level) => {
    if (!task) return;
    apply.mutate(
      { id: task.id, data: { level } },
      {
        onSuccess: () => invalidate(),
        onError: (err: any) => toast({ title: apiErrorMessage(err, "Couldn't change difficulty"), variant: "destructive" }),
      },
    );
  };

  const snoozeOffer = () => {
    if (!task) return;
    snooze.mutate(
      { id: task.id },
      { onSuccess: () => invalidate(), onError: () => invalidate() },
    );
  };

  return {
    apply: applyLevel,
    snooze: snoozeOffer,
    isBusy: apply.isPending || snooze.isPending,
    canEasier: current !== "easy",
    canHarder: current !== "hard",
  };
}
