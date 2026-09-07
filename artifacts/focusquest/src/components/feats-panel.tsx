import { useQueryClient } from "@tanstack/react-query";
import {
  useGetMyFeats, getGetMyFeatsQueryKey,
  useActivateFeat, getGetMyStatsQueryKey,
  type FeatView,
} from "@workspace/api-client-react";
import { browserTimeZone } from "@/lib/timezone";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { Lock } from "lucide-react";

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
      </CardContent>
    </Card>
  );
}
