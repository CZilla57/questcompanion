import { useState } from "react";
import { Pencil } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useGetHeroStatus, useUpdateCompanion, getGetHeroStatusQueryKey,
  type CompanionUpdateDisposition,
} from "@workspace/api-client-react";
import { stageSegments, stageLabel, type HungerStage } from "@/lib/hero-vitality";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "./ui/dialog";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { useToast } from "@/hooks/use-toast";
import { apiErrorMessage } from "@/lib/api-error";

const DISPOSITIONS: { id: CompanionUpdateDisposition; label: string; hint: string }[] = [
  { id: "warm",  label: "Warm",  hint: "Encouraging and kind" },
  { id: "wry",   label: "Wry",   hint: "Dry and teasing" },
  { id: "stoic", label: "Stoic", hint: "Calm and grounded" },
];
const MAX_NAME = 24;

/**
 * Vitality bar + mood + ambient "hero life" status line, fed by
 * GET /users/me/hero-status. `compact` drops the mood line for tight layouts
 * (dashboard hero summary). Non-compact (the Hero page) also surfaces the
 * companion's name + an edit affordance (Act III — the companion as a
 * character).
 */
export function HeroVitality({ compact = false }: { compact?: boolean }) {
  const { data } = useGetHeroStatus();
  const [editOpen, setEditOpen] = useState(false);
  if (!data) return null;

  const stage = data.stage as HungerStage;
  const filled = stageSegments(stage);
  const danger = stage === "starving" || stage === "fainted";
  const companionName = data.companion.name ?? "Your companion";

  return (
    <div className={compact ? "space-y-1" : "space-y-1.5"}>
      <div className="flex items-center gap-2">
        <div className="flex gap-0.5" role="meter" aria-valuemin={0} aria-valuemax={5} aria-valuenow={filled} aria-label={`Vitality: ${stageLabel(stage)}`}>
          {Array.from({ length: 5 }, (_, i) => (
            <div
              key={i}
              className={`h-2 w-4 rounded-sm ${
                i < filled ? (danger ? "bg-red-500" : "bg-amber-400") : "bg-muted/40"
              }`}
            />
          ))}
        </div>
        <span className={`text-xs font-medium ${danger ? "text-red-400" : "text-muted-foreground"}`}>
          {stageLabel(stage)}
        </span>
      </div>
      {!compact && <div className="text-xs text-muted-foreground italic">{data.mood}</div>}
      {data.companion.line && data.companion.beat !== "ambient" ? (
        <div className="text-xs font-medium text-primary">
          {data.companion.name ? <span className="text-muted-foreground">{data.companion.name}: </span> : null}
          {data.companion.line}
        </div>
      ) : null}
      <div className="text-xs text-muted-foreground">
        Currently: <span className="italic">{data.activity.text}</span>
      </div>
      {!compact && (
        <div className="flex items-center gap-1.5">
          <span className="text-[10px] uppercase tracking-wide text-muted-foreground/70">
            {companionName} · {data.companion.bondTierName}
            {data.companion.beat === "ambient" && data.companion.line ? ` · ${data.companion.line}` : ""}
          </span>
          <button
            type="button"
            onClick={() => setEditOpen(true)}
            aria-label="Name your companion"
            className="text-muted-foreground/60 hover:text-primary transition-colors"
          >
            <Pencil className="h-3 w-3" />
          </button>
        </div>
      )}
      {!compact && (
        <CompanionEditDialog
          open={editOpen}
          onOpenChange={setEditOpen}
          currentName={data.companion.name ?? ""}
          currentDisposition={data.companion.disposition as CompanionUpdateDisposition}
        />
      )}
    </div>
  );
}

function CompanionEditDialog({ open, onOpenChange, currentName, currentDisposition }: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  currentName: string;
  currentDisposition: CompanionUpdateDisposition;
}) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const update = useUpdateCompanion();
  const [name, setName] = useState(currentName);
  const [disposition, setDisposition] = useState<CompanionUpdateDisposition>(currentDisposition);

  const save = () => {
    const trimmed = name.trim();
    update.mutate(
      { data: { name: trimmed.length ? trimmed : null, disposition } },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getGetHeroStatusQueryKey() });
          toast({ title: "Companion updated", className: "border-primary" });
          onOpenChange(false);
        },
        onError: (err: any) => toast({ title: apiErrorMessage(err, "Couldn't update companion"), variant: "destructive" }),
      },
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm bg-card border-primary/30">
        <DialogHeader>
          <DialogTitle className="text-lg">Your companion</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 mt-1">
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground">Name</label>
            <Input
              value={name}
              maxLength={MAX_NAME}
              placeholder="Name your companion"
              onChange={(e) => setName(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground">Disposition</label>
            <div className="grid grid-cols-3 gap-2">
              {DISPOSITIONS.map((d) => (
                <button
                  key={d.id}
                  type="button"
                  onClick={() => setDisposition(d.id)}
                  className={`rounded-lg border px-2 py-2 text-center transition-colors ${
                    disposition === d.id ? "border-primary bg-primary/10" : "border-border hover:border-primary/40"
                  }`}
                >
                  <span className="block text-sm font-medium">{d.label}</span>
                  <span className="block text-[10px] text-muted-foreground">{d.hint}</span>
                </button>
              ))}
            </div>
          </div>
          <Button className="w-full" onClick={save} disabled={update.isPending}>
            {update.isPending ? "Saving…" : "Save"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
