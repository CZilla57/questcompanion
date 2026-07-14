// Shared 2-minute micro-start countdown (Emergency Mode + rescue + momentum
// card). Reaching zero is deliberately NOT a failure state — the timer is an
// on-ramp, not a deadline (anti-shame law).

export interface CountdownState {
  totalSeconds: number;
  remaining: number;
  status: "idle" | "running" | "zero";
}

export type CountdownAction =
  | { type: "start"; seconds: number }
  | { type: "tick" }
  | { type: "restart" }
  | { type: "reset" };

export const MICRO_START_SECONDS = 120;

export const countdownIdle: CountdownState = { totalSeconds: 0, remaining: 0, status: "idle" };

export function countdownReducer(state: CountdownState, action: CountdownAction): CountdownState {
  switch (action.type) {
    case "start":
      return { totalSeconds: action.seconds, remaining: action.seconds, status: "running" };
    case "tick": {
      if (state.status !== "running") return state;
      const remaining = state.remaining - 1;
      return remaining <= 0
        ? { ...state, remaining: 0, status: "zero" }
        : { ...state, remaining, status: "running" };
    }
    case "restart":
      return state.status === "idle" ? state : { ...state, remaining: state.totalSeconds, status: "running" };
    case "reset":
      return countdownIdle;
  }
}

/** m:ss for countdown displays. */
export function formatClock(totalSeconds: number): string {
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}
