import { motion } from "framer-motion";
import { Swords } from "lucide-react";
import { useGetEncounterCurrent } from "@workspace/api-client-react";
import { Card } from "@/components/ui/card";
import { encounterPhaseLabel } from "@/lib/encounter";

/**
 * The Campaign — Phase 2: the player's solo encounter. Its HP bar drops as you
 * complete quests (each completion's skill check lands a band-scaled blow, wired
 * server-side in the completion path). The foe is an EXTERNAL friction made
 * monstrous — felling it is beating the day's drag, never yourself; a felled foe
 * rests and a new one stirs.
 */
export function PersonalEncounterCard() {
  const { data, isLoading } = useGetEncounterCurrent();
  if (isLoading || !data) return null;

  const { encounter: enc, name, tier } = data;
  const pct = Math.round(enc.percentRemaining * 100);

  return (
    <Card className="p-4 space-y-3 bg-card border-border">
      <div className="flex items-center gap-3">
        <div className="h-10 w-10 rounded-full bg-primary/15 grid place-items-center text-primary">
          <Swords className="h-5 w-5" />
        </div>
        <div className="flex-1">
          <h3 className="font-bold text-lg leading-tight">{name}</h3>
          <p className="text-sm text-muted-foreground">Encounter {tier} · {encounterPhaseLabel(enc.phase)}</p>
        </div>
      </div>

      <div>
        <div className="flex justify-between text-sm mb-1">
          <span className="text-muted-foreground">{pct}% HP</span>
          <span className="font-medium">{enc.hpRemaining.toLocaleString()} / {enc.hp.toLocaleString()}</span>
        </div>
        <div className="h-3 w-full rounded-full bg-muted overflow-hidden">
          <motion.div
            className="h-full rounded-full bg-red-400"
            initial={{ width: 0 }}
            animate={{ width: `${pct}%` }}
            transition={{ type: "spring", stiffness: 120, damping: 20 }}
          />
        </div>
      </div>

      <p className="text-xs text-muted-foreground">
        Every quest you finish lands a blow. Crit rolls hit hardest.
      </p>
    </Card>
  );
}
