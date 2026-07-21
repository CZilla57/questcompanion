import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useGetBodyDoubleRoom, getGetBodyDoubleRoomQueryKey,
  useLeaveBodyDoubleRoom, useWaveBodyDoubleRoom,
  useStartBodyDoubleSprint, useFinishBodyDoubleSprint,
  getGetOpenBodyDoubleRoomsQueryKey, getGetMyStatsQueryKey,
} from "@workspace/api-client-react";
import { sprintCountdown } from "@/lib/body-double-countdown";
import { apiHeroToLook } from "@/lib/hero/from-api";
import { PixelHero } from "@/components/pixel-hero";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { Hand, LogOut, Timer } from "lucide-react";

const fmt = (total: number) => {
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
};

// How long a wave stays visible on allies' screens (must comfortably exceed
// the 10s poll so nobody's wave lands between two refreshes unseen).
const WAVE_SHOW_MS = 12_000;

export function BodyDoubleRoom({ roomId, onExit }: { roomId: number; onExit: () => void }) {
  const { toast } = useToast();
  const qc = useQueryClient();

  // THE poll: 10s, and the server touches our last_seen_at on each read —
  // polling IS the presence heartbeat. Background tabs stop polling (TanStack
  // default), which is exactly what renders us "heads-down" to allies.
  const roomQuery = useGetBodyDoubleRoom(roomId, {
    query: { queryKey: getGetBodyDoubleRoomQueryKey(roomId), refetchInterval: 10_000 },
  });
  const room = roomQuery.data;

  const leaveMut = useLeaveBodyDoubleRoom();
  const waveMut = useWaveBodyDoubleRoom();
  const startMut = useStartBodyDoubleSprint();
  const finishMut = useFinishBodyDoubleSprint();

  const [nowMs, setNowMs] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  const invalidateRoom = () => {
    qc.invalidateQueries({ queryKey: getGetBodyDoubleRoomQueryKey(roomId) });
    qc.invalidateQueries({ queryKey: getGetOpenBodyDoubleRoomsQueryKey() });
  };

  // Auto-finish once when the shared countdown hits zero; the server's guarded
  // claim makes cross-member races harmless (soft no-op).
  const finishedRef = useRef<number | null>(null);
  const sprint = room?.sprint ?? null;
  const countdown = sprint ? sprintCountdown(sprint.startedAt, sprint.minutes, nowMs) : null;
  const sprintDone = countdown?.done ?? false;
  useEffect(() => {
    if (!sprint || !sprintDone) return;
    if (finishedRef.current === sprint.id || finishMut.isPending) return;
    finishedRef.current = sprint.id;
    finishMut.mutate(
      { id: roomId, sprintId: sprint.id },
      {
        onSuccess: (res) => {
          if (res.xpAwarded > 0) {
            toast({ title: `+${res.xpAwarded} XP`, description: "Sprint together", className: "border-primary" });
            qc.invalidateQueries({ queryKey: getGetMyStatsQueryKey() });
          }
          invalidateRoom();
        },
        onError: invalidateRoom,
      },
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sprint?.id, sprintDone]);

  if (!room) {
    return <div className="py-4 text-center text-sm text-muted-foreground animate-pulse">Opening the room…</div>;
  }

  if (room.status === "ended") {
    const host = room.members.find((m) => m.isHost);
    return (
      <div className="space-y-3 text-center py-4">
        <p className="text-sm text-muted-foreground">
          {room.isMine
            ? "Room wrapped up — thanks for the company."
            : `${host?.displayName ?? host?.username ?? "Your ally"} wrapped up — nice working together.`}
        </p>
        <Button variant="outline" size="sm" onClick={onExit}>Back</Button>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-3 justify-center">
        {room.members.map((m) => {
          const look = apiHeroToLook(m.hero);
          const waved = m.waveAt != null && nowMs - new Date(m.waveAt).getTime() < WAVE_SHOW_MS;
          return (
            <div key={m.id} className="flex flex-col items-center gap-1 w-16">
              <div className="relative">
                {look
                  ? <PixelHero look={look} size={48} />
                  : <div className="w-12 h-12 rounded-md bg-muted flex items-center justify-center text-lg font-bold text-muted-foreground">
                      {m.username.charAt(0).toUpperCase()}
                    </div>}
                <span
                  className={`absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full border border-background ${m.presence === "here" ? "bg-green-400" : "bg-amber-400"}`}
                  aria-hidden
                />
                {waved && <span className="absolute -top-2 -right-2 text-sm" role="img" aria-label="wave">👋</span>}
              </div>
              <span className="text-[10px] leading-tight text-center truncate w-full">{m.displayName ?? m.username}</span>
              {/* A quiet phone means they're working, not gone — heads-down is a good state. */}
              <span className="text-[9px] text-muted-foreground">{m.presence === "here" ? "with you" : "heads-down"}</span>
            </div>
          );
        })}
      </div>

      {sprint && countdown && !sprintDone && (
        <div className="text-center space-y-1">
          <div className="text-3xl font-mono font-bold tabular-nums text-primary">{fmt(countdown.remainingSeconds)}</div>
          <p className="text-xs text-muted-foreground">Sprinting together · {sprint.minutes} min</p>
        </div>
      )}

      {!sprint && (
        <div className="flex items-center justify-center gap-2 flex-wrap">
          <span className="text-xs text-muted-foreground mr-1 flex items-center gap-1">
            <Timer className="w-3.5 h-3.5" /> Sprint together:
          </span>
          {([15, 25, 50] as const).map((m) => (
            <Button
              key={m}
              variant="outline"
              size="sm"
              disabled={startMut.isPending}
              onClick={() => startMut.mutate({ id: roomId, data: { minutes: m } }, { onSettled: invalidateRoom })}
            >
              {m}m
            </Button>
          ))}
        </div>
      )}

      <div className="flex justify-center gap-2">
        <Button
          variant="ghost"
          size="sm"
          disabled={waveMut.isPending}
          onClick={() => waveMut.mutate({ id: roomId }, { onSettled: invalidateRoom })}
        >
          <Hand className="w-4 h-4 mr-1" /> Wave
        </Button>
        <Button
          variant="ghost"
          size="sm"
          disabled={leaveMut.isPending}
          onClick={() =>
            leaveMut.mutate({ id: roomId }, {
              onSettled: () => { invalidateRoom(); onExit(); },
            })
          }
        >
          <LogOut className="w-4 h-4 mr-1" /> {room.isMine ? "Wrap up" : "Leave"}
        </Button>
      </div>
      {room.isMine && (
        <p className="text-[10px] text-center text-muted-foreground">
          Wrapping up closes the room for everyone — gently.
        </p>
      )}
    </div>
  );
}
