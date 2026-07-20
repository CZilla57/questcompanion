// artifacts/focusquest/src/hooks/use-momentum-board.ts
// Extracted verbatim from pages/tasks.tsx (Act VII q2) so / and /tasks share
// one momentum implementation. No behavior change — logic is the spec.
import { useState } from "react";
import { format } from "date-fns";
import {
  useGetTasksMomentum, useGetMyPatterns, getGetMyPatternsQueryKey,
} from "@workspace/api-client-react";
import { browserTimeZone } from "@/lib/timezone";

export function useMomentumBoard() {
  const tz = browserTimeZone();
  const todayStrKey = format(new Date(), "yyyy-MM-dd");
  const [skippedIds, setSkippedIds] = useState<number[]>([]);
  const [altIndex, setAltIndex] = useState(0);
  const [momentumMinutes, setMomentumMinutes] = useState<number | null>(() => {
    try {
      const raw = sessionStorage.getItem("momentumMinutes");
      if (!raw) return null;
      const [day, val] = raw.split(":");
      return day === todayStrKey ? Number(val) || null : null; // cleared daily
    } catch {
      return null; // storage unavailable — chips just don't persist
    }
  });
  const setMinutes = (m: number | null) => {
    setMomentumMinutes(m);
    try {
      if (m) sessionStorage.setItem("momentumMinutes", `${todayStrKey}:${m}`);
      else sessionStorage.removeItem("momentumMinutes");
    } catch {
      // storage unavailable — in-memory state still works for this visit
    }
  };
  const { data: momentum, isFetching: momentumLoading } = useGetTasksMomentum({
    tz,
    ...(momentumMinutes ? { minutes: momentumMinutes } : {}),
    ...(skippedIds.length ? { exclude: skippedIds.join(",") } : {}),
  });
  const { data: patterns } = useGetMyPatterns({ tz }, { query: { queryKey: getGetMyPatternsQueryKey({ tz }), staleTime: 5 * 60_000 } });
  // "Not this one": walk the returned alternates first (instant), then refetch with exclude.
  const batch = momentum?.suggestions ?? [];
  // Clamp: an invalidation-driven refetch can shrink the batch below a stale altIndex.
  const visibleSuggestions = batch.slice(altIndex < batch.length ? altIndex : 0);
  const handleSkip = () => {
    const current = visibleSuggestions[0];
    if (!current) return;
    if (visibleSuggestions.length > 1) {
      setAltIndex((i) => i + 1);
    } else {
      // Exclude EVERY suggestion the user walked past in this batch — a
      // rejected suggestion must not resurface on the refetch.
      const batchIds = batch.map((s) => s.task.id);
      setSkippedIds((ids) => [...ids, ...batchIds.filter((id) => !ids.includes(id))]);
      setAltIndex(0);
    }
  };

  return { momentum, momentumLoading, patterns, momentumMinutes, setMinutes, handleSkip, visibleSuggestions, todayStrKey };
}
