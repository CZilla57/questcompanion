import { Feather, TrendingDown, TrendingUp } from "lucide-react";
import type { Task } from "@workspace/api-client-react";
import { useDifficulty } from "@/hooks/use-difficulty";
import { Button } from "./ui/button";

export function DifficultyControls({ task }: { task: Task }) {
  const { apply, snooze, isBusy, canEasier, canHarder } = useDifficulty(task);

  return (
    <div className="mt-2 flex flex-col gap-2">
      <div className="flex items-center gap-1">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          disabled={!canEasier || isBusy}
          onClick={() => apply("easy")}
          aria-label="Make this quest easier"
          className="h-7 px-2 gap-1.5 text-xs text-muted-foreground hover:text-primary hover:bg-primary/10"
        >
          <TrendingDown className="w-3.5 h-3.5" />
          Easier
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          disabled={!canHarder || isBusy}
          onClick={() => apply("hard")}
          aria-label="Make this quest harder"
          className="h-7 px-2 gap-1.5 text-xs text-muted-foreground hover:text-primary hover:bg-primary/10"
        >
          <TrendingUp className="w-3.5 h-3.5" />
          Harder
        </Button>
      </div>

      {task.difficultyOfferable && (
        <div className="flex items-center gap-2 flex-wrap rounded-lg border border-primary/15 bg-primary/[0.03] px-3 py-2">
          <Feather className="w-3.5 h-3.5 text-primary flex-shrink-0" />
          <span className="text-xs text-muted-foreground flex-1 min-w-[160px]">
            This one keeps sliding — want a smaller version?
          </span>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={isBusy}
            onClick={() => apply("easy")}
            className="h-7 px-2 text-xs font-medium text-primary hover:bg-primary/10"
          >
            Make it smaller
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={isBusy}
            onClick={() => snooze()}
            className="h-7 px-2 text-xs text-muted-foreground hover:text-foreground"
          >
            Not now
          </Button>
        </div>
      )}
    </div>
  );
}
