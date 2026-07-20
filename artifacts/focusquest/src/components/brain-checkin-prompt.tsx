import { useState } from "react";
import { format } from "date-fns";
import { X } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import {
  BrainMode, useCreateBrainCheckin, useGetBrainState,
  getGetBrainStateQueryKey, getGetTasksMomentumQueryKey,
} from "@workspace/api-client-react";
import { Button } from "./ui/button";
import { MODE_META, promptDismissedToday, dismissPromptToday } from "@/lib/brain-mode-meta";
import { CHIP_PILL_CLASS } from "@/lib/chip";
import { browserTimeZone } from "@/lib/timezone";
import { useToast } from "@/hooks/use-toast";

const PROMPT_MODES: BrainMode[] = [
  BrainMode.focused, BrainMode.distracted, BrainMode.frozen, BrainMode.hyperfocus,
];

/** Soft once-a-day check-in ask. Dismissing is silent; hyperfocus mutes it. */
export function BrainCheckinPrompt({ variant = "card" }: { variant?: "card" | "chip" } = {}) {
  const tz = browserTimeZone();
  const todayStr = format(new Date(), "yyyy-MM-dd");
  const { data: state } = useGetBrainState({ tz });
  const checkin = useCreateBrainCheckin();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [dismissedDay, setDismissedDay] = useState<string | null>(() =>
    promptDismissedToday(todayStr) ? todayStr : null,
  );
  // Day-keyed like dismissal: a cross-midnight session renders tomorrow's
  // prompt as a chip again instead of keeping yesterday's expanded card.
  const [expandedDay, setExpandedDay] = useState<string | null>(null);

  // checkedInToday covers "expired earlier today" — never re-summon (spec).
  if (!state || state.checkedInToday || dismissedDay === todayStr || state.mode === BrainMode.hyperfocus) return null;

  const pick = (mode: BrainMode) => {
    checkin.mutate(
      { data: { mode, source: "daily_prompt", tz } },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getGetBrainStateQueryKey() });
          queryClient.invalidateQueries({ queryKey: getGetTasksMomentumQueryKey() });
        },
        onError: () => toast({ title: "Couldn't save that — try again", variant: "destructive" }),
      },
    );
  };

  const dismiss = () => {
    dismissPromptToday(todayStr);
    setDismissedDay(todayStr);
    setExpandedDay(null);
  };

  if (variant === "chip" && expandedDay !== todayStr) {
    return (
      <button type="button" onClick={() => setExpandedDay(todayStr)} className={CHIP_PILL_CLASS}>
        <span aria-hidden>🧠</span> How's the brain today?
      </button>
    );
  }

  return (
    <div className="rounded-xl border border-primary/25 bg-primary/[0.04] p-4 animate-in fade-in slide-in-from-top-2 duration-300">
      <div className="flex items-start justify-between mb-3">
        <div>
          <h2 className="text-sm font-semibold text-foreground">How's the brain today?</h2>
          <p className="text-xs text-muted-foreground">One tap — the board reshapes to match.</p>
        </div>
        <Button variant="ghost" size="icon" onClick={dismiss} aria-label="Dismiss check-in"
          className="h-6 w-6 text-muted-foreground -mt-1 -mr-1">
          <X className="w-3.5 h-3.5" />
        </Button>
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        {PROMPT_MODES.map((m) => (
          <Button key={m} variant="outline" size="sm" disabled={checkin.isPending}
            onClick={() => pick(m)} className="justify-start text-xs h-9">
            {MODE_META[m].label}
          </Button>
        ))}
      </div>
    </div>
  );
}
