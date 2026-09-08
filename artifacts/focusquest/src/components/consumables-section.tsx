import { Button } from "@/components/ui/button";
import { useConsumables } from "@/hooks/use-consumables";
import { Coins, FlaskConical, Check } from "lucide-react";

/**
 * Act IV (Tactics & Stakes): the consumables panel. Buy potions/scrolls with
 * coins and queue ONE to boost your NEXT quest's roll. Upside-only — a queued
 * item can only raise the roll, and nothing here ever costs XP or a streak.
 */
export function ConsumablesSection({ hideHeader = false }: { hideHeader?: boolean } = {}) {
  const { items, pending, isLoading, buy, activate, isBuying, isActivating } = useConsumables();
  const busy = isBuying || isActivating;

  return (
    <div className="space-y-3">
      {!hideHeader && (
        <div>
          <h2 className="text-sm font-semibold text-foreground flex items-center gap-2">
            <FlaskConical className="w-4 h-4 text-emerald-400" />
            Consumables
          </h2>
          <p className="text-xs text-muted-foreground mt-1">
            Buy a potion, then queue one to boost your next quest's roll. Every boost is upside-only — it can only help.
          </p>
        </div>
      )}

      {isLoading ? (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
          {[...Array(3)].map((_, i) => <div key={i} className="h-40 rounded-xl bg-muted/30 animate-pulse" />)}
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
          {items.map((item) => {
            const queued = pending === item.id;
            const owned = item.quantity;

            return (
              <div
                key={item.id}
                className={`flex flex-col gap-2 p-4 rounded-xl border transition-colors ${
                  queued ? "border-emerald-400/50 bg-emerald-400/10" : "border-border bg-card"
                }`}
              >
                <div className="flex items-start justify-between gap-2">
                  <span className="text-2xl leading-none" aria-hidden>{item.emoji}</span>
                  <span className="text-xs text-amber-300/90 flex items-center gap-1 shrink-0">
                    <Coins className="w-3 h-3" />{item.coinCost}
                  </span>
                </div>

                <div className="flex-1">
                  <div className="text-sm font-medium text-foreground">{item.name}</div>
                  <p className="text-xs text-muted-foreground mt-0.5 leading-snug">{item.description}</p>
                </div>

                <div className="text-xs text-muted-foreground">
                  {owned} held{queued ? " · queued for next roll" : ""}
                </div>

                {/* Queue control — only when at least one is owned */}
                {owned > 0 && (
                  queued ? (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => activate(null)}
                      disabled={busy}
                      className="w-full border-emerald-400/50 text-emerald-300 hover:bg-emerald-400/10"
                    >
                      <Check className="w-3.5 h-3.5 mr-1" />Queued · tap to clear
                    </Button>
                  ) : (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => activate(item)}
                      disabled={busy}
                      className="w-full"
                    >
                      Queue for next roll
                    </Button>
                  )
                )}

                {/* Buy control */}
                {item.affordable ? (
                  <Button
                    size="sm"
                    onClick={() => buy(item)}
                    disabled={busy}
                    className="bg-emerald-500 hover:bg-emerald-500/90 text-black w-full"
                  >
                    Buy
                  </Button>
                ) : (
                  <span className="text-xs text-muted-foreground text-center py-1.5 tabular-nums">
                    {item.remaining} more to go
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
