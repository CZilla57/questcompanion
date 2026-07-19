import { Link } from "wouter";
import { useGetKingdoms } from "@workspace/api-client-react";

const LIVELINESS_DOT: Record<string, string> = {
  dormant:  "bg-muted-foreground/30",
  stirring: "bg-amber-400/50",
  steady:   "bg-amber-400",
  bustling: "bg-green-400",
};

/**
 * Compact five-kingdom liveliness readout. Excludes the capital, which grows but
 * carries no balance meaning. Copy is invitational, never corrective.
 */
export function KingdomStrip() {
  const { data } = useGetKingdoms();
  if (!data) return null;

  const kingdoms = data.kingdoms.filter((k) => !k.isCapital);

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
          const liveliness = data.worldResting ? "stirring" : k.liveliness;
          return (
            <div key={k.id} className="flex flex-col items-center gap-1">
              <span className={`h-1.5 w-full rounded-full ${LIVELINESS_DOT[liveliness] ?? LIVELINESS_DOT.dormant}`} />
              <span className="text-[10px] text-muted-foreground truncate w-full text-center">{k.name}</span>
            </div>
          );
        })}
      </div>

      {data.worldResting ? (
        <p className="mt-2 text-xs text-muted-foreground italic">Your world is resting. It's all still here.</p>
      ) : data.invitation ? (
        <p className="mt-2 text-xs text-primary">{data.invitation.kingdomName} has been quiet lately.</p>
      ) : null}
    </Link>
  );
}
