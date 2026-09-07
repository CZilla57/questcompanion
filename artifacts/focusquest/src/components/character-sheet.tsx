import { useGetCharacterSheet, type AbilityScore } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

/** Format a modifier as a signed value: +3, +0, -1. */
function formatMod(mod: number): string {
  return mod >= 0 ? `+${mod}` : `${mod}`;
}

/** One ability block: abbreviation, big score, signed modifier. Mirrors the
 *  D&D character-sheet stat box; the kingdom map below is the same data as a
 *  place. */
function AbilityBlock({ ability }: { ability: AbilityScore }) {
  return (
    <div className="rounded-lg border border-border bg-card/60 p-3 text-center">
      <div className="text-[10px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
        {ability.name}
      </div>
      <div className="mt-1 text-2xl font-semibold leading-none tabular-nums">{ability.score}</div>
      <div className="mt-1 text-sm font-medium text-primary tabular-nums">{formatMod(ability.modifier)}</div>
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
