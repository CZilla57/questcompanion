import { useQueryClient } from "@tanstack/react-query";
import {
  useGetMyFeats, getGetMyFeatsQueryKey,
  useActivateFeat, getGetMyStatsQueryKey,
  useChooseFeatBranch,
  type FeatView, type FeatBranchTree,
} from "@workspace/api-client-react";
import { browserTimeZone } from "@/lib/timezone";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { Lock, Check, GitBranch } from "lucide-react";

/** One unlocked feat: emoji, label, description, and — for active feats — a
 *  once-a-day "Use today" button that settles to "Ready tomorrow" after use. */
function UnlockedFeat({ feat, onActivate, activating }: {
  feat: FeatView;
  onActivate: (id: string) => void;
  activating: boolean;
}) {
  const ready = feat.kind === "active" && feat.readyToday === true && feat.atMax !== true;
  return (
    <div className="flex items-center gap-3 rounded-lg border border-border bg-card/60 p-3">
      <span className="text-xl leading-none" aria-hidden>{feat.emoji}</span>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium">{feat.label}</p>
        <p className="text-xs text-muted-foreground">{feat.description}</p>
      </div>
      {feat.kind === "passive" ? (
        <span className="shrink-0 rounded-full border border-primary/40 bg-primary/10 px-2.5 py-1 text-xs text-primary">
          Always on
        </span>
      ) : ready ? (
        <Button size="sm" disabled={activating} onClick={() => onActivate(feat.id)}>
          Use today
        </Button>
      ) : (
        <span className="shrink-0 text-xs text-muted-foreground">
          {feat.atMax === true ? "Fully warded" : "Ready tomorrow"}
        </span>
      )}
    </div>
  );
}

/** One locked feat: a calm future milestone, never a nag. */
function LockedFeat({ feat }: { feat: FeatView }) {
  return (
    <div className="flex items-center gap-3 rounded-lg border border-dashed border-border/70 p-3 opacity-70">
      <Lock className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium text-muted-foreground">{feat.label}</p>
        <p className="text-xs text-muted-foreground/80">{feat.description}</p>
      </div>
      <span className="shrink-0 text-xs text-muted-foreground">Level {feat.unlockLevel}</span>
    </div>
  );
}

/**
 * Act V: the specialization tree — a chosen "second calling" that grants a
 * passive XP bias in another Life Kingdom. FREE RESPEC: pick any branch anytime,
 * re-choose whenever, nothing ever locked out ("focus, not a cage"). Renders a
 * calm "opens at Level N" until the tree unlocks.
 */
function SpecializationSection({ tree }: { tree: FeatBranchTree }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const choose = useChooseFeatBranch();

  async function pick(branch: string | null) {
    try {
      await choose.mutateAsync({ data: { branch } });
      await qc.invalidateQueries({ queryKey: getGetMyFeatsQueryKey() });
      toast({
        title: branch ? "Calling chosen" : "Calling set aside",
        description: branch ? "Its bias rides your next quests. Change it anytime." : "No specialization for now.",
      });
    } catch {
      toast({ title: "Couldn't set your calling", description: "Please try again.", variant: "destructive" });
    }
  }

  return (
    <div className="space-y-2 pt-1">
      <div className="flex items-center gap-2">
        <GitBranch className="h-4 w-4 text-primary" aria-hidden />
        <p className="text-sm font-semibold">Specialization</p>
        {!tree.unlocked && (
          <span className="text-xs text-muted-foreground">Opens at Level {tree.unlockLevel}</span>
        )}
      </div>
      <p className="text-xs text-muted-foreground">
        Choose a second calling for a +{tree.bonusPct}% XP bias there. Free to change anytime — nothing is ever locked out.
      </p>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        {tree.branches.map((b) => {
          const chosen = tree.chosen === b.id;
          return (
            <div
              key={b.id}
              className={`flex items-start gap-2 rounded-lg border p-3 ${
                chosen ? "border-primary/50 bg-primary/10" : "border-border bg-card/60"
              }`}
            >
              <span className="text-lg leading-none" aria-hidden>{b.emoji}</span>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium">{b.label}</p>
                <p className="text-xs text-muted-foreground">{b.description}</p>
                {chosen ? (
                  <button
                    className="mt-1.5 inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline disabled:opacity-50"
                    onClick={() => pick(null)}
                    disabled={choose.isPending}
                  >
                    <Check className="h-3 w-3" aria-hidden /> Chosen · set aside
                  </button>
                ) : (
                  <Button
                    size="sm"
                    variant="outline"
                    className="mt-1.5 h-7"
                    disabled={!tree.unlocked || choose.isPending}
                    onClick={() => pick(b.id)}
                  >
                    {tree.unlocked ? "Choose" : "Locked"}
                  </Button>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/**
 * Class Feats: the hero's class-specific abilities, unlocked as they level.
 * Sits under the character sheet. Renders nothing until the campaign layer is
 * unlocked (the server returns empty), so it never appears before its time.
 */
export function FeatsPanel() {
  const tz = browserTimeZone();
  const qc = useQueryClient();
  const { toast } = useToast();
  const { data } = useGetMyFeats();
  const activate = useActivateFeat();

  if (!data || (data.unlocked.length === 0 && data.locked.length === 0)) return null;

  async function onActivate(id: string) {
    try {
      const result = await activate.mutateAsync({ id });
      // Refresh feats (readyToday flips) and stats (a granted boost/shield shows).
      await qc.invalidateQueries({ queryKey: getGetMyFeatsQueryKey() });
      await qc.invalidateQueries({ queryKey: getGetMyStatsQueryKey({ tz }) });
      if (result.activated) toast({ title: "Feat used", description: "Its blessing is yours for today." });
      else if (result.reason === "at_max") toast({ title: "Already fully warded", description: "Your streak shield is at its cap." });
      else if (result.reason === "on_cooldown") toast({ title: "Ready tomorrow", description: "This feat renews each day." });
    } catch {
      toast({ title: "Couldn't use the feat", description: "Please try again.", variant: "destructive" });
    }
  }

  return (
    <Card className="bg-card border-border">
      <CardHeader className="pb-2">
        <CardTitle className="text-lg">Class feats</CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        {data.unlocked.map((f) => (
          <UnlockedFeat key={f.id} feat={f} onActivate={onActivate} activating={activate.isPending} />
        ))}
        {data.locked.map((f) => (
          <LockedFeat key={f.id} feat={f} />
        ))}
        {data.branchTree && <SpecializationSection tree={data.branchTree} />}
      </CardContent>
    </Card>
  );
}
