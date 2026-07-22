// Act VI Quest Campaigns: one running campaign, everything else set aside or
// finished. Anti-shame law: a set-aside campaign is a CHOICE, never a failure —
// no gap counts, no decay, no nagging anywhere on this page.
import { useState } from "react";
import { Link, useLocation } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import { Map as MapIcon, Plus, Trophy, ChevronRight, Sparkles, X } from "lucide-react";
import {
  Campaign,
  useGetCampaigns,
  useCreateCampaign,
  useSuggestCampaignArc,
  getGetCampaignsQueryKey,
} from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { apiErrorMessage } from "@/lib/api-error";
import { PageTabs } from "@/components/page-tabs";

function ChapterBar({ done, total }: { done: number; total: number }) {
  const pct = total > 0 ? Math.round((done / total) * 100) : 0;
  return (
    <div className="mt-3">
      <div className="flex justify-between text-xs text-muted-foreground mb-1">
        <span>{done} / {total} chapters</span>
        <span>{pct}%</span>
      </div>
      <div className="h-2 rounded-full bg-muted overflow-hidden">
        <div className="h-full bg-primary transition-all duration-500" style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

function CampaignCard({ c, large }: { c: Campaign; large?: boolean }) {
  const completed = c.status === "completed";
  return (
    <Link
      href={`/campaigns/${c.id}`}
      className={`block rounded-xl border transition-all cursor-pointer ${large ? "p-6" : "p-5"} ${
        c.ready
          ? "border-primary bg-primary/5 shadow-[0_0_15px_rgba(0,255,255,0.15)]"
          : completed
            ? "border-muted bg-muted/20 opacity-75"
            : "border-border bg-card hover:border-primary/50"
      }`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2 min-w-0">
          <MapIcon className="w-4 h-4 flex-shrink-0 text-primary" />
          <h3 className={`font-semibold truncate ${completed ? "text-muted-foreground" : "text-foreground"}`}>
            {c.title}
          </h3>
        </div>
        {c.ready && (
          <span className="inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full border border-primary text-primary uppercase tracking-wider whitespace-nowrap">
            <Trophy className="w-3 h-3" /> Ready
          </span>
        )}
        {completed && (
          <span className="text-[10px] font-bold px-2 py-0.5 rounded-full border border-emerald-500/30 bg-emerald-500/10 text-emerald-400 uppercase tracking-wider">
            Done
          </span>
        )}
      </div>
      {c.arcPremise && <p className="text-sm text-muted-foreground mt-2 italic">{c.arcPremise}</p>}
      <ChapterBar done={c.done} total={c.total} />
      <div className="flex justify-end mt-2 text-xs text-muted-foreground">
        <ChevronRight className="w-4 h-4" />
      </div>
    </Link>
  );
}

export default function Campaigns() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { data: campaigns, isLoading } = useGetCampaigns();
  const createMutation = useCreateCampaign();
  const suggestMutation = useSuggestCampaignArc();
  const [, navigate] = useLocation();

  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [arc, setArc] = useState<{ premise: string; ending: string; source: "ai" | "curated" } | null>(null);
  const [chapters, setChapters] = useState<{ id: string; title: string; beat: string }[]>([]);

  const running = (campaigns ?? []).filter((c) => c.status === "running");
  const setAside = (campaigns ?? []).filter((c) => c.status === "set_aside");
  const finished = (campaigns ?? []).filter((c) => c.status === "completed");

  const reset = () => {
    setTitle("");
    setArc(null);
    setChapters([]);
    setIsCreateOpen(false);
  };

  const handleDraft = () => {
    if (!title.trim()) return;
    suggestMutation.mutate({ data: { goal: title.trim() } }, {
      onSuccess: (res) => {
        setArc({ premise: res.arcPremise, ending: res.endingBeat, source: res.source });
        setChapters(res.chapters.map((c) => ({ id: crypto.randomUUID(), title: c.title, beat: c.beat })));
        if (res.source === "curated") {
          toast({ title: "Drafted a classic arc — name the chapters yourself." });
        }
      },
      onError: (err: any) => {
        toast({ title: apiErrorMessage(err, "Couldn't draft an arc — you can still name chapters yourself."), variant: "destructive" });
      },
    });
  };

  const handleCreate = () => {
    if (!title.trim()) return;
    const kept = chapters
      .filter((c) => c.title.trim())
      .map((c) => ({ title: c.title.trim(), beat: c.beat || null }));
    createMutation.mutate(
      {
        data: {
          title: title.trim(),
          arcPremise: arc?.premise ?? null,
          endingBeat: arc?.ending ?? null,
          storySource: arc?.source ?? "curated",
          ...(kept.length ? { chapters: kept } : {}),
        },
      },
      {
        onSuccess: (created) => {
          queryClient.invalidateQueries({ queryKey: getGetCampaignsQueryKey() });
          reset();
          toast({ title: "Campaign begun", className: "border-primary" });
          navigate(`/campaigns/${created.id}`);
        },
        onError: (err: any) => {
          toast({ title: apiErrorMessage(err, "Could not start campaign"), variant: "destructive" });
        },
      },
    );
  };

  return (
    <div className="max-w-3xl mx-auto px-4 py-6">
      <PageTabs group="quests" />
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2"><MapIcon className="w-6 h-6 text-primary" /> Campaigns</h1>
          <p className="text-sm text-muted-foreground mt-1">One long goal at a time, told in chapters.</p>
        </div>
        <Button onClick={() => setIsCreateOpen(true)} className="gap-1">
          <Plus className="w-4 h-4" /> New
        </Button>
      </div>

      {isLoading ? (
        <p className="text-muted-foreground">Loading…</p>
      ) : (campaigns ?? []).length === 0 ? (
        <div className="text-center py-16 border border-dashed border-border rounded-xl">
          <MapIcon className="w-10 h-10 mx-auto text-muted-foreground/50" />
          <p className="mt-3 text-muted-foreground">No campaign yet. Start one when you have a goal worth several weeks.</p>
        </div>
      ) : (
        <div className="space-y-6">
          {running.map((c) => <CampaignCard key={c.id} c={c} large />)}

          {setAside.length > 0 && (
            <div>
              <h2 className="text-xs font-bold uppercase tracking-wider text-muted-foreground mb-2">Set aside</h2>
              <div className="space-y-3 opacity-80">
                {setAside.map((c) => <CampaignCard key={c.id} c={c} />)}
              </div>
            </div>
          )}

          {finished.length > 0 && (
            <div>
              <h2 className="text-xs font-bold uppercase tracking-wider text-muted-foreground mb-2">Chronicle</h2>
              <div className="space-y-3">
                {finished.map((c) => <CampaignCard key={c.id} c={c} />)}
              </div>
            </div>
          )}
        </div>
      )}

      <Dialog open={isCreateOpen} onOpenChange={(o) => (o ? setIsCreateOpen(true) : reset())}>
        <DialogContent>
          <DialogHeader><DialogTitle>New Campaign</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <Input placeholder="The goal (e.g. Make the garage usable)" value={title} autoFocus
              onChange={(e) => setTitle(e.target.value)} />

            <div className="flex items-center justify-between">
              <Button type="button" variant="outline" size="sm" className="gap-1"
                onClick={handleDraft} disabled={!title.trim() || suggestMutation.isPending}>
                <Sparkles className="w-3.5 h-3.5" />
                {suggestMutation.isPending ? "Drafting…" : "Draft the arc"}
              </Button>
              {chapters.length > 0 && <span className="text-xs text-muted-foreground">Edit anything before starting</span>}
            </div>

            {arc?.premise && <p className="text-sm italic text-muted-foreground border-l-2 border-primary/40 pl-3">{arc.premise}</p>}

            {chapters.length > 0 && (
              <div className="space-y-2 max-h-64 overflow-y-auto pr-1">
                {chapters.map((c, i) => (
                  <div key={c.id} className="flex items-start gap-2">
                    <span className="text-xs text-muted-foreground pt-2.5 w-4 text-right">{i + 1}</span>
                    <div className="flex-1 space-y-1">
                      <Input value={c.title} placeholder={`Chapter ${i + 1} — what happens in it`}
                        onChange={(e) => setChapters((p) => p.map((x, j) => (j === i ? { ...x, title: e.target.value } : x)))} />
                      {c.beat && <p className="text-xs text-muted-foreground italic pl-1">{c.beat}</p>}
                    </div>
                    <Button type="button" variant="ghost" size="icon" className="h-8 w-8 shrink-0"
                      aria-label={`Remove chapter ${i + 1}`}
                      onClick={() => setChapters((p) => p.filter((_, j) => j !== i))}>
                      <X className="w-4 h-4" />
                    </Button>
                  </div>
                ))}
              </div>
            )}

            {running.length > 0 && (
              <p className="text-xs text-muted-foreground">
                Starting this sets “{running[0]!.title}” aside. Nothing is lost — you can pick it back up whenever.
              </p>
            )}

            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={reset}>Cancel</Button>
              <Button onClick={handleCreate} disabled={!title.trim() || createMutation.isPending}>
                {createMutation.isPending ? "Starting…" : "Begin"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
