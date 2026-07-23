// Chapters render in story order with a "current chapter" pointer, but NOTHING
// here hides or blocks a later chapter — ordered, never gated. Every chapter
// links straight to its questline so the work stays one tap away.
//
// A completed campaign is a permanent chronicle entry: the server 409s any
// status change or delete out of "completed", so this page never offers
// set-aside/resume or delete once a campaign is done.
import { useState } from "react";
import { Link, useParams, useLocation } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import { Map as MapIcon, Trophy, ChevronRight, Check, Pause, Play, Trash2, Plus, X } from "lucide-react";
import {
  useGetCampaign, useUpdateCampaign, useClaimCampaign, useDeleteCampaign,
  useGetQuestlines, useUpdateQuestline,
  getGetCampaignQueryKey, getGetCampaignsQueryKey, getGetQuestlinesQueryKey, getGetMyStatsQueryKey,
  ApiError,
} from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { apiErrorMessage } from "@/lib/api-error";
import { featureLabel } from "@/lib/feature-gates";

// Must stay in lockstep with MAX_CHAPTERS in artifacts/api-server/src/lib/campaign-arc.ts
const MAX_CHAPTERS = 5;

export default function CampaignDetail() {
  const params = useParams();
  const id = parseInt(params.id ?? "", 10);
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [, navigate] = useLocation();
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [addChapterOpen, setAddChapterOpen] = useState(false);
  const [removeChapter, setRemoveChapter] = useState<{ id: number; title: string } | null>(null);

  const { data, isLoading } = useGetCampaign(id);
  const updateMutation = useUpdateCampaign();
  const claimMutation = useClaimCampaign();
  const deleteMutation = useDeleteCampaign();
  const attachMutation = useUpdateQuestline();

  // Eligible chapters = the user's own questlines not already claimed by any
  // campaign (server enforces one-campaign-per-questline-ever with a 409, so
  // the picker only ever offers ones that are actually free to attach).
  // Fetched lazily — only once the dialog is open — since this list is only
  // ever needed there.
  const { data: allQuestlines, isLoading: questlinesLoading } = useGetQuestlines(undefined, {
    query: { enabled: addChapterOpen, queryKey: getGetQuestlinesQueryKey() },
  });
  const eligibleQuestlines = (allQuestlines ?? []).filter((q) => q.campaignId == null);

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: getGetCampaignQueryKey(id) });
    queryClient.invalidateQueries({ queryKey: getGetCampaignsQueryKey() });
  };

  if (isLoading) return <div className="max-w-3xl mx-auto px-4 py-6 text-muted-foreground">Loading…</div>;
  if (!data) return <div className="max-w-3xl mx-auto px-4 py-6 text-muted-foreground">Campaign not found.</div>;

  const { campaign, chapters, currentChapterId } = data;

  const handleClaim = () => {
    claimMutation.mutate({ id }, {
      onSuccess: (res) => {
        refresh();
        // A campaign claim mutates XP/weekly points/level exactly like a
        // questline claim — the persistent header and feature gates need the
        // same invalidation questline-detail already does, or they go stale.
        queryClient.invalidateQueries({ queryKey: getGetMyStatsQueryKey() });

        // endingBeat (the finale story line) stays first and always shown;
        // level-up/unlock copy is appended after it, composed the same way
        // questline-detail.tsx builds its own claim description.
        const parts: string[] = [];
        if (res.endingBeat) parts.push(res.endingBeat);
        if (res.leveledUp) {
          const unlocked = res.newlyUnlocked ?? [];
          parts.push(
            `Level up! You're now ${res.levelName}.${
              unlocked.length > 0 ? ` ${unlocked.map(featureLabel).join(" & ")} unlocked!` : ""
            }`,
          );
        }

        toast({
          title: `Campaign complete — ${res.xpAwarded} XP`,
          description: parts.length > 0 ? parts.join(" ") : undefined,
          className: "border-primary",
        });
      },
      onError: (err: any) => {
        toast({ title: apiErrorMessage(err, "Could not claim reward"), variant: "destructive" });
      },
    });
  };

  const handleAttach = (questlineId: number) => {
    // New chapters land at the end of the current order — computed from the
    // chapters already on the page, not from any client-side counter.
    const nextChapterOrder = chapters.length
      ? Math.max(...chapters.map((c) => c.chapterOrder ?? -1)) + 1
      : 0;

    attachMutation.mutate(
      { id: questlineId, data: { campaignId: id, chapterOrder: nextChapterOrder } },
      {
        onSuccess: () => {
          refresh();
          queryClient.invalidateQueries({ queryKey: getGetQuestlinesQueryKey() });
          setAddChapterOpen(false);
          toast({ title: "Chapter added", className: "border-primary" });
        },
        onError: (err: unknown) => {
          // Someone else may have just claimed this questline for another
          // campaign, or the campaign itself finished — refresh the list so
          // the dialog doesn't keep offering something that's no longer free.
          queryClient.invalidateQueries({ queryKey: getGetQuestlinesQueryKey() });
          const status = err instanceof ApiError ? err.status : null;
          toast({
            // A 409 here (already spoken for, or campaign just completed) is
            // a plain explanation, not an error scold — no destructive style.
            title: apiErrorMessage(err, "Could not add that chapter"),
            variant: status === 409 ? undefined : "destructive",
          });
        },
      },
    );
  };

  // Detach via the same questline-update hook the picker uses to attach —
  // the server enforces every rule (a completed campaign's chapters 409),
  // this just gives an in-app way out of a mis-added chapter instead of
  // deleting the whole campaign. The questline and its quests are untouched;
  // it only stops being a chapter here.
  const handleRemoveChapter = () => {
    if (!removeChapter) return;
    attachMutation.mutate(
      { id: removeChapter.id, data: { campaignId: null } },
      {
        onSuccess: () => {
          refresh();
          queryClient.invalidateQueries({ queryKey: getGetQuestlinesQueryKey() });
          setRemoveChapter(null);
          toast({ title: "Chapter removed — the questline is still right where it was" });
        },
        onError: (err: unknown) => {
          refresh();
          const status = err instanceof ApiError ? err.status : null;
          toast({
            // A 409 here (campaign just completed) is a plain explanation,
            // not an error scold — no destructive style.
            title: apiErrorMessage(err, "Could not remove that chapter"),
            variant: status === 409 ? undefined : "destructive",
          });
        },
      },
    );
  };

  const handleStatus = (status: "running" | "set_aside") => {
    updateMutation.mutate({ id, data: { status } }, {
      onSuccess: () => {
        refresh();
        toast({ title: status === "set_aside" ? "Set aside — it'll be here when you want it" : "Picked back up" });
      },
      onError: (err: any) => {
        toast({ title: apiErrorMessage(err, "Could not update campaign"), variant: "destructive" });
      },
    });
  };

  const handleDelete = () => {
    deleteMutation.mutate({ id }, {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getGetCampaignsQueryKey() });
        navigate("/campaigns");
        toast({ title: "Campaign deleted — your quests are untouched" });
      },
      onError: (err: any) => {
        setDeleteOpen(false);
        toast({ title: apiErrorMessage(err, "Could not delete campaign"), variant: "destructive" });
      },
    });
  };

  return (
    <div className="max-w-3xl mx-auto px-4 py-6">
      <Link href="/campaigns" className="text-sm text-muted-foreground hover:text-foreground">← Campaigns</Link>

      <div className="mt-3 flex items-start justify-between gap-3">
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <MapIcon className="w-6 h-6 text-primary" /> {campaign.title}
        </h1>
        <div className="flex gap-1">
          {campaign.status === "running" && (
            <Button variant="ghost" size="icon" aria-label="Set aside" onClick={() => handleStatus("set_aside")}>
              <Pause className="w-4 h-4" />
            </Button>
          )}
          {campaign.status === "set_aside" && (
            <Button variant="ghost" size="icon" aria-label="Pick back up" onClick={() => handleStatus("running")}>
              <Play className="w-4 h-4" />
            </Button>
          )}
          {campaign.status !== "completed" && (
            <Button variant="ghost" size="icon" aria-label="Delete campaign" onClick={() => setDeleteOpen(true)}>
              <Trash2 className="w-4 h-4" />
            </Button>
          )}
        </div>
      </div>

      {campaign.arcPremise && (
        <p className="mt-3 text-muted-foreground italic border-l-2 border-primary/40 pl-3">{campaign.arcPremise}</p>
      )}

      {campaign.status === "set_aside" && (
        <p className="mt-3 text-sm text-muted-foreground">
          Set aside. The story waited for you — pick it back up whenever you want.
        </p>
      )}

      <p className="mt-4 text-sm text-muted-foreground">{campaign.done} / {campaign.total} chapters</p>

      <div className="mt-4 space-y-3">
        {chapters.map((ch, i) => {
          const done = ch.status === "completed";
          const current = ch.questlineId === currentChapterId;
          // A completed campaign is a permanent chronicle entry — no remove
          // control renders there at all (the server would 409 it anyway).
          const canRemove = campaign.status !== "completed";
          return (
            <div key={ch.questlineId}
              className={`flex items-stretch rounded-xl border transition-all ${
                current ? "border-primary bg-primary/5" : done ? "border-muted bg-muted/20" : "border-border bg-card hover:border-primary/50"
              }`}>
              {/* Remove sits OUTSIDE the Link as a sibling, not nested inside
                  its activation area, so tapping it removes the chapter
                  instead of navigating to the questline. */}
              <Link href={`/questlines/${ch.questlineId}`} className="flex-1 min-w-0 block p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-muted-foreground">Chapter {i + 1}</span>
                      {current && <span className="text-[10px] font-bold uppercase tracking-wider text-primary">Current</span>}
                      {done && <Check className="w-3.5 h-3.5 text-emerald-400" aria-label="Chapter complete" />}
                    </div>
                    <h3 className={`font-semibold truncate ${done ? "text-muted-foreground" : "text-foreground"}`}>{ch.title}</h3>
                    {done && ch.chapterBeat && <p className="text-sm text-muted-foreground italic mt-1">{ch.chapterBeat}</p>}
                    <p className="text-xs text-muted-foreground mt-1">{ch.done} / {ch.total} quests</p>
                  </div>
                  <ChevronRight className="w-4 h-4 text-muted-foreground flex-shrink-0" />
                </div>
              </Link>
              {canRemove && (
                <button
                  type="button"
                  aria-label={`Remove ${ch.title} from this campaign`}
                  onClick={() => setRemoveChapter({ id: ch.questlineId, title: ch.title })}
                  className="shrink-0 px-3 flex items-center text-muted-foreground hover:text-foreground transition-colors"
                >
                  <X className="w-4 h-4" />
                </button>
              )}
            </div>
          );
        })}

        {chapters.length === 0 && (
          <p className="text-sm text-muted-foreground border border-dashed border-border rounded-xl p-6 text-center">
            No chapters yet. Add a chapter below to bring one of your questlines into the story.
          </p>
        )}
      </div>

      {campaign.status !== "completed" && chapters.length < MAX_CHAPTERS && (
        <Button variant="outline" size="sm" className="mt-3 gap-1" onClick={() => setAddChapterOpen(true)}>
          <Plus className="w-4 h-4" /> Add a chapter
        </Button>
      )}

      {campaign.status !== "completed" && chapters.length >= MAX_CHAPTERS && (
        <p className="mt-3 text-xs text-muted-foreground">
          This campaign has its full five chapters.
        </p>
      )}

      {campaign.ready && (
        <Button onClick={handleClaim} disabled={claimMutation.isPending} className="mt-6 w-full gap-1">
          <Trophy className="w-4 h-4" />
          {claimMutation.isPending ? "Claiming…" : "Claim reward"}
        </Button>
      )}

      {campaign.status === "completed" && (
        <div className="mt-6 p-4 rounded-xl border border-emerald-500/30 bg-emerald-500/10">
          <p className="flex items-center gap-2 text-emerald-400 font-semibold">
            <Trophy className="w-4 h-4" /> Completed — {campaign.rewardXpAwarded} XP claimed
          </p>
          {campaign.endingBeat && <p className="text-sm text-muted-foreground italic mt-2">{campaign.endingBeat}</p>}
        </div>
      )}

      <Dialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Delete this campaign?</DialogTitle></DialogHeader>
          <p className="text-sm text-muted-foreground">
            Its chapters and quests stay — they just stop being chapters.
          </p>
          <div className="flex justify-end gap-2 mt-4">
            <Button variant="ghost" onClick={() => setDeleteOpen(false)}>Cancel</Button>
            <Button variant="destructive" onClick={handleDelete} disabled={deleteMutation.isPending}>
              {deleteMutation.isPending ? "Deleting…" : "Delete"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={removeChapter != null} onOpenChange={(o) => !o && setRemoveChapter(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>Remove this chapter?</DialogTitle></DialogHeader>
          <p className="text-sm text-muted-foreground">
            &ldquo;{removeChapter?.title}&rdquo; stays right where it is as a questline — it just stops being a chapter here.
          </p>
          <div className="flex justify-end gap-2 mt-4">
            <Button variant="ghost" onClick={() => setRemoveChapter(null)}>Cancel</Button>
            <Button onClick={handleRemoveChapter} disabled={attachMutation.isPending}>
              {attachMutation.isPending ? "Removing…" : "Remove"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={addChapterOpen} onOpenChange={setAddChapterOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Add a chapter</DialogTitle></DialogHeader>
          <p className="text-sm text-muted-foreground">
            Pick a questline to fold into this campaign as its next chapter.
          </p>
          {questlinesLoading ? (
            <p className="text-sm text-muted-foreground py-4 text-center">Loading…</p>
          ) : eligibleQuestlines.length === 0 ? (
            <p className="text-sm text-muted-foreground border border-dashed border-border rounded-xl p-6 text-center">
              No questlines are free to add right now. Start a new one from Questlines, then come back to add it here.
            </p>
          ) : (
            <div className="space-y-2 max-h-[50vh] overflow-y-auto pr-1">
              {eligibleQuestlines.map((q) => (
                <button
                  key={q.id}
                  type="button"
                  onClick={() => handleAttach(q.id)}
                  disabled={attachMutation.isPending}
                  className="w-full text-left p-3 rounded-xl border border-border bg-card hover:border-primary/50 transition-all disabled:opacity-50"
                >
                  <div className="flex items-center justify-between gap-3">
                    <span className="font-medium truncate">{q.title}</span>
                    {q.status === "completed" && (
                      <Check className="w-3.5 h-3.5 text-emerald-400 flex-shrink-0" aria-label="Already complete" />
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground mt-0.5">{q.done} / {q.total} quests</p>
                </button>
              ))}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
