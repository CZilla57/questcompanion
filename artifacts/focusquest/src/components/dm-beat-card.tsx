// The Campaign — Phase 3: the Dungeon Master's daily beat. A quiet, story-voiced
// card at the head of the Now screen — the morning quest board, or the evening
// make-camp from late afternoon. The narrative is grounded server-side in the
// user's real quests (never fabricated) and is always anti-shame.
//
// Renders NOTHING when campaigns are locked or when the server has nothing to
// narrate (`beat: null`) — it never nags and never blocks the screen.
import { Hexagon, Sun, Tent } from "lucide-react";
import { useGetDmBeat, useGetMyStats, getGetDmBeatQueryKey } from "@workspace/api-client-react";
import { isUnlocked } from "@/lib/feature-gates";
import { browserTimeZone } from "@/lib/timezone";

/** Morning shows the quest board; from late afternoon the DM calls make-camp. */
function currentKind(): "morning" | "camp" {
  return new Date().getHours() < 17 ? "morning" : "camp";
}

/** Presentational card — no data deps, so the harness can render it in isolation. */
export function DmBeatView({ kind, narrative }: { kind: string; narrative: string }) {
  const isCamp = kind === "camp";
  const KindIcon = isCamp ? Tent : Sun;
  return (
    <section
      aria-label={`Dungeon Master, ${isCamp ? "make camp" : "quest board"}`}
      className="rounded-xl border border-primary/30 bg-primary/5 p-4 shadow-[0_0_20px_-6px] shadow-primary/20"
    >
      <div className="flex items-center justify-between mb-2">
        <span className="flex items-center gap-2 text-sm font-semibold text-foreground">
          <Hexagon className="w-4 h-4 text-primary fill-primary/30" aria-hidden />
          Dungeon Master
        </span>
        <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <KindIcon className="w-3.5 h-3.5" aria-hidden />
          {isCamp ? "Make camp" : "Quest board"}
        </span>
      </div>
      <p className="text-[15px] italic leading-relaxed text-foreground/90">{narrative}</p>
    </section>
  );
}

export function DmBeatCard() {
  const { data: stats } = useGetMyStats({ tz: browserTimeZone() });
  const unlocked = isUnlocked(stats?.unlockedFeatures, "campaigns");

  const params = { kind: currentKind(), tz: browserTimeZone() };
  const { data } = useGetDmBeat(
    params,
    { query: { enabled: unlocked, queryKey: getGetDmBeatQueryKey(params) } },
  );
  const beat = data?.beat;
  if (!unlocked || !beat) return null;

  return <DmBeatView kind={beat.kind} narrative={beat.narrative} />;
}
