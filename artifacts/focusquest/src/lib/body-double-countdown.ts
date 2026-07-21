// Shared sprint countdown: every client derives remaining time from the same
// server-anchored startedAt — the same trust model as the solo pomodoro
// (reconstructTimerState), so screens agree without any push channel.
export interface SprintCountdown {
  remainingSeconds: number;
  done: boolean;
}

export function sprintCountdown(startedAtIso: string, minutes: number, nowMs: number): SprintCountdown {
  const endMs = new Date(startedAtIso).getTime() + minutes * 60_000;
  const remaining = Math.ceil((endMs - nowMs) / 1000);
  return { remainingSeconds: Math.max(0, remaining), done: remaining <= 0 };
}
