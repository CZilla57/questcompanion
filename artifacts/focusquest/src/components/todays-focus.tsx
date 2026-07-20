// artifacts/focusquest/src/components/todays-focus.tsx
// The momentum block, shared by / (suggestion only) and /tasks (with pinned
// rail). Extracted from pages/tasks.tsx; rendering and copy unchanged.
import { Target, Pin, Zap } from "lucide-react";
import { Task, BrainMode } from "@workspace/api-client-react";
import { MomentumCard } from "@/components/momentum-card";
import { TaskItem } from "@/components/task-item";
import { momentumBoardState } from "@/lib/momentum-board";
import { MODE_META } from "@/lib/brain-mode-meta";
import { inWindowNow } from "@/lib/steering";
import { formatPowerHours } from "@/lib/rhythms";
import { useMomentumBoard } from "@/hooks/use-momentum-board";

export function TodaysFocus({ tasks, showPinned, onEditTask }: {
  tasks: Task[]; showPinned: boolean; onEditTask?: (t: Task) => void;
}) {
  const { momentum, momentumLoading, patterns, momentumMinutes, setMinutes, handleSkip, visibleSuggestions, todayStrKey } = useMomentumBoard();
  const board = momentumBoardState(tasks, visibleSuggestions, todayStrKey);
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
        {showPinned && board.pinned.length > 0 && (
          <div className="space-y-2 pl-1 border-l-2 border-primary/30">
            {board.pinned.map((task) => (
              <TaskItem key={task.id} task={task} onEdit={onEditTask} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
