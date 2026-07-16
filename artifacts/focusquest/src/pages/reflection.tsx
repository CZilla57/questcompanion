import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useGetTodayReflection, getGetTodayReflectionQueryKey,
  useAnswerTodayReflection, getGetMyStatsQueryKey,
  type ReflectionChip,
} from "@workspace/api-client-react";
import { browserTimeZone } from "@/lib/timezone";
import { HELPED_CHIPS, HINDERED_CHIPS, CHIP_LABELS } from "@/lib/reflection-chips";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Moon, Sparkles } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { apiErrorMessage } from "@/lib/api-error";

function ChipGroup({ title, chips, selected, onToggle }: {
  title: string;
  chips: ReflectionChip[];
  selected: Set<ReflectionChip>;
  onToggle: (chip: ReflectionChip) => void;
}) {
  return (
    <div className="space-y-2">
      <p className="text-sm font-medium text-muted-foreground">{title}</p>
      <div className="flex flex-wrap gap-2">
        {chips.map((chip) => {
          const active = selected.has(chip);
          return (
            <button
              key={chip}
              type="button"
              onClick={() => onToggle(chip)}
              aria-pressed={active}
              className={`rounded-full border px-3 py-1.5 text-sm transition-colors ${
                active
                  ? "border-primary bg-primary/15 text-primary"
                  : "border-border bg-card text-foreground hover:border-primary/40"
              }`}
            >
              {CHIP_LABELS[chip]}
            </button>
          );
        })}
      </div>
    </div>
  );
}

export default function Reflection() {
  const tz = browserTimeZone();
  const qc = useQueryClient();
  const { toast } = useToast();
  const { data, isLoading } = useGetTodayReflection({ tz, draft: true });
  const answer = useAnswerTodayReflection();
  const [selected, setSelected] = useState<Set<ReflectionChip>>(new Set());
  const [freeText, setFreeText] = useState("");
  const [editing, setEditing] = useState(false);

  const reflection = data?.reflection ?? null;
  const answered = reflection?.answeredAt != null && !editing;

  function toggle(chip: ReflectionChip) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(chip)) next.delete(chip);
      else next.add(chip);
      return next;
    });
  }

  async function submit() {
    try {
      await answer.mutateAsync({ data: { chips: [...selected], freeText: freeText.trim() || undefined, tz } });
      // Both cache keys: the page fetches with draft=true, the dashboard card
      // without — invalidate each so the evening card hides after answering.
      await qc.invalidateQueries({ queryKey: getGetTodayReflectionQueryKey({ tz, draft: true }) });
      await qc.invalidateQueries({ queryKey: getGetTodayReflectionQueryKey({ tz }) });
      await qc.invalidateQueries({ queryKey: getGetMyStatsQueryKey() });
      setEditing(false);
    } catch (err) {
      toast({ title: "Couldn't save", description: apiErrorMessage(err, "Please try again."), variant: "destructive" });
    }
  }

  if (isLoading) {
    return (
      <div className="max-w-xl mx-auto py-10 text-center text-muted-foreground" aria-busy="true">
        <Moon className="w-6 h-6 mx-auto mb-2 animate-pulse text-primary" />
        Setting up tonight's reflection…
      </div>
    );
  }

  return (
    <div className="max-w-xl mx-auto space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <Moon className="w-5 h-5 text-primary" />
            Evening reflection
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-6">
          <p className="text-base">{reflection?.prompt}</p>

          {answered ? (
            <div className="space-y-4">
              {reflection!.chips.length > 0 && (
                <div className="flex flex-wrap gap-2">
                  {reflection!.chips.map((chip) => (
                    <span key={chip} className="rounded-full border border-primary/40 bg-primary/10 px-3 py-1 text-sm text-primary">
                      {CHIP_LABELS[chip as ReflectionChip] ?? chip}
                    </span>
                  ))}
                </div>
              )}
              {reflection!.freeText && (
                <p className="text-sm text-muted-foreground italic">"{reflection!.freeText}"</p>
              )}
              {reflection!.ack && (
                <p className="flex items-start gap-2 text-sm text-primary">
                  <Sparkles className="w-4 h-4 mt-0.5 flex-shrink-0" />
                  {reflection!.ack}
                </p>
              )}
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setSelected(new Set(reflection!.chips as ReflectionChip[]));
                  setFreeText(reflection!.freeText ?? "");
                  setEditing(true);
                }}
              >
                Edit tonight's answer
              </Button>
            </div>
          ) : (
            <div className="space-y-5">
              <ChipGroup title="What helped?" chips={HELPED_CHIPS} selected={selected} onToggle={toggle} />
              <ChipGroup title="What got in the way?" chips={HINDERED_CHIPS} selected={selected} onToggle={toggle} />
              <Textarea
                value={freeText}
                onChange={(e) => setFreeText(e.target.value)}
                maxLength={500}
                placeholder="Anything else? (optional)"
                rows={3}
              />
              <Button
                className="w-full"
                disabled={answer.isPending || (selected.size === 0 && freeText.trim().length === 0)}
                onClick={submit}
              >
                {answer.isPending ? "Saving…" : "Done"}
              </Button>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
