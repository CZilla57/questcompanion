import { useGetKingdoms } from "@workspace/api-client-react";
import { KingdomScene } from "@/components/kingdom-scene";
import type { Liveliness } from "@/lib/kingdom-scene";

/**
 * The full map. Sits directly above the category breakdown on /insights so the
 * two read as the same data — the map is the felt version, the breakdown the
 * precise one.
 */
export function KingdomMap() {
  const { data } = useGetKingdoms();
  if (!data) return null;

  const kingdoms = data.kingdoms.filter((k) => !k.isCapital);
  const capital = data.kingdoms.find((k) => k.isCapital);

  return (
    <section className="space-y-3">
      <div>
        <h2 className="text-lg font-semibold">Your kingdoms</h2>
        <p className="text-xs text-muted-foreground">
          {data.worldResting
            ? "Your world is resting. Every place you've built is still standing."
            : "Each life area grows as you work in it. Quiet places are just sleeping."}
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        {kingdoms.map((k) => (
          <div key={k.id} className="rounded-lg border border-border overflow-hidden">
            <KingdomScene
              kingdomId={k.id}
              tier={k.tier}
              liveliness={(data.worldResting ? "stirring" : k.liveliness) as Liveliness}
              width={320}
              className="w-full block"
            />
            <div className="p-2 flex items-baseline justify-between">
              <span className="text-sm font-medium">{k.name}</span>
              <span className="text-[10px] uppercase tracking-wide text-muted-foreground">{k.tierName}</span>
            </div>
          </div>
        ))}
      </div>

      {capital && capital.tier > 0 && (
        <p className="text-[10px] text-muted-foreground/70">
          Your capital is a {capital.tierName.toLowerCase()}, built from everything that didn't fit a category.
        </p>
      )}

      {!data.worldResting && data.invitation && (
        <p className="text-xs text-primary">
          {data.invitation.kingdomName} has been quiet lately — it's still there whenever you want to head back.
        </p>
      )}
    </section>
  );
}
