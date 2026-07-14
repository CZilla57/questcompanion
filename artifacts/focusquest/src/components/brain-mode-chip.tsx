import { useState } from "react";
import { Brain, Snowflake } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import {
  BrainMode, useCreateBrainCheckin, useGetBrainState,
  getGetBrainStateQueryKey, getGetTasksMomentumQueryKey,
} from "@workspace/api-client-react";
import { Button } from "./ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "./ui/popover";
import { MODE_META } from "@/lib/brain-mode-meta";
import { browserTimeZone } from "@/lib/timezone";
import { useEmergencyMode } from "./emergency-mode";
import { useToast } from "@/hooks/use-toast";

const MODE_ORDER: BrainMode[] = [
  BrainMode.focused, BrainMode.distracted, BrainMode.frozen, BrainMode.hyperfocus,
];

export function BrainModeChip() {
  const tz = browserTimeZone();
  const { data: state } = useGetBrainState({ tz });
  const checkin = useCreateBrainCheckin();
  const queryClient = useQueryClient();
  const { enter } = useEmergencyMode();
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [frozenOffer, setFrozenOffer] = useState(false);

  const mode = state?.mode ?? BrainMode.neutral;
  const meta = MODE_META[mode];

  const select = (next: BrainMode) => {
    checkin.mutate(
      { data: { mode: next, source: "tap", tz } },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getGetBrainStateQueryKey() });
          queryClient.invalidateQueries({ queryKey: getGetTasksMomentumQueryKey() });
          if (next === BrainMode.frozen) {
            setFrozenOffer(true); // offer, never force
          } else {
            setOpen(false);
          }
        },
        onError: () => toast({ title: "Couldn't save that — try again", variant: "destructive" }),
      },
    );
  };

  return (
    <Popover open={open} onOpenChange={(o) => { setOpen(o); if (!o) setFrozenOffer(false); }}>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          aria-label={`Brain mode: ${meta.label}`}
          className={`gap-1.5 px-2 h-9 ${mode === BrainMode.neutral ? "text-muted-foreground" : "text-primary"}`}
        >
          <Brain className="w-4 h-4" />
          <span className="text-xs font-medium hidden sm:inline">{meta.label}</span>
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-72 p-2 space-y-1">
        {frozenOffer ? (
          <div className="p-2 space-y-3">
            <p className="text-sm font-medium">Want the two-minute version?</p>
            <p className="text-xs text-muted-foreground">One small thing, everything else hidden. You can leave anytime.</p>
            <div className="flex gap-2">
              <Button size="sm" className="flex-1" onClick={() => { setOpen(false); setFrozenOffer(false); enter(); }}>
                Enter Emergency Mode
              </Button>
              <Button size="sm" variant="ghost" onClick={() => { setFrozenOffer(false); setOpen(false); }}>
                Not now
              </Button>
            </div>
          </div>
        ) : (
          <>
            <p className="px-2 pt-1 text-xs text-muted-foreground">{MODE_META[BrainMode.neutral].prompt}</p>
            {MODE_ORDER.map((m) => (
              <button
                key={m}
                onClick={() => select(m)}
                disabled={checkin.isPending}
                className={`w-full text-left px-2 py-2 rounded-lg hover:bg-muted transition-colors ${m === mode ? "bg-primary/10 border border-primary/30" : ""}`}
              >
                <span className="text-sm font-medium block">{MODE_META[m].label}</span>
                <span className="text-xs text-muted-foreground">{MODE_META[m].prompt}</span>
              </button>
            ))}
            {mode === BrainMode.frozen && (
              <button
                onClick={() => { setOpen(false); enter(); }}
                className="w-full text-left px-2 py-2 rounded-lg hover:bg-muted transition-colors flex items-center gap-2 text-primary"
              >
                <Snowflake className="w-4 h-4" />
                <span className="text-sm font-medium">Enter Emergency Mode</span>
              </button>
            )}
            {mode !== BrainMode.neutral && (
              <button
                onClick={() => select(BrainMode.neutral)}
                disabled={checkin.isPending}
                className="w-full text-left px-2 py-1.5 rounded-lg hover:bg-muted text-xs text-muted-foreground"
              >
                Clear — back to neutral
              </button>
            )}
          </>
        )}
      </PopoverContent>
    </Popover>
  );
}
