import { useRoute, useLocation, Link } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Scroll, Trophy, Pencil, Trash2 } from "lucide-react";
import {
  useGetQuestline,
  useClaimQuestline,
  useDeleteQuestline,
  getGetQuestlineQueryKey,
  getGetQuestlinesQueryKey,
  getGetMyStatsQueryKey,
  getGetCoinsQueryKey,
} from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { TaskItem } from "@/components/task-item";
import { dispatchQuestCompleted } from "@/components/dopamine-overlay";
import { useToast } from "@/hooks/use-toast";
import { apiErrorMessage } from "@/lib/api-error";
import { featureLabel } from "@/lib/feature-gates";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { QuickAddBar } from "@/components/quick-add-bar";
import { QuestlineEditDialog } from "@/components/questline-edit-dialog";
import { useState } from "react";

export default function QuestlineDetail() {
  const [, params] = useRoute("/questlines/:id");
  const id = params?.id ? parseInt(params.id, 10) : NaN;
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data, isLoading } = useGetQuestline(id, {
    query: { enabled: !isNaN(id), queryKey: getGetQuestlineQueryKey(id) },
  });
  const claimMutation = useClaimQuestline();

  const [, navigate] = useLocation();
  const [editOpen, setEditOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const deleteMutation = useDeleteQuestline();

  if (isLoading) return <div className="max-w-3xl mx-auto px-4 py-6 text-muted-foreground">Loading…</div>;
  if (!data) return <div className="max-w-3xl mx-auto px-4 py-6 text-muted-foreground">Questline not found.</div>;

  const { questline, quests } = data;
  const pct = questline.total > 0 ? Math.round((questline.done / questline.total) * 100) : 0;

  const handleDelete = () => {
    deleteMutation.mutate({ id }, {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getGetQuestlinesQueryKey() });
        toast({ title: "Questline deleted" });
        navigate("/questlines");
      },
      onError: (err: any) => {
        toast({ title: apiErrorMessage(err, "Could not delete questline"), variant: "destructive" });
      },
    });
  };

  const handleClaim = () => {
    claimMutation.mutate({ id }, {
      onSuccess: (res) => {
        queryClient.invalidateQueries({ queryKey: getGetQuestlineQueryKey(id) });
        queryClient.invalidateQueries({ queryKey: getGetQuestlinesQueryKey() });
        queryClient.invalidateQueries({ queryKey: getGetMyStatsQueryKey() });
        queryClient.invalidateQueries({ queryKey: getGetCoinsQueryKey() });
        dispatchQuestCompleted();

        // The chapter beat (if this questline is a campaign chapter) stays
        // first and always shown; level-up/unlock copy is appended after it —
        // composed the same way campaign-detail.tsx builds its own claim
        // description.
        const parts: string[] = [];
        if (questline.chapterBeat) parts.push(questline.chapterBeat);
        if (res.leveledUp) {
          parts.push(
            `Level up! You're now ${res.levelName}.${
              res.newlyUnlocked.length > 0
                ? ` ${res.newlyUnlocked.map(featureLabel).join(" & ")} unlocked!`
                : ""
            }`,
          );
        }

        toast({
          title: `Questline complete! +${res.xpAwarded} XP`,
          description: parts.length > 0 ? parts.join(" ") : undefined,
          className: "border-primary bg-primary text-primary-foreground",
        });
      },
      onError: (err: any) => {
        toast({ title: apiErrorMessage(err, "Could not claim reward"), variant: "destructive" });
      },
    });
  };

  return (
    <div className="max-w-3xl mx-auto px-4 py-6">
      <Link href="/questlines" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground mb-4">
        <ArrowLeft className="w-4 h-4" /> Questlines
      </Link>

      <div className="p-5 rounded-xl border border-border bg-card mb-6">
        <div className="flex items-center gap-2">
          <Scroll className="w-5 h-5 text-primary shrink-0" style={questline.color ? { color: questline.color } : undefined} />
          <h1 className="text-xl font-bold flex-1 min-w-0 truncate">{questline.title}</h1>
          <Button variant="ghost" size="icon" aria-label="Edit questline" className="h-8 w-8 shrink-0" onClick={() => setEditOpen(true)}>
            <Pencil className="w-4 h-4" />
          </Button>
          <Button variant="ghost" size="icon" aria-label="Delete questline" className="h-8 w-8 shrink-0 hover:text-destructive" onClick={() => setDeleteOpen(true)}>
            <Trash2 className="w-4 h-4" />
          </Button>
        </div>
        {questline.description && <p className="text-sm text-muted-foreground mt-1">{questline.description}</p>}

        <div className="mt-4">
          <div className="flex justify-between text-xs text-muted-foreground mb-1">
            <span>{questline.done} / {questline.total} quests</span>
            <span>{pct}%</span>
          </div>
          <div className="h-2 rounded-full bg-muted overflow-hidden">
            <div className="h-full bg-primary transition-all duration-500" style={{ width: `${pct}%` }} />
          </div>
        </div>

        {questline.ready && (
          <Button onClick={handleClaim} disabled={claimMutation.isPending} className="mt-4 w-full gap-1">
            <Trophy className="w-4 h-4" />
            {claimMutation.isPending ? "Claiming…" : "Claim reward"}
          </Button>
        )}
        {questline.status === "completed" && (
          <p className="mt-4 text-sm text-emerald-400 flex items-center gap-1">
            <Trophy className="w-4 h-4" /> Completed — {questline.rewardXpAwarded} XP claimed
          </p>
        )}
      </div>

      {questline.status !== "completed" && (
        <div className="mb-4">
          <QuickAddBar selectedDate={new Date()} questlineId={questline.id} />
        </div>
      )}

      {quests.length === 0 ? (
        <p className="text-muted-foreground text-center py-6">
          No quests yet — add one above to start this questline.
        </p>
      ) : (
        <div className="space-y-3">
          {quests.map((task) => <TaskItem key={task.id} task={task} />)}
        </div>
      )}

      <QuestlineEditDialog questline={questline} open={editOpen} onOpenChange={setEditOpen} />

      <Dialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Delete this questline?</DialogTitle></DialogHeader>
          <p className="text-sm text-muted-foreground">
            Its {questline.total} quest{questline.total === 1 ? "" : "s"} will be unlinked (kept as regular quests), and this questline will be removed.
          </p>
          <div className="flex justify-end gap-2 mt-4">
            <Button variant="ghost" onClick={() => setDeleteOpen(false)}>Cancel</Button>
            <Button variant="destructive" onClick={handleDelete} disabled={deleteMutation.isPending}>
              {deleteMutation.isPending ? "Deleting…" : "Delete"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
