import { useGetCapital } from "@workspace/api-client-react";
import { KingdomScene } from "@/components/kingdom-scene";
import { KingdomTierPips } from "@/components/kingdom-tier-pips";
import { MAX_CAPITAL_TIER } from "@/lib/kingdom-scene";

/**
 * Act V (Depth & Collection): the Capital — the hero's seat, a home that visibly
 * grows. The kingdom map (Insights) shows the capital's discrete tier + pips;
 * this brings it onto the Hero page with FINE-GRAINED progress toward the next
 * tier, so growth is felt continuously. Derived + monotonic — it only ever
 * grows, never a penalty.
 */
export function CapitalCard() {
  const { data } = useGetCapital();
  if (!data) return null;

  const founded = data.tier > 0;
  const pct = Math.round(data.fraction * 100);

  return (
    <div className="relative rounded-lg border border-border overflow-hidden">
      <div className="h-28 sm:h-32">
        <KingdomScene
          kingdomId="capital"
          tier={data.tier}
          liveliness={null}
          label={`The Capital, ${founded ? data.name.toLowerCase() : "not yet founded"}`}
          className="w-full h-full block object-cover object-center"
        />
      </div>
      <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-background via-background/85 to-transparent px-3 pt-10 pb-2.5 space-y-1.5">
        <div className="flex items-end justify-between gap-3">
          <div>
            <p className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground/80">Seat of the realm</p>
            <p className="text-base font-medium leading-tight">The Capital · {founded ? data.name : "Unfounded"}</p>
          </div>
          <KingdomTierPips tier={data.tier} total={MAX_CAPITAL_TIER} />
        </div>

        {/* Fine-grained progress toward the next tier — what the pips alone can't show. */}
        {data.atMax ? (
          <p className="text-[11px] font-medium text-primary">The realm is at its height — Eternal Capital. ✦</p>
        ) : (
          <div className="space-y-1">
            <div className="h-1.5 w-full rounded-full bg-muted overflow-hidden">
              <div
                className="h-full rounded-full bg-primary transition-[width] duration-500"
                style={{ width: `${pct}%` }}
              />
            </div>
            <p className="text-[11px] text-muted-foreground tabular-nums">
              {data.pointsToNext.toLocaleString()} to {data.nextName}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
