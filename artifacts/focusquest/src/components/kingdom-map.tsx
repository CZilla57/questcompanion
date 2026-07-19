import { useGetKingdoms } from "@workspace/api-client-react";
import { KingdomScene } from "@/components/kingdom-scene";
import { KingdomTierPips } from "@/components/kingdom-tier-pips";
import { MAX_CAPITAL_TIER, type Liveliness } from "@/lib/kingdom-scene";

function KingdomTile({
  k, worldResting,
}: {
  k: { id: string; name: string; tier: number; tierName: string; liveliness: Liveliness | null };
  worldResting: boolean;
}) {
  return (
    <div className="rounded-lg border border-border overflow-hidden">
      {/* The cast is required: the generated KingdomStateLiveliness and the
          local Liveliness are structurally identical but nominally distinct. */}
      <KingdomScene
        kingdomId={k.id}
        tier={k.tier}
        liveliness={(worldResting ? "stirring" : k.liveliness) as Liveliness | null}
        className="w-full block"
      />
      <div className="p-2 flex items-baseline justify-between gap-2">
        <span className="text-sm font-medium truncate">{k.name}</span>
        <span className="text-[10px] uppercase tracking-wide text-muted-foreground shrink-0">{k.tierName}</span>
      </div>
    </div>
  );
}

/**
 * The full map. Sits directly above the category breakdown on /insights so the
 * two read as the same data — the map is the felt version, the breakdown the
 * precise one.
 *
 * Two kingdoms centred above the capital band, three below it. All five tiles
 * are the same size on purpose: the capital is the only element with a
 * different weight, because it is the only one measuring something different
 * (a lifetime total, not a share of recent activity).
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

      {/* Top pair, centred over the band. All five tiles are the SAME size:
          sizing tiles by activity would rank the user's life areas against each
          other and visibly shrink one the week they stepped away from it. */}
      {/* Six columns, not three: centring two tiles over a three-wide row needs
          half-column offsets, so the pair spans 2/6 each with a 1/6 spacer on
          either side. That makes every tile exactly 1/3 of the content width,
          matching the bottom row. A leading spacer in a 3-column grid would
          right-align the pair, not centre it. */}
      <div className="grid gap-3 sm:grid-cols-6">
        <div className="hidden sm:block" />
        {kingdoms.slice(0, 2).map((k) => (
          <div key={k.id} className="sm:col-span-2">
            <KingdomTile k={k} worldResting={data.worldResting} />
          </div>
        ))}
        <div className="hidden sm:block" />
      </div>

      {capital && (
        // Fixed height + object-cover: the band fills the content column at
        // every width, so its aspect ratio swings 3x between phone and desktop.
        // The art is authored 1024x192 with the composition in the centre 512px;
        // the outer quarters crop away on narrow viewports.
        <div className="relative rounded-lg border border-border overflow-hidden h-32 sm:h-40 lg:h-48">
          <KingdomScene
            kingdomId={capital.id}
            tier={capital.tier}
            liveliness={null}
            label={`The Capital, ${capital.tier > 0 ? capital.tierName.toLowerCase() : "not yet founded"}`}
            className="w-full h-full block object-cover object-center"
          />
          <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-background via-background/85 to-transparent px-3 pt-10 pb-2.5">
            <div className="flex items-end justify-between gap-3">
              <div>
                <p className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground/80">Seat of the realm</p>
                <p className="text-base font-medium leading-tight">The Capital</p>
              </div>
              <div className="flex flex-col items-end gap-1 shrink-0">
                <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
                  {capital.tier > 0 ? capital.tierName : "Unfounded"}
                </span>
                <KingdomTierPips tier={capital.tier} total={MAX_CAPITAL_TIER} />
              </div>
            </div>
          </div>
        </div>
      )}

      <div className="grid gap-3 sm:grid-cols-3">
        {kingdoms.slice(2).map((k) => (
          <KingdomTile key={k.id} k={k} worldResting={data.worldResting} />
        ))}
      </div>

      {!data.worldResting && data.invitation && (
        <p className="text-xs text-primary">
          {data.invitation.kingdomName} has been quiet lately — it's still there whenever you want to head back.
        </p>
      )}
    </section>
  );
}
