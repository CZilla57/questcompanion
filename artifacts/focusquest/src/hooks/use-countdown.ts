import { useEffect, useReducer, type Dispatch } from "react";
import { countdownReducer, countdownIdle, type CountdownState, type CountdownAction } from "@/lib/countdown";

/** Countdown state + dispatch with the 1-second tick interval managed here —
 * the single home of the interval so components never re-implement it. */
export function useCountdown(): [CountdownState, Dispatch<CountdownAction>] {
  const [state, dispatch] = useReducer(countdownReducer, countdownIdle);
  useEffect(() => {
    if (state.status !== "running") return;
    const t = setInterval(() => dispatch({ type: "tick" }), 1000);
    return () => clearInterval(t);
  }, [state.status]);
  return [state, dispatch];
}
