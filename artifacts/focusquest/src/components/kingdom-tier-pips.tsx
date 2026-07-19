import { MAX_KINGDOM_TIER } from "@/lib/kingdom-scene";

/**
 * Filled-pip readout of a kingdom's position on the tier ladder.
 *
 * This is the capital's visual grammar on BOTH surfaces, and it is deliberately
 * not the liveliness bar the five balance kingdoms use: pips count accumulated
 * structure, which only ever grows, where a liveliness bar reports a share of
 * recent activity. Keeping the two languages distinct is what stops the capital
 * reading as a sixth life area.
 */
export function KingdomTierPips({ tier, className = "" }: { tier: number; className?: string }) {
  return (
    <span className={`flex items-center gap-[3px] ${className}`} aria-hidden="true">
      {Array.from({ length: MAX_KINGDOM_TIER }, (_, i) => (
        <span
          key={i}
          className={`h-1 w-1 rounded-full ${i < tier ? "bg-muted-foreground/70" : "bg-muted-foreground/20"}`}
        />
      ))}
    </span>
  );
}
