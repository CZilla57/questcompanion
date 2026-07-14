import { createContext, useContext, useEffect, useMemo, useState } from "react";
import { Task, useGetTasksMomentum, useCreateBrainCheckin, BrainMode, getGetBrainStateQueryKey } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "./ui/button";
import { X, Check, LifeBuoy } from "lucide-react";
import { browserTimeZone } from "@/lib/timezone";
import { formatClock, MICRO_START_SECONDS } from "@/lib/countdown";
import { useCountdown } from "@/hooks/use-countdown";
import { useMicroStep } from "@/hooks/use-micro-step";

interface EmergencyModeApi {
  active: boolean;
  enter: () => void;
  exit: () => void;
}

const EmergencyModeContext = createContext<EmergencyModeApi>({ active: false, enter: () => {}, exit: () => {} });
export const useEmergencyMode = () => useContext(EmergencyModeContext);

function EmergencyOverlay({ onExit, renderRescue }: {
  onExit: () => void;
  renderRescue?: (task: Task, close: () => void) => React.ReactNode;
}) {
  const tz = browserTimeZone();
  // One small thing, sized for a frozen brain.
  const { data, isLoading } = useGetTasksMomentum({ minutes: 10, tz });
  const suggestion = data?.suggestions?.[0] ?? null;
  const task = suggestion?.task ?? null;

  const [clock, dispatch] = useCountdown();
  const [celebrating, setCelebrating] = useState(false);
  const [rescueOpen, setRescueOpen] = useState(false);
  const { targetLabel, complete, isPending } = useMicroStep(task);

  const queryClient = useQueryClient();
  const checkin = useCreateBrainCheckin();

  useEffect(() => {
    if (task && clock.status === "idle") dispatch({ type: "start", seconds: MICRO_START_SECONDS });
  }, [task, clock.status]);

  const handleDidIt = () => {
    complete();
    setCelebrating(true);
  };

  const handleFeelingBetter = () => {
    checkin.mutate(
      // Generated BrainCheckinSource is a literal union — "emergency_exit" is a member.
      { data: { mode: BrainMode.focused, source: "emergency_exit", tz } },
      { onSettled: () => queryClient.invalidateQueries({ queryKey: getGetBrainStateQueryKey() }) },
    );
    onExit();
  };

  return (
    <div className="fixed inset-0 z-[100] bg-background flex flex-col items-center justify-center p-6 text-center">
      {/* Always-visible exit — never a trap. */}
      <Button variant="ghost" size="icon" onClick={onExit} aria-label="Exit emergency mode"
        className="absolute top-[calc(1rem+env(safe-area-inset-top))] right-4 text-muted-foreground">
        <X className="w-5 h-5" />
      </Button>

      {isLoading ? (
        <p className="text-muted-foreground">Finding one small thing…</p>
      ) : !task ? (
        <div className="space-y-4 max-w-sm">
          <p className="text-lg font-semibold">Nothing in the log.</p>
          <p className="text-sm text-muted-foreground">Add one tiny thing first — then come back here if you want.</p>
          <Button onClick={onExit}>Back</Button>
        </div>
      ) : celebrating ? (
        <div className="space-y-5 max-w-sm">
          <p className="text-2xl font-bold text-primary">You started. That's the whole game.</p>
          <div className="flex flex-col gap-2">
            <Button onClick={() => { setCelebrating(false); dispatch({ type: "restart" }); }}>
              Another tiny one
            </Button>
            <Button variant="secondary" onClick={handleFeelingBetter}>Feeling better — Focused</Button>
            <Button variant="ghost" onClick={onExit}>Exit</Button>
          </div>
        </div>
      ) : (
        <div className="space-y-6 max-w-sm w-full">
          <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">Just this. Nothing else.</p>
          <h2 className="text-xl font-bold leading-snug">{targetLabel}</h2>
          <div className="text-5xl font-mono text-primary" aria-live="polite">
            {clock.status === "zero" ? (
              <span className="text-2xl font-sans text-foreground">Still going? Take your time.</span>
            ) : (
              formatClock(clock.remaining)
            )}
          </div>
          <div className="flex flex-col gap-2">
            <Button size="lg" onClick={handleDidIt} disabled={isPending} className="gap-2">
              <Check className="w-5 h-5" /> Did it
            </Button>
            {clock.status === "zero" && (
              <Button variant="secondary" onClick={() => dispatch({ type: "restart" })}>
                Two more minutes
              </Button>
            )}
            {renderRescue && (
              <Button variant="ghost" onClick={() => setRescueOpen(true)} className="gap-2 text-muted-foreground">
                <LifeBuoy className="w-4 h-4" /> Still stuck
              </Button>
            )}
          </div>
        </div>
      )}
      {rescueOpen && task && renderRescue?.(task, () => setRescueOpen(false))}
    </div>
  );
}

export function EmergencyModeProvider({ children, renderRescue }: {
  children: React.ReactNode;
  renderRescue?: (task: Task, close: () => void) => React.ReactNode;
}) {
  const [active, setActive] = useState(false);
  const api = useMemo<EmergencyModeApi>(
    () => ({ active, enter: () => setActive(true), exit: () => setActive(false) }),
    [active],
  );
  return (
    <EmergencyModeContext.Provider value={api}>
      {children}
      {active && <EmergencyOverlay onExit={() => setActive(false)} renderRescue={renderRescue} />}
    </EmergencyModeContext.Provider>
  );
}
