import { useEffect, useState } from "react";
import { Clock, LifeBuoy, Pin, RefreshCw, Sparkles, Check, Play, X } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import {
  MomentumSuggestion, usePatchTaskFocus,
  getGetTasksQueryKey, getGetTasksMomentumQueryKey,
} from "@workspace/api-client-react";
import { Button } from "./ui/button";
import { useToast } from "@/hooks/use-toast";
import { apiErrorMessage } from "@/lib/api-error";
import { CATEGORY_COLORS } from "@/lib/categories";
import { formatClock, MICRO_START_SECONDS } from "@/lib/countdown";
import { useCountdown } from "@/hooks/use-countdown";
import { useMicroStep } from "@/hooks/use-micro-step";
import { RescueSheet } from "./rescue-sheet";

export const MINUTES_CHOICES = [5, 15, 30, 60] as const;

export function MomentumCard({ suggestion, minutes, onMinutes, onSkip, skipping }: {
  suggestion: MomentumSuggestion;
  minutes: number | null;
  onMinutes: (m: number | null) => void;
  onSkip: () => void;
  skipping: boolean;
}) {
  const task = suggestion.task;
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const focusMutation = usePatchTaskFocus();
  const [rescueOpen, setRescueOpen] = useState(false);
  const [clock, dispatch] = useCountdown();
  const { targetLabel, complete, isPending } = useMicroStep(task);

  // A new suggestion resets any in-flight micro-start.
  useEffect(() => { dispatch({ type: "reset" }); }, [task.id]);

  const todayStr = new Date().toISOString().split("T")[0];
  const isPinned = task.isDailyFocus && task.focusDate === todayStr;

  const handlePin = () => {
    focusMutation.mutate({ id: task.id, data: { pin: true } }, {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getGetTasksQueryKey() });
        queryClient.invalidateQueries({ queryKey: getGetTasksMomentumQueryKey() });
        toast({ title: "Pinned to Today's Focus", className: "border-primary" });
      },
      onError: (err: any) => toast({ title: apiErrorMessage(err, "Could not pin"), variant: "destructive" }),
    });
  };

  const catStyle = CATEGORY_COLORS[task.category ?? "default"] ?? CATEGORY_COLORS.default!;

  return (
    <div className="rounded-xl border border-primary/50 bg-primary/5 shadow-[0_0_20px_rgba(0,255,255,0.08)]">
      <div className="flex items-center justify-between px-4 pt-3 pb-0">
        <div className="flex items-center gap-2">
          <Sparkles className="w-3.5 h-3.5 text-primary" />
          <span className="text-[10px] font-bold uppercase tracking-[0.15em] text-primary">Next tiny win</span>
        </div>
        {/* "How long do you have?" chips */}
        <div className="flex items-center gap-1">
          {MINUTES_CHOICES.map((m) => (
            <button key={m} onClick={() => onMinutes(minutes === m ? null : m)}
              className={`text-[10px] px-1.5 py-0.5 rounded-full border transition-colors ${minutes === m ? "border-primary text-primary bg-primary/10" : "border-border text-muted-foreground hover:border-primary/40"}`}>
              {m}m
            </button>
          ))}
        </div>
      </div>

      <div className="px-4 py-3">
        <h3 className="text-lg font-bold text-foreground leading-snug mb-1.5">{task.title}</h3>
        <div className="flex flex-wrap items-center gap-2 mb-2">
          {task.categoryLabel && (
            <span className={`text-xs font-medium px-2 py-0.5 rounded-full border ${catStyle}`}>{task.categoryLabel}</span>
          )}
          {task.estimatedMinutes && (
            <span className="text-xs text-muted-foreground flex items-center gap-1">
              <Clock className="w-3 h-3" />{task.estimatedMinutes}m
            </span>
          )}
        </div>
        <p className="text-xs text-muted-foreground leading-relaxed mb-3 italic">"{suggestion.reason}"</p>

        {clock.status !== "idle" ? (
          <div className="flex items-center justify-between rounded-lg border border-primary/30 bg-background/40 px-3 py-2 mb-1">
            <div className="min-w-0">
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Two minutes on</p>
              <p className="text-sm font-medium truncate">{targetLabel}</p>
            </div>
            <div className="flex items-center gap-2 flex-shrink-0">
              <span className="font-mono text-primary text-lg" aria-live="polite">
                {clock.status === "zero" ? "Still going ✦" : formatClock(clock.remaining)}
              </span>
              <Button size="sm" onClick={() => { complete(); dispatch({ type: "reset" }); }} disabled={isPending} className="h-7 gap-1">
                <Check className="w-3.5 h-3.5" /> Did it
              </Button>
              <Button size="icon" variant="ghost" onClick={() => dispatch({ type: "reset" })} aria-label="Stop micro-start" className="h-7 w-7 text-muted-foreground">
                <X className="w-3.5 h-3.5" />
              </Button>
            </div>
          </div>
        ) : (
          <div className="flex items-center gap-1.5 flex-wrap">
            <Button size="sm" onClick={() => dispatch({ type: "start", seconds: MICRO_START_SECONDS })} className="h-8 gap-1.5">
              <Play className="w-3.5 h-3.5" /> Start (2 min)
            </Button>
            <Button size="sm" variant="ghost" onClick={onSkip} disabled={skipping} className="h-8 gap-1.5 text-muted-foreground">
              <RefreshCw className={`w-3.5 h-3.5 ${skipping ? "animate-spin" : ""}`} /> Not this one
            </Button>
            {!isPinned && (
              <Button size="sm" variant="ghost" onClick={handlePin} className="h-8 gap-1.5 text-muted-foreground">
                <Pin className="w-3.5 h-3.5" /> Pin it
              </Button>
            )}
            <Button size="sm" variant="ghost" onClick={() => setRescueOpen(true)} className="h-8 gap-1.5 text-muted-foreground">
              <LifeBuoy className="w-3.5 h-3.5" /> I'm stuck
            </Button>
          </div>
        )}
      </div>
      <RescueSheet task={task} open={rescueOpen} onOpenChange={setRescueOpen} />
    </div>
  );
}
