import { useGetStatPerks } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { useBuyPerk } from "@/hooks/use-buy-perk";
import { Coins, Zap } from "lucide-react";

/** "11h 42m" / "42m" left until a boost window closes; "" once it's past. */
function formatRemaining(iso: string | null): string {
  if (!iso) return "";
  const ms = new Date(iso).getTime() - Date.now();
  if (ms <= 0) return "";
  const totalMin = Math.floor(ms / 60000);
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

export function StatPerksSection({ hideHeader = false }: { hideHeader?: boolean } = {}) {
  const { data, isLoading } = useGetStatPerks();
  const { buy, isPending } = useBuyPerk();

  const perks = data?.perks ?? [];

  return (
    <div className="space-y-3">
      {!hideHeader && (
        <div>
          <h2 className="text-sm font-semibold text-foreground flex items-center gap-2">
            <Zap className="w-4 h-4 text-amber-400" />
            Power-Ups
          </h2>
          <p className="text-xs text-muted-foreground mt-1">
            Spend coins to play stronger. Boosts stack their timer; nothing here ever costs you XP or a streak.
          </p>
        </div>
      )}

      {isLoading ? (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
          {[...Array(3)].map((_, i) => <div key={i} className="h-32 rounded-xl bg-muted/30 animate-pulse" />)}
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
          {perks.map((perk) => {
            const isShield = perk.kind === "streak_shield";
            const boostActive = perk.active === true;
            const remaining = formatRemaining(perk.expiresAt);
            const atMax = perk.atMax === true;

            return (
              <div
                key={perk.id}
                className={`flex flex-col gap-2 p-4 rounded-xl border transition-colors ${
                  boostActive ? "border-amber-400/50 bg-amber-400/10" : "border-border bg-card"
                }`}
              >
                <div className="flex items-start justify-between gap-2">
                  <span className="text-2xl leading-none" aria-hidden>{perk.emoji}</span>
                  <span className="text-xs text-amber-300/90 flex items-center gap-1 shrink-0">
                    <Coins className="w-3 h-3" />{perk.coinCost}
                  </span>
                </div>

                <div className="flex-1">
                  <div className="text-sm font-medium text-foreground">{perk.label}</div>
                  <p className="text-xs text-muted-foreground mt-0.5 leading-snug">{perk.description}</p>
                </div>

                {/* Live status line */}
                {boostActive && remaining && (
                  <div className="text-xs font-medium text-amber-300">Active · {remaining} left</div>
                )}
                {isShield && (
                  <div className="text-xs text-muted-foreground">
                    {perk.owned ?? 0} held{atMax ? " · full" : ""}
                  </div>
                )}

                {/* Action */}
                {isShield && atMax ? (
                  <span className="text-xs text-muted-foreground text-center py-1.5">Fully shielded 🛡️</span>
                ) : perk.affordable ? (
                  <Button
                    size="sm"
                    onClick={() => buy(perk)}
                    disabled={isPending}
                    className="bg-amber-500 hover:bg-amber-500/90 text-black w-full"
                  >
                    {boostActive ? "Extend" : "Buy"}
                  </Button>
                ) : (
                  <span className="text-xs text-muted-foreground text-center py-1.5 tabular-nums">
                    {perk.remaining} more to go
                  </span>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
