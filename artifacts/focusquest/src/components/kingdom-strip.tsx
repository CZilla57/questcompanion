import { Link } from "wouter";
import { useGetKingdoms } from "@workspace/api-client-react";
import { KingdomTierPips } from "@/components/kingdom-tier-pips";
import { MAX_CAPITAL_TIER } from "@/lib/kingdom-scene";

const LIVELINESS_DOT: Record<string, string> = {
  dormant:  "bg-muted-foreground/30",
  stirring: "bg-amber-400/50",
  steady:   "bg-amber-400",
  bustling: "bg-green-400",
};

/**
 * Compact five-kingdom liveliness readout, plus the capital as a separate seat
 * below the rule.
 *
 * The capital deliberately uses a DIFFERENT visual grammar — filled pips for
 * accumulated tier, never a liveliness bar. Liveliness is a share of RECENT
 * activity; the capital is a CUMULATIVE total, which has no share to report.
 * A sixth bar would need a value that doesn't exist, and would dilute the
 * five-kingdom signal the whole instrument exists to carry. Copy is
 * invitational, never corrective.
 */
export function KingdomStrip() {
  const { data } = useGetKingdoms();
  if (!data) return null;

  const kingdoms = data.kingdoms.filter((k) => !k.isCapital);
  const capital = data.kingdoms.find((k) => k.isCapital);

  return (
    <Link href="/insights" className="block rounded-lg border border-border p-3 hover:bg-muted/20 transition-colors">
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs uppercase tracking-wide text-muted-foreground">Your kingdoms</span>
        <span className="text-[10px] text-muted-foreground/70">View map →</span>
      </div>

      <div className="grid grid-cols-5 gap-1.5">
        {kingdoms.map((k) => {
          // Under global absence the world reads as one resting whole, never as five
          // separate verdicts — mirrors the override in kingdom-map.tsx so both
          // surfaces agree instead of this strip painting raw per-kingdom dormancy.
          const liveliness = data.worldResting ? "stirring" : (k.liveliness ?? "dormant");
          return (
            <div key={k.id} className="flex flex-col items-center gap-1">
              <span className={`h-1.5 w-full rounded-full ${LIVELINESS_DOT[liveliness] ?? LIVELINESS_DOT.dormant}`} />
              <span className="text-[10px] text-muted-foreground truncate w-full text-center">{k.name}</span>
            </div>
          );
        })}
      </div>

      {capital && (
        <div className="mt-2.5 pt-2 border-t border-border/60 flex items-center justify-between gap-2">
          <span className="text-[10px] text-muted-foreground truncate">
            Capital · {capital.tier > 0 ? capital.tierName : "unfounded"}
          </span>
          <KingdomTierPips tier={capital.tier} total={MAX_CAPITAL_TIER} className="shrink-0" />
        </div>
      )}

      {data.worldResting ? (
        <p className="mt-2 text-xs text-muted-foreground italic">Your world is resting. It's all still here.</p>
      ) : data.invitation ? (
        <p className="mt-2 text-xs text-primary">{data.invitation.kingdomName} has been quiet lately.</p>
      ) : null}
    </Link>
  );
}
