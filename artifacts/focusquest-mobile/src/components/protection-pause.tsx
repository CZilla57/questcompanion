import { useQueryClient } from "@tanstack/react-query";
import { usePauseHyperfocus, useGetBrainState, getGetBrainStateQueryKey } from "@workspace/api-client-react";
import { SecondaryButton } from "./ui";

const PAUSE_MINUTES = 120;

/**
 * Pause/resume hyperfocus protection nudges. Only mounted inside the active
 * Focus view, so its brain-state fetch is naturally gated (no `enabled` needed —
 * which would trip the generated-hook `queryKey`-required typecheck error).
 */
export function ProtectionPause() {
  const qc = useQueryClient();
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const { data: state } = useGetBrainState({ tz });
  const pause = usePauseHyperfocus();

  const pausedUntil = state?.hyperfocusPausedUntil ? new Date(state.hyperfocusPausedUntil) : null;
  const isPaused = !!pausedUntil && pausedUntil.getTime() > Date.now();

  const setMinutes = (minutes: number) =>
    pause.mutate(
      { data: { minutes } },
      { onSuccess: () => qc.invalidateQueries({ queryKey: getGetBrainStateQueryKey() }) },
    );

  return (
    <SecondaryButton
      title={isPaused ? "Protection paused · Resume" : "Pause protection"}
      onPress={() => setMinutes(isPaused ? 0 : PAUSE_MINUTES)}
      disabled={pause.isPending}
    />
  );
}
