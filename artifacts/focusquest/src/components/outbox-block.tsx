import { CloudUpload, RefreshCw, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useOnline } from "@/hooks/use-online";
import { useOutboxActions, useOutboxEntries } from "@/hooks/use-outbox";
import { entryLabel } from "@/lib/outbox/core";

/** "Waiting to sync" — queued captures, visually distinct from real quests
 * (no checkbox: they can't be completed yet). Renders nothing when empty. */
export function OutboxBlock() {
  const entries = useOutboxEntries();
  const online = useOnline();
  const { syncNow, retry, discard } = useOutboxActions();

  if (entries.length === 0) return null;

  return (
    <div className="rounded-xl border border-primary/20 bg-muted/20 p-3 space-y-2" data-testid="outbox-block">
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-bold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
          <CloudUpload className="w-3.5 h-3.5" aria-hidden />
          Waiting to sync ({entries.length})
        </span>
        {online && (
          <Button variant="ghost" size="sm" onClick={syncNow} className="h-6 px-2 text-xs text-muted-foreground hover:text-primary">
            Sync now
          </Button>
        )}
      </div>
      <ul className="space-y-1.5">
        {entries.map((e) => (
          <li key={e.id} className="flex items-start justify-between gap-2 text-sm">
            <div className="min-w-0">
              <span className={`block truncate ${e.status === "failed" ? "text-muted-foreground" : "text-foreground"}`}>
                {entryLabel(e)}
              </span>
              {e.status === "failed" && e.lastError && (
                <span className="block text-xs text-muted-foreground">{e.lastError}</span>
              )}
            </div>
            <span className="flex items-center gap-1 shrink-0">
              {e.status === "failed" && (
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label={`Retry ${entryLabel(e)}`}
                  onClick={() => retry(e.id)}
                  className="h-6 w-6 text-muted-foreground hover:text-primary"
                >
                  <RefreshCw className="w-3.5 h-3.5" />
                </Button>
              )}
              <Button
                variant="ghost"
                size="icon"
                aria-label={`Discard ${entryLabel(e)}`}
                onClick={() => discard(e.id)}
                className="h-6 w-6 text-muted-foreground hover:text-destructive"
              >
                <X className="w-3.5 h-3.5" />
              </Button>
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
