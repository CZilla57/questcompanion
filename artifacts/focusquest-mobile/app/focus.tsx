import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { AppState, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { Stack, Redirect } from "expo-router";
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
import { reconstructTimerState, isStaleGap, type TimerConfig } from "@workspace/pomodoro";
import { effectiveNow, partialSeconds, nextCreditIndex, localDateString } from "../src/focus/derivations";
import { useToast } from "../src/toast/toast";
import { initiationToast } from "../src/toast/initiation-toast";
import { Card, PrimaryButton, SecondaryButton, DestructiveButton, Dot } from "../src/components/ui";
import { ProtectionPause } from "../src/components/protection-pause";
import { useAuth } from "../src/auth/auth-context";

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

export default function FocusRoute() {
  const { status } = useAuth();
  const { toast } = useToast();
  const qc = useQueryClient();
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;

  // Ungated fetches are safe: this route is only reached post-auth (DeepLinkRouter
  // navigates here only when authed; the Redirect below guards any direct mount).
  const presetsQuery = useGetFocusPresets();
  const activeQuery = useGetActiveFocusSession();
  const tasksQuery = useGetTasks({ completed: false, date: localDateString(Date.now(), tz) });

  const startMut = useStartFocusSession();
  const intervalMut = useCreditFocusInterval();
  const completeMut = useCompleteFocusSession();

  const active = activeQuery.data ?? null;

  // Idle-form state.
  const [presetKey, setPresetKey] = useState<FocusPreset["key"]>("classic");
  const [taskId, setTaskId] = useState<number | null>(null);

  // Ticking clock + pause accounting (client-only; a relaunch cancels pause).
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [pausedAtMs, setPausedAtMs] = useState<number | null>(null);
  const pausedAccumRef = useRef(0);

  // 1s tick + an immediate re-sample when the app returns to the foreground,
  // so the readout is correct the instant we come back (self-heals from background).
  useEffect(() => {
    const id = setInterval(() => setNowMs(Date.now()), 1000);
    const sub = AppState.addEventListener("change", (s) => {
      if (s === "active") setNowMs(Date.now());
    });
    return () => {
      clearInterval(id);
      sub.remove();
    };
  }, []);

  const effNow = effectiveNow(nowMs, pausedAtMs, pausedAccumRef.current);

  const state = useMemo(() => {
    if (!active) return null;
    return reconstructTimerState(configOf(active), new Date(active.startedAt).getTime(), effNow);
  }, [active, effNow]);

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

  // Credit focus intervals as their boundaries pass (pause-safe: effNow only
  // advances while running, so completedIntervals only grows while running).
  useEffect(() => {
    if (!active || !state) return;
    if (active.status !== "active") return;
    if (staleHandledRef.current === active.id) return;
    if (intervalMut.isPending) return;
    const next = nextCreditIndex(state, creditedRef.current, active.plannedCycles);
    if (next === null) return;
    creditedRef.current = next;
    intervalMut.mutate(
      { id: active.id, data: { intervalIndex: next } },
      {
        onSuccess: (res) => {
          if (res.xpDelta > 0) toast({ title: `+${res.xpDelta} XP`, description: "Focus block banked" });
          qc.invalidateQueries({ queryKey: getGetActiveFocusSessionQueryKey() });
          qc.invalidateQueries({ queryKey: getGetMyStatsQueryKey() });
          if (res.session.status === "completed") {
            qc.invalidateQueries({ queryKey: getGetCoinsQueryKey() });
            toast({ title: "Session complete!", description: `Focused ${Math.round(res.session.focusedSeconds / 60)} min` });
          }
        },
        onError: () => {
          creditedRef.current = next - 1; // allow retry on the next tick
          qc.invalidateQueries({ queryKey: getGetActiveFocusSessionQueryKey() });
        },
      },
    );
  }, [active, state, intervalMut, qc, toast]);

  function handleStart() {
    startMut.mutate(
      { data: { preset: presetKey, taskId: taskId ?? undefined }, params: { tz } },
      {
        onSuccess: (res) => {
          pausedAccumRef.current = 0;
          setPausedAtMs(null);
          const t = initiationToast(res.initiationXp);
          if (t) toast(t);
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
    completeMut.mutate(
      { id: active.id, data: { partialSeconds: partialSeconds(state, active.focusMinutes) } },
      {
        onSettled: () => {
          qc.invalidateQueries({ queryKey: getGetActiveFocusSessionQueryKey() });
          qc.invalidateQueries({ queryKey: getGetMyStatsQueryKey() });
        },
        onSuccess: (res) => {
          toast({ title: "Session ended", description: res.xpDelta > 0 ? `+${res.xpDelta} XP` : undefined });
        },
      },
    );
  }

  // Auth guard (kept from #4). All hooks above run unconditionally before any return.
  if (status === "loading") {
    return (
      <Centered>
        <Text>Loading…</Text>
      </Centered>
    );
  }
  if (status !== "authed") return <Redirect href="/" />;

  const header = <Stack.Screen options={{ headerShown: true, title: "Focus Session" }} />;

  if (activeQuery.isLoading) {
    return (
      <>
        {header}
        <Centered>
          <Text>Loading…</Text>
        </Centered>
      </>
    );
  }

  // ── Active session view ────────────────────────────────────────────────────
  if (active && state && active.status === "active") {
    const paused = pausedAtMs != null;
    return (
      <>
        {header}
        <ScrollView contentContainerStyle={styles.container}>
          <Card>
            <Text style={styles.phase}>{PHASE_LABEL[state.phase]}</Text>
            <Text style={styles.clock}>{fmt(state.remainingSeconds)}</Text>
            <View style={styles.dots} accessibilityLabel="Cycle progress">
              {Array.from({ length: active.plannedCycles }).map((_, i) => (
                <Dot key={i} active={i < state.completedIntervals} />
              ))}
            </View>
            {paused ? <Text style={styles.pausedHint}>Paused</Text> : null}
            <View style={styles.row}>
              <SecondaryButton title={paused ? "Resume" : "Pause"} onPress={togglePause} />
              <DestructiveButton title="Stop" onPress={handleStop} disabled={completeMut.isPending} />
            </View>
            <ProtectionPause />
          </Card>
        </ScrollView>
      </>
    );
  }

  // ── Idle view ──────────────────────────────────────────────────────────────
  const presets: FocusPreset[] = presetsQuery.data ?? [];
  const openTasks = tasksQuery.data ?? [];
  return (
    <>
      {header}
      <ScrollView contentContainerStyle={styles.container}>
        <Text style={styles.sectionLabel}>Choose a rhythm</Text>
        {presets.map((p) => (
          <Pressable
            key={p.key}
            onPress={() => setPresetKey(p.key)}
            style={[styles.selectable, presetKey === p.key && styles.selectableActive]}
          >
            <Text style={styles.presetLabel}>{p.label}</Text>
            <Text style={styles.presetMeta}>
              {p.plannedCycles} × {p.focusMinutes} min focus · {p.breakMinutes} min breaks
            </Text>
          </Pressable>
        ))}

        <Text style={styles.sectionLabel}>Focus on a quest (optional)</Text>
        <Pressable
          onPress={() => setTaskId(null)}
          style={[styles.selectable, taskId === null && styles.selectableActive]}
        >
          <Text>Just focus (no quest)</Text>
        </Pressable>
        {openTasks.map((t) => (
          <Pressable
            key={t.id}
            onPress={() => setTaskId(t.id)}
            style={[styles.selectable, taskId === t.id && styles.selectableActive]}
          >
            <Text>{t.title}</Text>
          </Pressable>
        ))}

        <PrimaryButton
          title={startMut.isPending ? "Starting…" : "Start Focus"}
          onPress={handleStart}
          disabled={startMut.isPending || presets.length === 0}
        />
      </ScrollView>
    </>
  );
}

function Centered({ children }: { children: ReactNode }) {
  return (
    <View style={{ flex: 1, gap: 12, alignItems: "center", justifyContent: "center", padding: 24 }}>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { padding: 24, gap: 16 },
  phase: { fontSize: 12, letterSpacing: 1, textTransform: "uppercase", color: "#6b7280", textAlign: "center" },
  clock: { fontSize: 64, fontWeight: "700", fontVariant: ["tabular-nums"], textAlign: "center" },
  dots: { flexDirection: "row", justifyContent: "center", gap: 6 },
  pausedHint: { fontSize: 12, color: "#6b7280", textAlign: "center" },
  row: { flexDirection: "row", justifyContent: "center", gap: 12, paddingTop: 8 },
  sectionLabel: { fontSize: 14, fontWeight: "600" },
  selectable: { borderWidth: 1, borderColor: "#d1d5db", borderRadius: 8, paddingHorizontal: 16, paddingVertical: 12 },
  selectableActive: { borderColor: "#6366f1" },
  presetLabel: { fontWeight: "600" },
  presetMeta: { fontSize: 12, color: "#6b7280", marginTop: 2 },
});
