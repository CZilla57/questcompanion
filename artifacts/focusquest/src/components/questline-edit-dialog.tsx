import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  Questline,
  useUpdateQuestline,
  getGetQuestlineQueryKey,
  getGetQuestlinesQueryKey,
} from "@workspace/api-client-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";

// Preset accent palette (theme-aligned); "None" clears the color to null.
const QUESTLINE_COLORS = ["#22d3ee", "#a78bfa", "#34d399", "#fbbf24", "#fb7185", "#38bdf8", "#a3e635"];

export function QuestlineEditDialog({
  questline,
  open,
  onOpenChange,
}: {
  questline: Questline;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const updateMutation = useUpdateQuestline();

  const [title, setTitle] = useState(questline.title);
  const [description, setDescription] = useState(questline.description ?? "");
  const [color, setColor] = useState<string | null>(questline.color ?? null);

  // Re-seed the form whenever a different questline (or fresh open) drives the dialog.
  useEffect(() => {
    if (open) {
      setTitle(questline.title);
      setDescription(questline.description ?? "");
      setColor(questline.color ?? null);
    }
  }, [open, questline.id, questline.title, questline.description, questline.color]);

  const handleSave = () => {
    if (!title.trim()) return;
    updateMutation.mutate(
      { id: questline.id, data: { title: title.trim(), description: description.trim() || null, color } },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getGetQuestlineQueryKey(questline.id) });
          queryClient.invalidateQueries({ queryKey: getGetQuestlinesQueryKey() });
          onOpenChange(false);
          toast({ title: "Questline updated", className: "border-primary" });
        },
        onError: (err: any) => {
          toast({ title: err?.response?.data?.error ?? "Could not update questline", variant: "destructive" });
        },
      },
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader><DialogTitle>Edit Questline</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <Input placeholder="Title" value={title} onChange={(e) => setTitle(e.target.value)} autoFocus />
          <Textarea placeholder="Description (optional)" value={description} onChange={(e) => setDescription(e.target.value)} />
          <div>
            <label className="text-sm text-muted-foreground">Accent color</label>
            <div className="flex flex-wrap items-center gap-2 mt-1.5">
              {QUESTLINE_COLORS.map((c) => (
                <button
                  key={c}
                  type="button"
                  aria-label={`Color ${c}`}
                  onClick={() => setColor(c)}
                  className={`w-7 h-7 rounded-full border-2 transition-transform ${color === c ? "ring-2 ring-offset-2 ring-offset-background ring-foreground scale-110" : "border-transparent"}`}
                  style={{ backgroundColor: c }}
                />
              ))}
              <button
                type="button"
                aria-label="No color"
                onClick={() => setColor(null)}
                className={`px-3 h-7 rounded-full border text-xs ${color == null ? "border-foreground text-foreground" : "border-border text-muted-foreground"}`}
              >
                None
              </button>
            </div>
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button onClick={handleSave} disabled={!title.trim() || updateMutation.isPending}>
              {updateMutation.isPending ? "Saving…" : "Save"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
