/**
 * Filled-pip readout of a kingdom's position on its tier ladder.
 *
 * This is the capital's visual grammar on BOTH surfaces, and it is deliberately
 * not the liveliness bar the five balance kingdoms use: pips count accumulated
 * structure, which only ever grows, where a liveliness bar reports a share of
 * recent activity. Keeping the two languages distinct is what stops the capital
 * reading as a sixth life area.
 *
 * `total` is a prop rather than a module constant because the capital's ladder
 * is twelve stages deep while the kingdoms' is six.
 *
 * `total` is the number of BUILDABLE stages above the base tier (i.e.
 * MAX_CAPITAL_TIER, not MAX_CAPITAL_TIER + 1) — NOT the count of named tiers.
 * Tier 0 has nothing built, so zero filled pips is truthful there; the top
 * tier then fills every pip, so N pips fully encode the N+1 possible tiers
 * (0 through N). Passing tier-count instead leaves the top pip permanently
 * unreachable, which reads as an unfinished ladder at the terminal tier.
 */
export function KingdomTierPips({
  tier, total, className = "",
}: {
  tier: number;
  total: number;
  className?: string;
}) {
  return (
    <span className={`flex items-center gap-[3px] ${className}`} aria-hidden="true">
      {Array.from({ length: total }, (_, i) => (
        <span
          key={i}
          className={`h-1 w-1 rounded-full ${i < tier ? "bg-muted-foreground/70" : "bg-muted-foreground/20"}`}
        />
      ))}
    </span>
  );
}
