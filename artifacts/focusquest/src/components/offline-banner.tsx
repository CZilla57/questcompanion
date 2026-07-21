import { CloudOff } from "lucide-react";
import { useOnline } from "@/hooks/use-online";

/** Calm strip, muted styling — being offline is weather, not an error. */
export function OfflineBanner() {
  const online = useOnline();
  if (online) return null;
  return (
    <div
      role="status"
      className="mb-4 flex items-center gap-2 rounded-lg border border-border bg-muted/30 px-3 py-2 text-xs text-muted-foreground"
    >
      <CloudOff className="w-3.5 h-3.5 shrink-0" aria-hidden />
      <span>You're offline — captures are saved and will sync.</span>
    </div>
  );
}
