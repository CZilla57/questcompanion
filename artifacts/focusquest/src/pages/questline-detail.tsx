import { useRoute, Link } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Scroll, Trophy } from "lucide-react";
import {
  useGetQuestline,
  useClaimQuestline,
  getGetQuestlineQueryKey,
  getGetQuestlinesQueryKey,
  getGetMyStatsQueryKey,
} from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { TaskItem } from "@/components/task-item";
import { dispatchQuestCompleted } from "@/components/dopamine-overlay";
import { useToast } from "@/hooks/use-toast";

export default function QuestlineDetail() {
  const [, params] = useRoute("/questlines/:id");
  const id = params?.id ? parseInt(params.id, 10) : NaN;
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data, isLoading } = useGetQuestline(id, {
    query: { enabled: !isNaN(id), queryKey: getGetQuestlineQueryKey(id) },
  });
  const claimMutation = useClaimQuestline();

  const handleClaim = () => {
    claimMutation.mutate({ id }, {
      onSuccess: (res) => {
        queryClient.invalidateQueries({ queryKey: getGetQuestlineQueryKey(id) });
        queryClient.invalidateQueries({ queryKey: getGetQuestlinesQueryKey() });
        queryClient.invalidateQueries({ queryKey: getGetMyStatsQueryKey() });
        dispatchQuestCompleted();
        toast({
          title: `Questline complete! +${res.xpAwarded} XP`,
          description: res.leveledUp ? `Level up! You're now ${res.levelName}.` : undefined,
          className: "border-primary bg-primary text-primary-foreground",
        });
      },
      onError: (err: any) => {
        toast({ title: err?.response?.data?.error ?? "Could not claim reward", variant: "destructive" });
      },
    });
  };

  if (isLoading) return <div className="max-w-3xl mx-auto px-4 py-6 text-muted-foreground">Loading…</div>;
  if (!data) return <div className="max-w-3xl mx-auto px-4 py-6 text-muted-foreground">Questline not found.</div>;

  const { questline, quests } = data;
  const pct = questline.total > 0 ? Math.round((questline.done / questline.total) * 100) : 0;

  return (
    <div className="max-w-3xl mx-auto px-4 py-6">
      <Link href="/questlines" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground mb-4">
        <ArrowLeft className="w-4 h-4" /> Questlines
      </Link>

      <div className="p-5 rounded-xl border border-border bg-card mb-6">
        <div className="flex items-center gap-2">
          <Scroll className="w-5 h-5 text-primary" style={questline.color ? { color: questline.color } : undefined} />
          <h1 className="text-xl font-bold">{questline.title}</h1>
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

      {quests.length === 0 ? (
        <p className="text-muted-foreground text-center py-8">
          No quests yet. Assign quests to this questline from the Quest Log.
        </p>
      ) : (
        <div className="space-y-3">
          {quests.map((task) => <TaskItem key={task.id} task={task} />)}
        </div>
      )}
    </div>
  );
}
