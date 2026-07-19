import { useGetKingdoms } from "@workspace/api-client-react";
import { KingdomScene } from "@/components/kingdom-scene";
import { KingdomTierPips } from "@/components/kingdom-tier-pips";
import type { Liveliness } from "@/lib/kingdom-scene";

/**
 * The full map. Sits directly above the category breakdown on /insights so the
 * two read as the same data — the map is the felt version, the breakdown the
 * precise one.
 *
 * Layout encodes the model rather than decorating it: the capital is a wide
 * seat across the top because it is the realm's centre and carries no balance
 * meaning, and the five balance kingdoms sit below it in a FIXED asymmetric
 * mosaic. Fixed is the point — sizing cards by activity would rank the user's
 * life areas against each other and shrink a card the week someone steps away
 * from it, which is exactly the verdict this system refuses to deliver.
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

      {capital && (
        // Art beside a panel, NOT a full-bleed banner. The capital scene is a
        // symmetric plaza — clock tower, grand hall, dome — composed as a whole,
        // so it cannot be cropped to a banner height without severing the
        // architecture that identifies it. Capping the art's width instead keeps
        // it intact and stops a 320x192 scene upscaling into a ~440px slab that
        // would dwarf the kingdom cards below.
        <div className="rounded-lg border border-border overflow-hidden sm:flex sm:items-stretch">
          <div className="sm:w-[46%] sm:max-w-[420px] sm:shrink-0">
            <KingdomScene
              kingdomId={capital.id}
              tier={capital.tier}
              // The capital never renders a liveliness verdict — it has no balance
              // share to report. "steady" is the neutral pass-through: full art, no
              // dimming and no celebratory glow either way.
              liveliness="steady"
              label={`The Capital, ${capital.tier > 0 ? capital.tierName.toLowerCase() : "not yet founded"}`}
              className="w-full block"
            />
          </div>
          <div className="flex flex-col justify-center gap-1 bg-muted/10 px-3 py-3 sm:px-5 sm:flex-1">
            <p className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground/80">Seat of the realm</p>
            <div className="flex items-baseline justify-between gap-3">
              <p className="text-base font-medium">The Capital</p>
              <span className="text-[10px] uppercase tracking-wide text-muted-foreground shrink-0">
                {capital.tier > 0 ? capital.tierName : "Unfounded"}
              </span>
            </div>
            <p className="text-xs text-muted-foreground">
              {capital.tier > 0
                ? "Built from everything that didn't fit a category."
                : "Work that doesn't fit a category builds it here."}
            </p>
            <KingdomTierPips tier={capital.tier} className="mt-1.5" />
          </div>
        </div>
      )}

      <div className="grid gap-3 sm:grid-cols-6">
        {kingdoms.map((k, i) => (
          <div
            key={k.id}
            className={`rounded-lg border border-border overflow-hidden ${i < 2 ? "sm:col-span-3" : "sm:col-span-2"}`}
          >
            <KingdomScene
              kingdomId={k.id}
              tier={k.tier}
              liveliness={(data.worldResting ? "stirring" : k.liveliness) as Liveliness}
              className="w-full block"
            />
            <div className="p-2 flex items-baseline justify-between gap-2">
              <span className="text-sm font-medium truncate">{k.name}</span>
              <span className="text-[10px] uppercase tracking-wide text-muted-foreground shrink-0">{k.tierName}</span>
            </div>
          </div>
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
