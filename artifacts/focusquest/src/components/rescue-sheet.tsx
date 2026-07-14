import { useEffect, useState } from "react";
import { Check, LifeBuoy } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import {
  Task, useBreakdownTask, useCreateRescueEvent, useGetTasksMomentum,
  getGetTasksQueryKey, getGetTasksMomentumQueryKey,
} from "@workspace/api-client-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "./ui/dialog";
import { Button } from "./ui/button";
import { useToast } from "@/hooks/use-toast";
import { apiErrorMessage } from "@/lib/api-error";
import { browserTimeZone } from "@/lib/timezone";
import { formatClock, MICRO_START_SECONDS } from "@/lib/countdown";
import { useCountdown } from "@/hooks/use-countdown";
import { useMicroStep } from "@/hooks/use-micro-step";
import { useEmergencyMode } from "./emergency-mode";

type Blocker = "too_big" | "cant_start" | "overwhelmed" | "wrong_quest";
// Mirrors the generated RescueEventRequestIntervention literal union
// (api.schemas.ts) — hand-rolled here to match the local Blocker convention
// rather than importing the generated enum object.
type Intervention = "breakdown" | "micro_start" | "emergency_mode" | "reroll";

const OPTIONS: { blocker: Blocker; label: string; hint: string }[] = [
  { blocker: "too_big",     label: "It's too big",                          hint: "Break it into first steps" },
  { blocker: "cant_start",  label: "I can't make myself start",             hint: "Two minutes on the smallest piece" },
  { blocker: "overwhelmed", label: "Too much everything",                   hint: "Hide it all — one thing only" },
  { blocker: "wrong_quest", label: "This isn't the right quest right now",  hint: "Show me something else" },
];

export function RescueSheet({ task, open, onOpenChange }: {
  task: Task;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const tz = browserTimeZone();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { enter } = useEmergencyMode();
  const breakdown = useBreakdownTask();
  const logEvent = useCreateRescueEvent();
  const [view, setView] = useState<"picker" | "micro" | "reroll">("picker");
  const [clock, dispatch] = useCountdown();
  // Breakdown returns the task WITH its fresh steps — micro-start must target
  // the new step 1, not the stale prop snapshot.
  const [freshTask, setFreshTask] = useState<Task | null>(null);
  const { targetLabel, complete, isPending } = useMicroStep(freshTask ?? task);

  // Lazy alternative fetch, only for the wrong_quest path. The generated
  // UseQueryOptions requires an explicit queryKey alongside `enabled` (unlike
  // a plain react-query useQuery call, which derives it implicitly) — match
  // the pattern already used at partner-detail.tsx / partners.tsx / questline-detail.tsx.
  const momentumParams = { tz, exclude: String(task.id) };
  const { data: alt, refetch: fetchAlt, isFetching: altLoading } = useGetTasksMomentum(
    momentumParams,
    { query: { enabled: false, queryKey: getGetTasksMomentumQueryKey(momentumParams) } },
  );

  useEffect(() => {
    if (!open) { setView("picker"); setFreshTask(null); dispatch({ type: "reset" }); }
  }, [open]);

  // Fire-and-forget: intervention success is what matters; logging must never block.
  const log = (blocker: Blocker, intervention: Intervention) => {
    logEvent.mutate({ data: { taskId: task.id, blocker, intervention } }, { onError: () => {} });
  };

  const pick = (blocker: Blocker) => {
    switch (blocker) {
      case "too_big":
        breakdown.mutate({ id: task.id }, {
          onSuccess: (res: Task) => {
            log("too_big", "breakdown");
            queryClient.invalidateQueries({ queryKey: getGetTasksQueryKey() });
            queryClient.invalidateQueries({ queryKey: getGetTasksMomentumQueryKey() });
            // Spec: spotlight step 1 with a 2-minute offer — flow straight into
            // the micro view against the response's fresh steps.
            setFreshTask(res);
            setView("micro");
            dispatch({ type: "start", seconds: MICRO_START_SECONDS });
            toast({ title: "Broken into steps — step 1 is all that matters.", className: "border-primary" });
          },
          onError: (err: any) => toast({ title: apiErrorMessage(err, "Couldn't generate steps right now"), variant: "destructive" }),
        });
        break;
      case "cant_start":
        log("cant_start", "micro_start");
        setView("micro");
        dispatch({ type: "start", seconds: MICRO_START_SECONDS });
        break;
      case "overwhelmed":
        log("overwhelmed", "emergency_mode");
        onOpenChange(false);
        enter();
        break;
      case "wrong_quest":
        log("wrong_quest", "reroll");
        setView("reroll");
        void fetchAlt();
        break;
    }
  };

  const altTask = alt?.suggestions?.[0]?.task ?? null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md bg-card border-primary/30">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-lg">
            <LifeBuoy className="w-5 h-5 text-primary" /> What's in the way?
          </DialogTitle>
        </DialogHeader>

        {view === "picker" && (
          <div className="space-y-2 mt-2">
            <p className="text-xs text-muted-foreground truncate">Stuck on: {task.title}</p>
            {OPTIONS.map((o) => (
              <button key={o.blocker} onClick={() => pick(o.blocker)}
                disabled={breakdown.isPending}
                className="w-full text-left px-3 py-2.5 rounded-lg border border-border hover:border-primary/40 hover:bg-muted transition-colors">
                <span className="text-sm font-medium block">{o.label}</span>
                <span className="text-xs text-muted-foreground">{o.hint}</span>
              </button>
            ))}
          </div>
        )}

        {view === "micro" && (
          <div className="space-y-4 mt-2 text-center">
            <p className="text-sm text-muted-foreground">Just this, just for two minutes:</p>
            <p className="text-base font-semibold">{targetLabel}</p>
            <div className="text-4xl font-mono text-primary" aria-live="polite">
              {clock.status === "zero" ? (
                <span className="text-lg font-sans text-foreground">Still going? Take your time.</span>
              ) : formatClock(clock.remaining)}
            </div>
            <div className="flex flex-col gap-2">
              <Button onClick={() => { complete(); onOpenChange(false); }} disabled={isPending} className="gap-2">
                <Check className="w-4 h-4" /> Did it
              </Button>
              {clock.status === "zero" && (
                <Button variant="secondary" onClick={() => dispatch({ type: "restart" })}>Two more minutes</Button>
              )}
              <Button variant="ghost" onClick={() => onOpenChange(false)}>Close</Button>
            </div>
          </div>
        )}

        {view === "reroll" && (
          <div className="space-y-3 mt-2">
            {altLoading ? (
              <p className="text-sm text-muted-foreground">Looking for a better fit…</p>
            ) : altTask ? (
              <>
                <p className="text-xs text-muted-foreground">Try this instead:</p>
                <div className="rounded-lg border border-primary/30 bg-primary/5 p-3">
                  <p className="text-sm font-semibold">{altTask.title}</p>
                  {alt?.suggestions?.[0]?.reason && (
                    <p className="text-xs text-muted-foreground italic mt-1">"{alt.suggestions[0].reason}"</p>
                  )}
                </div>
                <Button className="w-full" onClick={() => onOpenChange(false)}>Sounds good</Button>
              </>
            ) : (
              <p className="text-sm text-muted-foreground">That's the whole list right now — and doing nothing for a bit is allowed too.</p>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
