import { useGetCharacterSheet, type AbilityScore } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

/** Format a modifier as a signed value: +3, +0, -1. */
function formatMod(mod: number): string {
  return mod >= 0 ? `+${mod}` : `${mod}`;
}

/** One ability block: name, big score, signed modifier, and a thin bar showing
 *  how far the next completed quest in this area has carried the score toward
 *  its next point. Mirrors the D&D character-sheet stat box; the kingdom map
 *  below is the same data as a place. */
function AbilityBlock({ ability }: { ability: AbilityScore }) {
  // Defensive: `progress` ships with the server that emits it; fall back to a
  // neutral empty bar if a client is ever built ahead of that server.
  const { fraction, nextScore, toNext, atMax } =
    ability.progress ?? { fraction: 0, nextScore: null, toNext: 0, atMax: false };
  const pct = Math.round(Math.min(1, Math.max(0, fraction)) * 100);
  const label = atMax
    ? `${ability.name} is at its peak`
    : `${ability.name} ${pct}% to ${nextScore} · ${toNext.toLocaleString()} to go`;
  // Defensive: gear-overlay fields ship with the server that emits them; fall
  // back to the base score/modifier if a client is ever built ahead of that
  // server.
  const gearBonus = ability.gearBonus ?? 0;
  const effScore = ability.effectiveScore ?? ability.score;
  const effMod = ability.effectiveModifier ?? ability.modifier;
  return (
    <div className="rounded-lg border border-border bg-card/60 p-3 text-center">
      <div className="text-[10px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
        {ability.name}
      </div>
      <div className="mt-1 text-2xl font-semibold leading-none tabular-nums">{effScore}</div>
      <div className="mt-1 text-sm font-medium text-primary tabular-nums">{formatMod(effMod)}</div>
      {gearBonus > 0 && (
        <div className="mt-0.5 text-[10px] font-medium text-amber-400 tabular-nums">
          +{gearBonus} gear
        </div>
      )}
      <div
        className="mt-2 h-1 overflow-hidden rounded-full bg-muted"
        role="progressbar"
        aria-valuenow={atMax ? 100 : pct}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={label}
        title={label}
      >
        <div
          className={`h-full rounded-full transition-[width] duration-500 ${atMax ? "bg-amber-400" : "bg-primary"}`}
          style={{ width: atMax ? "100%" : `${pct}%` }}
        />
      </div>
    </div>
  );
}

/**
 * The hero's character sheet: six ability scores derived from the same Life
 * Kingdom points the map shows, plus focus discipline (Finesse) and a
 * proficiency bonus from the capital. Sits directly above the Kingdom map so
 * the two read as one thing — the sheet is the precise version, the map the
 * felt one.
 */
export function CharacterSheetPanel() {
  const { data } = useGetCharacterSheet();
  if (!data) return null;

  return (
    <Card className="bg-card border-border">
      <CardHeader className="pb-2">
        <div className="flex items-baseline justify-between gap-3">
          <CardTitle className="text-lg">Character sheet</CardTitle>
          <span className="text-xs text-muted-foreground">
            Level {data.level} {data.heroClass}
            <span className="mx-1.5 text-muted-foreground/40">·</span>
            Proficiency {formatMod(data.proficiencyBonus)}
            <span className="mx-1.5 text-muted-foreground/40">·</span>
            {data.battlePower} power
          </span>
        </div>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-3 gap-2 sm:grid-cols-6">
          {data.abilities.map((ability) => (
            <AbilityBlock key={ability.id} ability={ability} />
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
