import { useEffect, useMemo, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useGetFocusPresets,
  useGetActiveFocusSession,
  useStartFocusSession,
  useCreditFocusInterval,
  useCompleteFocusSession,
  useGetTasks,
  getGetActiveFocusSessionQueryKey,
  getGetMyStatsQueryKey,
  getGetCoinsQueryKey,
  type FocusPreset,
  type FocusSession,
} from "@workspace/api-client-react";
import { reconstructTimerState, isStaleGap, type TimerConfig } from "@/lib/pomodoro";
import { initiationToast } from "@/lib/initiation-toast";
import { browserTimeZone } from "@/lib/timezone";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ProtectionPause } from "@/components/protection-pause";
import { BodyDoubleCard } from "@/components/body-double-card";
import { useToast } from "@/hooks/use-toast";
import { Timer, Pause, Play, Square } from "lucide-react";

function configOf(s: FocusSession): TimerConfig {
  return {
    focusMinutes: s.focusMinutes,
    breakMinutes: s.breakMinutes,
    longBreakMinutes: s.longBreakMinutes,
    longBreakEvery: s.longBreakEvery,
    plannedCycles: s.plannedCycles,
  };
}

function fmt(totalSeconds: number): string {
  const s = Math.max(0, totalSeconds);
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${String(m).padStart(2, "0")}:${String(r).padStart(2, "0")}`;
}

const PHASE_LABEL: Record<string, string> = { focus: "Focus", break: "Break", longBreak: "Long break", done: "Done" };

export default function Focus() {
  const { toast } = useToast();
  const qc = useQueryClient();

  const presetsQuery = useGetFocusPresets();
  const activeQuery = useGetActiveFocusSession();
  const tasksQuery = useGetTasks({ completed: false });

  const startMut = useStartFocusSession();
  const intervalMut = useCreditFocusInterval();
  const completeMut = useCompleteFocusSession();

  const active = activeQuery.data ?? null;

  // Idle-form state.
  const [presetKey, setPresetKey] = useState<FocusPreset["key"]>("classic");
  const [taskId, setTaskId] = useState<number | null>(null);

  // Ticking clock + pause accounting (client-only; a reload cancels pause).
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [pausedAtMs, setPausedAtMs] = useState<number | null>(null);
  const pausedAccumRef = useRef(0);

  useEffect(() => {
    const id = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  // Effective "now" excludes accumulated paused time.
  const effectiveNowMs = (pausedAtMs ?? nowMs) - pausedAccumRef.current;

  const state = useMemo(() => {
    if (!active) return null;
    return reconstructTimerState(configOf(active), new Date(active.startedAt).getTime(), effectiveNowMs);
  }, [active, effectiveNowMs]);

  // Track the highest interval index we've asked the server to credit.
  const creditedRef = useRef(0);
  useEffect(() => {
    creditedRef.current = active?.completedIntervals ?? 0;
  }, [active?.id, active?.completedIntervals]);

  // On load: finalize a stale (abandoned) session instead of back-crediting it.
  const staleHandledRef = useRef<number | null>(null);
  useEffect(() => {
    if (!active) return;
    if (staleHandledRef.current === active.id) return;
    const last = new Date(active.lastIntervalAt ?? active.startedAt).getTime();
    if (isStaleGap(configOf(active), last, Date.now())) {
      staleHandledRef.current = active.id;
      completeMut.mutate(
        { id: active.id, data: { partialSeconds: 0 } },
        { onSettled: () => qc.invalidateQueries({ queryKey: getGetActiveFocusSessionQueryKey() }) },
      );
    }
  }, [active, completeMut, qc]);

  // Credit focus intervals as their boundaries pass (works with pause for free,
  // since effectiveNow — and thus completedIntervals — only advances when running).
  useEffect(() => {
    if (!active || !state) return;
    if (active.status !== "active") return;
    if (staleHandledRef.current === active.id) return;
    if (intervalMut.isPending) return;
    const next = creditedRef.current + 1;
    if (state.completedIntervals >= next && next <= active.plannedCycles) {
      creditedRef.current = next;
      intervalMut.mutate(
        { id: active.id, data: { intervalIndex: next } },
        {
          onSuccess: (res) => {
            if (res.xpDelta > 0) toast({ title: `+${res.xpDelta} XP`, description: "Focus block banked", className: "border-primary" });
            qc.invalidateQueries({ queryKey: getGetActiveFocusSessionQueryKey() });
            qc.invalidateQueries({ queryKey: getGetMyStatsQueryKey() });
            if (res.session.status === "completed") {
              qc.invalidateQueries({ queryKey: getGetCoinsQueryKey() });
              toast({ title: "Session complete!", description: `Focused ${Math.round(res.session.focusedSeconds / 60)} min`, className: "border-primary" });
            }
          },
          onError: () => {
            creditedRef.current = next - 1; // allow retry on the next tick
            qc.invalidateQueries({ queryKey: getGetActiveFocusSessionQueryKey() });
          },
        },
      );
    }
  }, [active, state, intervalMut, qc, toast]);

  function handleStart() {
    startMut.mutate(
      { data: { preset: presetKey, taskId: taskId ?? undefined }, params: { tz: browserTimeZone() } },
      {
        onSuccess: (res) => {
          pausedAccumRef.current = 0;
          setPausedAtMs(null);
          const t = initiationToast(res.initiationXp);
          if (t) toast({ ...t, className: "border-primary" });
          qc.invalidateQueries({ queryKey: getGetActiveFocusSessionQueryKey() });
          qc.invalidateQueries({ queryKey: getGetMyStatsQueryKey() });
        },
        onError: () => {
          // A 409 means a session is already active — just refetch and resume it.
          qc.invalidateQueries({ queryKey: getGetActiveFocusSessionQueryKey() });
        },
      },
    );
  }

  function togglePause() {
    if (pausedAtMs == null) {
      setPausedAtMs(Date.now());
    } else {
      pausedAccumRef.current += Date.now() - pausedAtMs;
      setPausedAtMs(null);
    }
  }

  function handleStop() {
    if (!active || !state) return;
    const partialSeconds = state.phase === "focus" ? active.focusMinutes * 60 - state.remainingSeconds : 0;
    completeMut.mutate(
      { id: active.id, data: { partialSeconds: Math.max(0, Math.floor(partialSeconds)) } },
      {
        onSettled: () => {
          qc.invalidateQueries({ queryKey: getGetActiveFocusSessionQueryKey() });
          qc.invalidateQueries({ queryKey: getGetMyStatsQueryKey() });
        },
        onSuccess: (res) => {
          toast({ title: "Session ended", description: res.xpDelta > 0 ? `+${res.xpDelta} XP` : undefined, className: "border-primary" });
        },
      },
    );
  }

  if (activeQuery.isLoading) {
    return <div className="p-8 text-center text-muted-foreground text-sm">Loading…</div>;
  }

  // ── Active session view ────────────────────────────────────────────────────
  if (active && state && active.status === "active") {
    const paused = pausedAtMs != null;
    return (
      <div className="max-w-md mx-auto space-y-6">
        <h1 className="text-xl font-bold flex items-center gap-2"><Timer className="w-5 h-5 text-primary" /> Focus Session</h1>
        <Card>
          <CardContent className="pt-6 text-center space-y-4">
            <p className="text-sm uppercase tracking-wide text-muted-foreground">{PHASE_LABEL[state.phase]}</p>
            <p className="text-6xl font-mono font-bold tabular-nums">{fmt(state.remainingSeconds)}</p>
            <div className="flex justify-center gap-1.5" aria-label="Cycle progress">
              {Array.from({ length: active.plannedCycles }).map((_, i) => (
                <span key={i} className={`w-3 h-3 rounded-full ${i < state.completedIntervals ? "bg-primary" : "bg-muted"}`} />
              ))}
            </div>
            {paused && <p className="text-xs text-muted-foreground">Paused</p>}
            <div className="flex justify-center gap-3 pt-2">
              <Button variant="outline" onClick={togglePause}>
                {paused ? <><Play className="w-4 h-4 mr-1" /> Resume</> : <><Pause className="w-4 h-4 mr-1" /> Pause</>}
              </Button>
              <Button variant="destructive" onClick={handleStop} disabled={completeMut.isPending}>
                <Square className="w-4 h-4 mr-1" /> Stop
              </Button>
            </div>
            <div className="flex justify-center pt-1">
              <ProtectionPause />
            </div>
          </CardContent>
        </Card>
        <BodyDoubleCard />
      </div>
    );
  }

  // ── Idle view ──────────────────────────────────────────────────────────────
  const presets: FocusPreset[] = presetsQuery.data ?? [];
  const openTasks = tasksQuery.data ?? [];
  return (
    <div className="max-w-md mx-auto space-y-6">
      <h1 className="text-xl font-bold flex items-center gap-2"><Timer className="w-5 h-5 text-primary" /> Focus Session</h1>

      <div className="space-y-2">
        <p className="text-sm font-medium">Choose a rhythm</p>
        <div className="grid grid-cols-1 gap-2">
          {presets.map((p) => (
            <button
              key={p.key}
              onClick={() => setPresetKey(p.key)}
              className={`text-left rounded-md border px-4 py-3 transition-colors ${presetKey === p.key ? "border-primary" : "border-input hover:bg-muted"}`}
            >
              <span className="font-semibold">{p.label}</span>
              <span className="block text-xs text-muted-foreground">
                {p.plannedCycles} × {p.focusMinutes} min focus · {p.breakMinutes} min breaks
              </span>
            </button>
          ))}
        </div>
      </div>

      <div className="space-y-2">
        <label htmlFor="focus-task" className="text-sm font-medium">Focus on a quest (optional)</label>
        <select
          id="focus-task"
          value={taskId ?? ""}
          onChange={(e) => setTaskId(e.target.value ? Number(e.target.value) : null)}
          className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
        >
          <option value="">Just focus (no quest)</option>
          {openTasks.map((t) => (
            <option key={t.id} value={t.id}>{t.title}</option>
          ))}
        </select>
      </div>

      <Button className="w-full" onClick={handleStart} disabled={startMut.isPending || presets.length === 0}>
        {startMut.isPending ? "Starting…" : "Start Focus"}
      </Button>

      <BodyDoubleCard />
    </div>
  );
}
