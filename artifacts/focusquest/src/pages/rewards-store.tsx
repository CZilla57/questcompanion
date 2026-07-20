import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useGetCoins,
  getGetCoinsQueryKey,
  useGetRewardStoreItems,
  useCreateRewardStoreItem,
  useDeleteRewardStoreItem,
  useRedeemRewardStoreItem,
  getGetRewardStoreItemsQueryKey,
} from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { apiErrorMessage } from "@/lib/api-error";
import { StatPerksSection } from "@/components/stat-perks-section";
import { PageTabs } from "@/components/page-tabs";
import { Coins, Plus, Trash2, Gift } from "lucide-react";

const TIERS = [
  { value: "small",  label: "Small",  hint: "☕ quick",   cost: 20 },
  { value: "medium", label: "Medium", hint: "🍿 episode", cost: 60 },
  { value: "large",  label: "Large",  hint: "🍕 takeout", cost: 150 },
  { value: "treat",  label: "Treat",  hint: "🚗 splurge", cost: 400 },
] as const;

type TierValue = (typeof TIERS)[number]["value"];

export default function RewardsStore() {
  const { data: coins } = useGetCoins();
  const balance = coins?.balance ?? 0;
  const { data: items = [], isLoading } = useGetRewardStoreItems();
  const createMutation = useCreateRewardStoreItem();
  const deleteMutation = useDeleteRewardStoreItem();
  const redeemMutation = useRedeemRewardStoreItem();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const [label, setLabel] = useState("");
  const [tier, setTier] = useState<TierValue>("small");

  const atLimit = items.length >= 20;

  const invalidateAll = () => {
    queryClient.invalidateQueries({ queryKey: getGetRewardStoreItemsQueryKey() });
    queryClient.invalidateQueries({ queryKey: getGetCoinsQueryKey() });
  };

  const handleAdd = () => {
    const trimmed = label.trim();
    if (!trimmed) return;
    createMutation.mutate(
      { data: { label: trimmed, tier } },
      {
        onSuccess: () => { setLabel(""); invalidateAll(); },
        onError: (err: any) => toast({ title: apiErrorMessage(err, "Failed to add reward"), variant: "destructive" }),
      },
    );
  };

  const handleDelete = (id: number) => {
    deleteMutation.mutate({ id }, { onSuccess: invalidateAll });
  };

  const handleRedeem = (id: number, itemLabel: string) => {
    redeemMutation.mutate(
      { id },
      {
        onSuccess: (res) => {
          invalidateAll();
          if (res.redeemed) {
            toast({ title: `Enjoy it! 🎉`, description: itemLabel });
          } else {
            toast({ title: `${res.remaining} more to go`, description: `Keep going — you're close.` });
          }
        },
        onError: (err: any) => toast({ title: apiErrorMessage(err, "Couldn't redeem"), variant: "destructive" }),
      },
    );
  };

  return (
    <div className="space-y-8 animate-in fade-in duration-500 max-w-xl">
      <PageTabs group="rewards" />
      {/* Header + balance */}
      <div>
        <div className="flex items-center justify-between gap-3 mb-2">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-amber-400/15 border border-amber-400/30 flex items-center justify-center">
              <Gift className="w-5 h-5 text-amber-400" />
            </div>
            <h1 className="text-3xl font-bold text-foreground">Rewards Store</h1>
          </div>
          <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-full border border-amber-400/30 bg-amber-400/10 text-amber-300">
            <Coins className="w-4 h-4" />
            <span className="font-semibold tabular-nums">{balance}</span>
          </div>
        </div>
        <p className="text-muted-foreground leading-relaxed">
          Real-life rewards you earn the right to enjoy. Complete quests to earn coins, then cash them in — no rush, coins never expire.
        </p>
      </div>

      {/* Stat Perks — in-game power-ups bought with coins */}
      <StatPerksSection />

      {/* Add reward */}
      <div className="bg-card rounded-xl border border-border p-5 space-y-4">
        <h2 className="text-sm font-semibold text-foreground flex items-center gap-2">
          <Plus className="w-4 h-4 text-primary" />
          Add a reward
        </h2>

        <Input
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          placeholder="e.g. Order takeout"
          maxLength={100}
          disabled={atLimit || createMutation.isPending}
          className="border-border focus:border-primary"
          onKeyDown={(e) => { if (e.key === "Enter") handleAdd(); }}
        />

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          {TIERS.map((t) => (
            <button
              key={t.value}
              onClick={() => setTier(t.value)}
              disabled={atLimit}
              className={`flex flex-col items-start gap-0.5 px-3 py-2 rounded-lg border text-left transition-all ${
                tier === t.value
                  ? "border-amber-400/50 bg-amber-400/10 text-foreground"
                  : "border-border bg-muted/30 text-muted-foreground hover:border-amber-400/30"
              }`}
            >
              <span className="text-sm font-medium">{t.label}</span>
              <span className="text-xs">{t.hint}</span>
              <span className="text-xs text-amber-300/80 flex items-center gap-1"><Coins className="w-3 h-3" />{t.cost}</span>
            </button>
          ))}
        </div>

        <Button
          onClick={handleAdd}
          disabled={!label.trim() || atLimit || createMutation.isPending}
          className="bg-primary hover:bg-primary/90 text-primary-foreground w-full"
        >
          {createMutation.isPending ? "Adding…" : "Add reward"}
        </Button>

        {atLimit && (
          <p className="text-xs text-muted-foreground">You've reached the 20-reward limit. Remove one to add more.</p>
        )}
      </div>

      {/* Reward list */}
      <div className="space-y-3">
        <h2 className="text-sm font-semibold text-foreground">
          Your rewards
          <span className="ml-2 text-xs text-muted-foreground font-normal">({items.length}/20)</span>
        </h2>

        {isLoading ? (
          <div className="space-y-2">
            {[...Array(3)].map((_, i) => <div key={i} className="h-16 rounded-xl bg-muted/30 animate-pulse" />)}
          </div>
        ) : items.length === 0 ? (
          <div className="rounded-xl border border-dashed border-border p-8 text-center">
            <Gift className="w-8 h-8 text-muted-foreground/40 mx-auto mb-3" />
            <p className="text-sm text-muted-foreground">No rewards yet.</p>
            <p className="text-xs text-muted-foreground/60 mt-1">Add something worth saving up for.</p>
          </div>
        ) : (
          <div className="space-y-2">
            {items.map((item) => (
              <div key={item.id} className="group flex items-center gap-3 px-4 py-3 rounded-xl bg-card border border-border">
                <div className="flex-1 min-w-0">
                  <div className="text-sm text-foreground truncate">{item.label}</div>
                  <div className="text-xs text-amber-300/80 flex items-center gap-1 mt-0.5">
                    <Coins className="w-3 h-3" />{item.coinCost}
                  </div>
                </div>
                {item.affordable ? (
                  <Button
                    size="sm"
                    onClick={() => handleRedeem(item.id, item.label)}
                    disabled={redeemMutation.isPending}
                    className="bg-amber-500 hover:bg-amber-500/90 text-black shrink-0"
                  >
                    Redeem
                  </Button>
                ) : (
                  <span className="text-xs text-muted-foreground shrink-0 tabular-nums">{item.remaining} more to go</span>
                )}
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => handleDelete(item.id)}
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
