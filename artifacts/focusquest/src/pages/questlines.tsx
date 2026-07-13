import { useState } from "react";
import { Link } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import { Scroll, Plus, Trophy, ChevronRight } from "lucide-react";
import {
  Questline,
  useGetQuestlines,
  useCreateQuestline,
  getGetQuestlinesQueryKey,
} from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";

function ProgressBar({ done, total }: { done: number; total: number }) {
  const pct = total > 0 ? Math.round((done / total) * 100) : 0;
  return (
    <div className="mt-3">
      <div className="flex justify-between text-xs text-muted-foreground mb-1">
        <span>{done} / {total} quests</span>
        <span>{pct}%</span>
      </div>
      <div className="h-2 rounded-full bg-muted overflow-hidden">
        <div className="h-full bg-primary transition-all duration-500" style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

function QuestlineCard({ ql }: { ql: Questline }) {
  const completed = ql.status === "completed";
  return (
    <Link
      href={`/questlines/${ql.id}`}
      className={`block p-5 rounded-xl border transition-all cursor-pointer ${
        ql.ready
          ? "border-primary bg-primary/5 shadow-[0_0_15px_rgba(0,255,255,0.15)]"
          : completed
            ? "border-muted bg-muted/20 opacity-75"
            : "border-border bg-card hover:border-primary/50"
      }`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2 min-w-0">
          <Scroll className="w-4 h-4 flex-shrink-0" style={ql.color ? { color: ql.color } : undefined} />
          <h3 className={`font-semibold truncate ${completed ? "text-muted-foreground" : "text-foreground"}`}>
            {ql.title}
          </h3>
        </div>
        {ql.ready && (
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
      {ql.description && <p className="text-sm text-muted-foreground mt-1 truncate">{ql.description}</p>}
      <ProgressBar done={ql.done} total={ql.total} />
      <div className="flex justify-end mt-2 text-xs text-muted-foreground">
        <ChevronRight className="w-4 h-4" />
      </div>
    </Link>
  );
}

export default function Questlines() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { data: questlines, isLoading } = useGetQuestlines();
  const createMutation = useCreateQuestline();

  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");

  const handleCreate = () => {
    if (!title.trim()) return;
    createMutation.mutate(
      { data: { title: title.trim(), description: description.trim() || null } },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getGetQuestlinesQueryKey() });
          setTitle("");
          setDescription("");
          setIsCreateOpen(false);
          toast({ title: "Questline created", className: "border-primary" });
        },
        onError: (err: any) => {
          toast({ title: err?.response?.data?.error ?? "Could not create questline", variant: "destructive" });
        },
      },
    );
  };

  return (
    <div className="max-w-3xl mx-auto px-4 py-6">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2"><Scroll className="w-6 h-6 text-primary" /> Questlines</h1>
          <p className="text-sm text-muted-foreground mt-1">Chain related quests toward a bigger goal.</p>
        </div>
        <Button onClick={() => setIsCreateOpen(true)} className="gap-1">
          <Plus className="w-4 h-4" /> New
        </Button>
      </div>

      {isLoading ? (
        <p className="text-muted-foreground">Loading…</p>
      ) : !questlines || questlines.length === 0 ? (
        <div className="text-center py-16 border border-dashed border-border rounded-xl">
          <Scroll className="w-10 h-10 mx-auto text-muted-foreground/50" />
          <p className="mt-3 text-muted-foreground">No questlines yet. Start one to group quests toward a goal.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {questlines.map((ql) => <QuestlineCard key={ql.id} ql={ql} />)}
        </div>
      )}

      <Dialog open={isCreateOpen} onOpenChange={setIsCreateOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>New Questline</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <Input placeholder="Title (e.g. Run a 5K)" value={title} onChange={(e) => setTitle(e.target.value)} autoFocus
              onKeyDown={(e) => { if (e.key === "Enter") handleCreate(); }} />
            <Textarea placeholder="Description (optional)" value={description} onChange={(e) => setDescription(e.target.value)} />
            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={() => setIsCreateOpen(false)}>Cancel</Button>
              <Button onClick={handleCreate} disabled={!title.trim() || createMutation.isPending}>
                {createMutation.isPending ? "Creating…" : "Create"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
