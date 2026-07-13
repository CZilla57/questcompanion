import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useGetDopamineRewards,
  useCreateDopamineReward,
  useDeleteDopamineReward,
  getGetDopamineRewardsQueryKey,
} from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { apiErrorMessage } from "@/lib/api-error";
import { Plus, Trash2, Coffee, Sparkles } from "lucide-react";

const EXAMPLES = [
  "Make a cup of coffee ☕",
  "5 minutes of YouTube",
  "Quick walk around the block",
  "Check your favourite subreddit",
  "Stretch and breathe for 2 minutes",
  "Grab a snack 🍫",
];

export default function DopamineMenu() {
  const { data: rewards = [], isLoading } = useGetDopamineRewards();
  const createMutation = useCreateDopamineReward();
  const deleteMutation = useDeleteDopamineReward();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [text, setText] = useState("");

  const handleAdd = () => {
    const trimmed = text.trim();
    if (!trimmed) return;
    createMutation.mutate(
      { data: { rewardText: trimmed } },
      {
        onSuccess: () => {
          setText("");
          queryClient.invalidateQueries({ queryKey: getGetDopamineRewardsQueryKey() });
        },
        onError: (err: any) => {
          const msg = apiErrorMessage(err, "Failed to add reward");
          toast({ title: msg, variant: "destructive" });
        },
      },
    );
  };

  const handleDelete = (id: number) => {
    deleteMutation.mutate(
      { id },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getGetDopamineRewardsQueryKey() });
        },
      },
    );
  };

  const handleExample = (example: string) => {
    setText(example);
  };

  const atLimit = rewards.length >= 20;

  return (
    <div className="space-y-8 animate-in fade-in duration-500 max-w-xl">
      {/* Header */}
      <div>
        <div className="flex items-center gap-3 mb-2">
          <div className="w-10 h-10 rounded-xl bg-emerald-400/15 border border-emerald-400/30 flex items-center justify-center">
            <Coffee className="w-5 h-5 text-emerald-400" />
          </div>
          <h1 className="text-3xl font-bold text-foreground">Dopamine Menu</h1>
        </div>
        <p className="text-muted-foreground leading-relaxed">
          Small, healthy rewards you allow yourself after completing quests.
          After each completion, one will be suggested at random.
        </p>
      </div>

      {/* Add reward */}
      <div className="bg-card rounded-xl border border-border p-5 space-y-4">
        <h2 className="text-sm font-semibold text-foreground flex items-center gap-2">
          <Plus className="w-4 h-4 text-primary" />
          Add a reward
        </h2>

        <div className="flex gap-2">
          <Input
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="e.g. 5 minutes of YouTube"
            maxLength={100}
            disabled={atLimit || createMutation.isPending}
            className="flex-1 border-border focus:border-primary"
            onKeyDown={(e) => {
              if (e.key === "Enter") handleAdd();
            }}
          />
          <Button
            onClick={handleAdd}
            disabled={!text.trim() || atLimit || createMutation.isPending}
            className="bg-primary hover:bg-primary/90 text-primary-foreground shrink-0"
          >
            {createMutation.isPending ? "Adding…" : "Add"}
          </Button>
        </div>

        {atLimit && (
          <p className="text-xs text-muted-foreground">
            You've reached the 20-reward limit. Remove one to add more.
          </p>
        )}

        {/* Quick-fill examples */}
        {!atLimit && (
          <div>
            <p className="text-xs text-muted-foreground mb-2">
              <Sparkles className="w-3 h-3 inline mr-1 text-primary" />
              Need inspiration? Tap to fill:
            </p>
            <div className="flex flex-wrap gap-2">
              {EXAMPLES.map((ex) => (
                <button
                  key={ex}
                  onClick={() => handleExample(ex)}
                  className="text-xs px-3 py-1 rounded-full border border-border bg-muted/30 text-muted-foreground hover:border-primary/50 hover:text-foreground hover:bg-primary/5 transition-all cursor-pointer"
                >
                  {ex}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Reward list */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-foreground">
            Your rewards
            <span className="ml-2 text-xs text-muted-foreground font-normal">
              ({rewards.length}/20)
            </span>
          </h2>
        </div>

        {isLoading ? (
          <div className="space-y-2">
            {[...Array(3)].map((_, i) => (
              <div key={i} className="h-14 rounded-xl bg-muted/30 animate-pulse" />
            ))}
          </div>
        ) : rewards.length === 0 ? (
          <div className="rounded-xl border border-dashed border-border p-8 text-center">
            <Coffee className="w-8 h-8 text-muted-foreground/40 mx-auto mb-3" />
            <p className="text-sm text-muted-foreground">No rewards yet.</p>
            <p className="text-xs text-muted-foreground/60 mt-1">
              Add something small that makes you smile.
            </p>
          </div>
        ) : (
          <div className="space-y-2">
            {rewards.map((reward) => (
              <div
                key={reward.id}
                className="group flex items-center gap-3 px-4 py-3 rounded-xl bg-card border border-border hover:border-emerald-400/30 hover:bg-emerald-400/5 transition-all"
              >
                <Coffee className="w-4 h-4 text-emerald-400/60 shrink-0" />
                <span className="flex-1 text-sm text-foreground">{reward.rewardText}</span>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => handleDelete(reward.id)}
                  disabled={deleteMutation.isPending}
                  className="h-7 w-7 opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground hover:text-destructive hover:bg-destructive/10"
                  aria-label="Remove reward"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </Button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
