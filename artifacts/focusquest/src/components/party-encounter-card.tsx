import { motion } from "framer-motion";
import { Users } from "lucide-react";
import { useGetPartyEncounters } from "@workspace/api-client-react";
import { Card } from "@/components/ui/card";
import { encounterPhaseLabel } from "@/lib/encounter";

/**
 * Party & Shared Encounters — the co-op reframe of the personal encounter. A
 * party (an accepted partnership) fights ONE shared foe whose single HP bar is
 * chipped by EITHER ally's quest completions. Contributions render as additive
 * teamwork, never a ranking: no member is ever "behind", "carrying", or
 * out-damaged. An unfelled foe RESTS — it is never a party loss.
 *
 * Renders nothing while loading or when the viewer has no party (empty array),
 * so it composes cleanly with the campaigns feature gate at the mount site.
 */
export function PartyEncounterCard() {
  const { data, isLoading } = useGetPartyEncounters();
  if (isLoading || !data || data.length === 0) return null;

  return (
    <div className="space-y-4">
      {data.map((party) => {
        const enc = party.encounter;
        const pct = Math.round(enc.percentRemaining * 100);
        return (
          <Card key={party.partnershipId} className="p-4 space-y-3 bg-card border-border">
            <div className="flex items-center gap-3">
              <div className="h-10 w-10 rounded-full bg-primary/15 grid place-items-center text-primary">
                <Users className="h-5 w-5" />
              </div>
              <div className="flex-1">
                <h3 className="font-bold text-lg leading-tight">{party.foeName}</h3>
                <p className="text-sm text-muted-foreground">Encounter {party.tier} · {encounterPhaseLabel(enc.phase)}</p>
                {party.motive ? <p className="text-xs text-muted-foreground/80 italic mt-0.5">{party.motive}</p> : null}
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

            <div className="grid grid-cols-2 gap-2">
              {party.members.map((member) => (
                <div key={member.userId} className="rounded-lg border border-border bg-muted/30 px-3 py-2">
                  <p className="text-sm font-medium truncate">{member.name}</p>
                  <p className="text-xs text-muted-foreground">{member.damage.toLocaleString()} struck</p>
                </div>
              ))}
            </div>

            <p className="text-xs text-muted-foreground">
              Every quest either of you finishes strikes together.
            </p>
          </Card>
        );
      })}
    </div>
  );
}
