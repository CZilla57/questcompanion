import { useQueryClient } from "@tanstack/react-query";
import { usePauseHyperfocus, useGetBrainState, getGetBrainStateQueryKey } from "@workspace/api-client-react";
import { Button } from "./ui/button";
import { browserTimeZone } from "@/lib/timezone";

const PAUSE_MINUTES = 120;

/** Pause/resume hyperfocus protection nudges for the current stretch. */
export function ProtectionPause() {
  const queryClient = useQueryClient();
  const { data: state } = useGetBrainState({ tz: browserTimeZone() });
  const pause = usePauseHyperfocus();

  const pausedUntil = state?.hyperfocusPausedUntil ? new Date(state.hyperfocusPausedUntil) : null;
  const isPaused = !!pausedUntil && pausedUntil.getTime() > Date.now();

  const setMinutes = (minutes: number) =>
    pause.mutate(
      { data: { minutes } },
      { onSuccess: () => queryClient.invalidateQueries({ queryKey: getGetBrainStateQueryKey() }) },
    );

  return (
    <Button
      variant="ghost"
      size="sm"
      disabled={pause.isPending}
      onClick={() => setMinutes(isPaused ? 0 : PAUSE_MINUTES)}
      className="h-7 px-2 gap-1.5 text-xs text-muted-foreground hover:text-foreground"
    >
      {isPaused ? "Protection paused · Resume" : "Pause protection"}
    </Button>
  );
}
