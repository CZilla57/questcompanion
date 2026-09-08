import { useGetBestiary } from "@workspace/api-client-react";
import type { BestiaryEntry } from "@workspace/api-client-react";
import { Card } from "@/components/ui/card";
import { BookOpen, HelpCircle } from "lucide-react";

/**
 * Act V (Depth & Collection): the Bestiary — a discovery log completed by
 * felling each foe in the roster. Fully derived server-side from the hero's
 * encounter fell history. Anti-shame: an unmet foe is a "not yet encountered"
 * silhouette (never "unbeaten"); facing a foe again is a re-match, not a
 * setback; every entry is a win waiting to happen.
 */
export default function Bestiary() {
  const { data, isLoading } = useGetBestiary();

  return (
    <div className="space-y-6 animate-in fade-in duration-500 max-w-2xl">
      <div>
        <div className="flex items-center gap-3 mb-2">
          <div className="w-10 h-10 rounded-xl bg-primary/15 border border-primary/30 flex items-center justify-center">
            <BookOpen className="w-5 h-5 text-primary" />
          </div>
          <h1 className="text-3xl font-bold text-foreground">Bestiary</h1>
        </div>
        <p className="text-muted-foreground leading-relaxed">
          The frictions you've faced as foes. Fell one to add it to your log —
          the ones you haven't met yet wait in shadow.
        </p>
        {data && (
          <p className="mt-2 text-sm font-medium text-primary tabular-nums">
            {data.discoveredCount} / {data.total} discovered
          </p>
        )}
      </div>

      {isLoading ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {[...Array(4)].map((_, i) => <div key={i} className="h-28 rounded-xl bg-muted/30 animate-pulse" />)}
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {(data?.entries ?? []).map((entry) => <FoeCard key={entry.slot} entry={entry} />)}
        </div>
      )}
    </div>
  );
}

function formatDate(iso: string | null): string {
  if (!iso) return "";
  return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

function FoeCard({ entry }: { entry: BestiaryEntry }) {
  // Revealed = discovered (felled) or currently active. Otherwise a silhouette.
  const revealed = entry.name != null;

  if (!revealed) {
    return (
      <Card className="p-4 flex items-center gap-3 bg-card/40 border-dashed border-border">
        <div className="h-10 w-10 rounded-full bg-muted grid place-items-center text-muted-foreground">
          <HelpCircle className="h-5 w-5" />
        </div>
        <div>
          <h3 className="font-semibold text-muted-foreground">? ? ?</h3>
          <p className="text-xs text-muted-foreground/70">Not yet encountered</p>
        </div>
      </Card>
    );
  }

  return (
    <Card
      className={`p-4 space-y-2 ${
        entry.discovered ? "bg-card border-border" : "bg-primary/5 border-primary/30"
      }`}
    >
      <div className="flex items-start justify-between gap-2">
        <h3 className="font-bold text-lg leading-tight">{entry.name}</h3>
        {entry.active && (
          <span className="shrink-0 rounded-full border border-primary/40 bg-primary/10 px-2 py-0.5 text-[11px] font-medium text-primary">
            Currently facing
          </span>
        )}
        {!entry.active && entry.timesFelled > 1 && (
          <span className="shrink-0 rounded-full border border-border px-2 py-0.5 text-[11px] font-medium text-muted-foreground tabular-nums">
            felled ×{entry.timesFelled}
          </span>
        )}
      </div>

      {entry.motive && <p className="text-sm text-muted-foreground italic">{entry.motive}</p>}

      {entry.discovered ? (
        <>
          {entry.defeatBeat && <p className="text-sm text-foreground/90">{entry.defeatBeat}</p>}
          {entry.worldNote && <p className="text-xs text-primary/80">{entry.worldNote}</p>}
          {entry.firstFelledAt && (
            <p className="text-[11px] text-muted-foreground/70">
              First felled {formatDate(entry.firstFelledAt)}
            </p>
          )}
        </>
      ) : (
        <p className="text-xs text-muted-foreground/70">
          You're facing this one now — fell it to complete its entry.
        </p>
      )}
    </Card>
  );
}
